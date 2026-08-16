"""Whisper (tiny/base/small, multilingual) on the Hexagon NPU via Qualcomm AI Hub QNN context binaries.

Port of qai_hub_models/_shared/hf_whisper/app.py (v0.60.0) without torch/transformers:
- log-mel features in numpy (80 mel bins, n_fft 400, hop 160, 30 s window, HF WhisperFeatureExtractor semantics)
- encoder → per-layer cross K/V caches; decoder loop with right-aligned self K/V caches (length 199), an
  additive attention mask [1,1,1,200] initialised to MASK_NEG=-100 and opened one slot per step, greedy argmax,
  starting from <|startoftranscript|> only (the model emits language/task tokens itself), max 200 tokens/chunk.
"""
from __future__ import annotations

import io
import time
from pathlib import Path

import numpy as np

from engines import qnn
from registry import MODELS, ModelSpec
from util import log

SAMPLE_RATE = 16_000
CHUNK_SECONDS = 30
N_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS
N_FFT = 400
HOP = 160
N_MELS = 80
MEAN_DECODE_LEN = 200
MASK_NEG = -100.0


# ----------------------------------------------------------------------------- audio → features


def load_audio(data: bytes, filename: str = "audio.wav") -> tuple[np.ndarray, int]:
    """Decode WAV/FLAC/OGG (soundfile) to mono float32. MP3/M4A/webm are not decodable here — the renderer converts
    microphone audio to 16 kHz WAV before upload."""
    import soundfile as sf

    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return audio.mean(axis=1).astype(np.float32), int(sr)


def resample(audio: np.ndarray, sr: int, target: int = SAMPLE_RATE) -> np.ndarray:
    if sr == target:
        return audio
    # linear interpolation is adequate for speech that is already ≥16 kHz mono
    n_out = int(round(len(audio) * target / sr))
    x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def _stft_power(x: np.ndarray) -> np.ndarray:
    """|STFT|² with a periodic Hann window, reflect padding of n_fft//2 (matches whisper/HF)."""
    pad = N_FFT // 2
    x = np.pad(x, (pad, pad), mode="reflect")
    window = np.hanning(N_FFT + 1)[:-1].astype(np.float32)
    n_frames = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    frames = x[idx] * window
    spec = np.fft.rfft(frames, n=N_FFT, axis=1)
    mag = (spec.real**2 + spec.imag**2).astype(np.float32)  # (frames, 201)
    return mag[:-1].T  # drop last frame like whisper → (201, 3000) for 30 s


def log_mel(audio16k: np.ndarray, mel_filters: np.ndarray) -> np.ndarray:
    """(1, 80, 3000) float32 log-mel, HF WhisperFeatureExtractor semantics."""
    x = audio16k[:N_SAMPLES]
    if len(x) < N_SAMPLES:
        x = np.pad(x, (0, N_SAMPLES - len(x)))
    power = _stft_power(x)
    mel = mel_filters @ power  # (80, 3000)
    log_spec = np.log10(np.maximum(mel, 1e-10))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    log_spec = (log_spec + 4.0) / 4.0
    return log_spec[None].astype(np.float32)


# ----------------------------------------------------------------------------- engine


class WhisperEngine:
    def __init__(self, spec: ModelSpec):
        self.spec = spec
        d = spec.dir
        from tokenizers import Tokenizer

        self.tokenizer = Tokenizer.from_file(str(d / "tokenizer.json"))
        filt = np.load(d / "mel_filters.npz")
        key = "mel_80" if "mel_80" in filt else list(filt.keys())[0]
        self.mel_filters = filt[key].astype(np.float32)  # (80, 201)
        self.encoder = qnn.get_context(f"{spec.id}:encoder", d / "encoder.bin", native=True)
        self.decoder = qnn.get_context(f"{spec.id}:decoder", d / "decoder.bin", native=True)
        self.layers = int(spec.extra.get("layers", 6))
        # special ids
        self.sot = self._tok_id("<|startoftranscript|>", 50258)
        self.eot = self._tok_id("<|endoftext|>", 50257)
        self.no_ts = self._tok_id("<|notimestamps|>", 50363)
        self.transcribe_id = self._tok_id("<|transcribe|>", 50359)
        # decoder I/O bookkeeping
        self.dec_shapes = dict(zip(self.decoder.input_names, self.decoder.input_shapes))
        self.dec_dtypes = dict(zip(self.decoder.input_names, self.decoder.input_dtypes)) if self.decoder.input_dtypes else {}
        log(f"whisper {spec.id}: decoder inputs {list(self.dec_shapes)}")

    def _tok_id(self, token: str, default: int) -> int:
        try:
            v = self.tokenizer.token_to_id(token)
            return int(v) if v is not None else default
        except Exception:
            return default

    def _lang_id(self, lang: str) -> int | None:
        return self.tokenizer.token_to_id(f"<|{lang}|>")

    def _dtype_for(self, name: str, default=np.float16):
        d = self.dec_dtypes.get(name, "")
        return qnn.NamedContext._np_dtype(d, default) if d else default

    def _transcribe_chunk(self, audio16k: np.ndarray, language: str | None) -> list[int]:
        feats = log_mel(audio16k, self.mel_filters)
        enc_in_name = self.encoder.input_names[0]
        enc_out = self.encoder.run({enc_in_name: feats.astype(np.float16)})
        # cross caches keyed by decoder input names (k_cache_cross_i / v_cache_cross_i)
        cross: dict[str, np.ndarray] = {}
        for name, arr in enc_out.items():
            cross[name] = arr
        # self caches (zeros), attention mask
        self_cache: dict[str, np.ndarray] = {}
        for name, shape in self.dec_shapes.items():
            if "cache_self" in name and name.endswith("_in"):
                self_cache[name] = np.zeros(shape, dtype=self._dtype_for(name))
        mask_name = next((n for n in self.dec_shapes if "attention_mask" in n), "attention_mask")
        ids_name = next((n for n in self.dec_shapes if n.startswith("input_ids")), "input_ids")
        pos_name = next((n for n in self.dec_shapes if "position" in n), "position_ids")
        mask = np.full(self.dec_shapes.get(mask_name, [1, 1, 1, MEAN_DECODE_LEN]), MASK_NEG, dtype=self._dtype_for(mask_name))
        max_len = int(mask.shape[-1])

        # Prefix: SOT (+ optional forced language / transcribe / no-timestamps like the HF app when language is set)
        prefix = [self.sot]
        if language:
            lid = self._lang_id(language)
            if lid is not None:
                prefix += [lid, self.transcribe_id, self.no_ts]
        out_ids: list[int] = list(prefix)
        logits_name = next((n for n in self.decoder.output_names if "logit" in n), self.decoder.output_names[0])

        for n in range(max_len - 1):
            token = out_ids[n] if n < len(out_ids) else out_ids[-1]
            mask[..., max_len - n - 1] = 0.0
            feed: dict[str, np.ndarray] = {
                ids_name: np.array([[token]], dtype=self._dtype_for(ids_name, np.int32)),
                pos_name: np.array([n], dtype=self._dtype_for(pos_name, np.int32)),
                mask_name: mask,
            }
            feed.update(self_cache)
            for cname, arr in cross.items():
                if cname in self.dec_shapes:
                    feed[cname] = arr
            # some binaries name cross caches differently on encoder vs decoder side: match by shape if needed
            missing = [k for k in self.dec_shapes if k not in feed]
            if missing:
                enc_vals = list(cross.values())
                for k in missing:
                    shp = self.dec_shapes[k]
                    for i, v in enumerate(enc_vals):
                        if list(v.shape) == list(shp):
                            feed[k] = v
                            enc_vals.pop(i)
                            break
            out = self.decoder.run(feed)
            logits = np.asarray(out[logits_name], dtype=np.float32).reshape(-1)
            # update self caches from *_out
            for k in list(self_cache):
                ok = k[:-3] + "_out" if k.endswith("_in") else k + "_out"
                if ok in out:
                    self_cache[k] = out[ok].astype(self_cache[k].dtype, copy=False)
            if n < len(prefix) - 1:
                continue  # still feeding the forced prefix
            nxt = int(np.argmax(logits))
            if nxt == self.eot or len(out_ids) >= max_len - 1:
                break
            out_ids.append(nxt)
        return out_ids

    def transcribe(self, data: bytes, filename: str = "audio.wav", language: str | None = None) -> dict:
        t0 = time.time()
        audio, sr = load_audio(data, filename)
        audio = resample(audio, sr)
        duration = len(audio) / SAMPLE_RATE
        chunks = [audio[i : i + N_SAMPLES] for i in range(0, max(1, len(audio)), N_SAMPLES)] or [audio]
        texts: list[str] = []
        segments: list[dict] = []
        with qnn.Perf():
            for ci, chunk in enumerate(chunks):
                if len(chunk) < SAMPLE_RATE // 4:  # <0.25 s of audio → skip
                    continue
                ids = self._transcribe_chunk(chunk, language)
                text = self.tokenizer.decode(ids, skip_special_tokens=True).strip()
                if text:
                    texts.append(text)
                    segments.append({"start": ci * CHUNK_SECONDS, "end": min((ci + 1) * CHUNK_SECONDS, duration), "text": text})
        return {"text": " ".join(texts).strip(), "language": language, "durationMs": (time.time() - t0) * 1000, "audioSeconds": duration, "segments": segments}


_engines: dict[str, WhisperEngine] = {}


def get_engine(model_id: str | None) -> WhisperEngine:
    if not model_id:
        installed = [m for m in MODELS.values() if m.feature == "stt" and m.installed()]
        # prefer base > small > tiny when unspecified
        order = {"whisper-base": 0, "whisper-small": 1, "whisper-tiny": 2}
        installed.sort(key=lambda m: order.get(m.id, 9))
        if not installed:
            raise FileNotFoundError("no Whisper model is downloaded")
        model_id = installed[0].id
    spec = MODELS.get(model_id)
    if not spec or spec.feature != "stt":
        raise KeyError(f"unknown STT model {model_id}")
    if not spec.installed():
        raise FileNotFoundError(f"model {model_id} is not downloaded")
    eng = _engines.get(model_id)
    if eng is None:
        for k in list(_engines):
            qnn.release_group(f"{k}:")
            _engines.pop(k)
        eng = WhisperEngine(spec)
        _engines[model_id] = eng
    return eng


def any_installed() -> bool:
    return any(m.installed() for m in MODELS.values() if m.feature == "stt")
