"""Stable Diffusion 1.5 / 2.1 on the Hexagon NPU via Qualcomm AI Hub QNN context binaries.

No torch / diffusers / transformers: the CLIP BPE tokenizer and the Euler scheduler are implemented in numpy,
matching Qualcomm's ai-hub-apps reference (text encoder → 2×UNet per step with CFG → VAE decoder).
"""
from __future__ import annotations

import functools
import html
import json
import time
from pathlib import Path

import numpy as np

from engines import qnn
from registry import MODELS, ModelSpec
from util import log

# ----------------------------------------------------------------------------- CLIP tokenizer


@functools.lru_cache()
def _bytes_to_unicode() -> dict[int, str]:
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(2**8):
        if b not in bs:
            bs.append(b)
            cs.append(2**8 + n)
            n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


def _get_pairs(word: tuple[str, ...]) -> set[tuple[str, str]]:
    return {(word[i], word[i + 1]) for i in range(len(word) - 1)}


class ClipTokenizer:
    """OpenAI CLIP BPE (as used by SD 1.x / 2.x), built from HF vocab.json + merges.txt."""

    def __init__(self, vocab_path: Path, merges_path: Path):
        import regex as re

        self.byte_encoder = _bytes_to_unicode()
        self.encoder: dict[str, int] = json.loads(vocab_path.read_text(encoding="utf8"))
        merges = merges_path.read_text(encoding="utf8").split("\n")
        if merges and merges[0].startswith("#"):
            merges = merges[1:]
        merges = [tuple(m.split()) for m in merges if m.strip() and len(m.split()) == 2]
        self.bpe_ranks = {m: i for i, m in enumerate(merges)}
        self.cache: dict[str, str] = {"<|startoftext|>": "<|startoftext|>", "<|endoftext|>": "<|endoftext|>"}
        self.pat = re.compile(r"""<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""", re.IGNORECASE)
        self.bos = self.encoder.get("<|startoftext|>", 49406)
        self.eos = self.encoder.get("<|endoftext|>", 49407)

    def _bpe(self, token: str) -> str:
        if token in self.cache:
            return self.cache[token]
        word = tuple(token[:-1]) + (token[-1] + "</w>",)
        pairs = _get_pairs(word)
        if not pairs:
            return token + "</w>"
        while True:
            bigram = min(pairs, key=lambda p: self.bpe_ranks.get(p, float("inf")))
            if bigram not in self.bpe_ranks:
                break
            first, second = bigram
            new_word: list[str] = []
            i = 0
            while i < len(word):
                try:
                    j = word.index(first, i)
                    new_word.extend(word[i:j])
                    i = j
                except ValueError:
                    new_word.extend(word[i:])
                    break
                if word[i] == first and i < len(word) - 1 and word[i + 1] == second:
                    new_word.append(first + second)
                    i += 2
                else:
                    new_word.append(word[i])
                    i += 1
            word = tuple(new_word)
            if len(word) == 1:
                break
            pairs = _get_pairs(word)
        out = " ".join(word)
        self.cache[token] = out
        return out

    def encode(self, text: str) -> list[int]:
        import regex as re

        text = html.unescape(html.unescape(text)).strip()
        text = re.sub(r"\s+", " ", text).lower()
        ids: list[int] = []
        for token in self.pat.findall(text):
            token = "".join(self.byte_encoder[b] for b in token.encode("utf-8"))
            ids.extend(self.encoder[t] for t in self._bpe(token).split(" ") if t in self.encoder)
        return ids

    def tokenize(self, text: str, max_len: int = 77, pad_id: int = 49407) -> np.ndarray:
        ids = [self.bos] + self.encode(text)[: max_len - 2] + [self.eos]
        ids = ids + [pad_id] * (max_len - len(ids))
        return np.array(ids, dtype=np.int32).reshape(1, max_len)


# ----------------------------------------------------------------------------- Euler scheduler (Qualcomm reference)

NUM_TRAIN_TIMESTEPS = 1000
BETA_START, BETA_END = 0.00085, 0.012
STEPS_OFFSET = 1


class EulerScheduler:
    """Matches diffusers EulerDiscreteScheduler(beta_schedule='scaled_linear', timestep_spacing='leading') as used by
    Qualcomm's ai-hub-apps Stable Diffusion demo. `prediction` = 'v_prediction' (SD 2.1) or 'epsilon' (SD 1.5)."""

    def __init__(self, num_steps: int, prediction: str = "v_prediction"):
        betas = np.linspace(BETA_START**0.5, BETA_END**0.5, NUM_TRAIN_TIMESTEPS) ** 2
        alphas_cumprod = np.cumprod(1.0 - betas)
        all_sigmas = ((1 - alphas_cumprod) / alphas_cumprod) ** 0.5
        step_ratio = NUM_TRAIN_TIMESTEPS / num_steps
        ts = (np.arange(0, num_steps) * step_ratio).round().astype(np.int64) + STEPS_OFFSET
        self.timesteps = ts[::-1].copy()
        self.sigmas = np.append(all_sigmas[self.timesteps], 0.0)
        self.prediction = prediction
        self.num_steps = num_steps

    @property
    def init_noise_sigma(self) -> float:
        return float(self.sigmas.max())

    def scale_model_input(self, sample: np.ndarray, i: int) -> np.ndarray:
        sigma = float(self.sigmas[i])
        return sample / float((sigma**2 + 1) ** 0.5)

    def step(self, model_output: np.ndarray, i: int, sample: np.ndarray) -> np.ndarray:
        sigma = float(self.sigmas[i])
        sigma_next = float(self.sigmas[i + 1])
        if self.prediction == "v_prediction":
            pred_orig = model_output * (-sigma / (sigma**2 + 1) ** 0.5) + sample * float(1.0 / (sigma**2 + 1))
        else:  # epsilon
            pred_orig = sample - sigma * model_output
        derivative = (sample - pred_orig) / sigma
        return (sample + derivative * float(sigma_next - sigma)).astype(np.float32)


# ----------------------------------------------------------------------------- pipeline


def _by_shape(ctx: qnn.NamedContext, arrays: list[np.ndarray]) -> dict[str, np.ndarray]:
    """Assign arrays to inputs by element count (the SD binaries have distinct shapes per input)."""
    out: dict[str, np.ndarray] = {}
    used: set[int] = set()
    for name, shape in zip(ctx.input_names, ctx.input_shapes):
        n = int(np.prod(shape)) if shape else 1
        for idx, a in enumerate(arrays):
            if idx not in used and a.size == n:
                out[name] = a
                used.add(idx)
                break
    if len(out) != len(ctx.input_names):
        raise RuntimeError(f"{ctx.name}: could not map inputs {[a.shape for a in arrays]} onto {list(zip(ctx.input_names, ctx.input_shapes))}")
    return out


class StableDiffusion:
    def __init__(self, spec: ModelSpec):
        self.spec = spec
        d = spec.dir
        self.tok = ClipTokenizer(d / "tokenizer" / "vocab.json", d / "tokenizer" / "merges.txt")
        self.embed_dim = int(spec.extra.get("embed_dim", 768))
        self.pad_id = int(spec.extra.get("pad_id", 49407))
        self.prediction = str(spec.extra.get("prediction", "epsilon"))
        self.text_encoder = qnn.get_context(f"{spec.id}:text_encoder", d / "text_encoder.bin")
        self.unet = qnn.get_context(f"{spec.id}:unet", d / "unet.bin")
        self.vae = qnn.get_context(f"{spec.id}:vae", d / "vae.bin")
        # latent geometry from the UNet's declared shapes
        lat_shape = next((s for s in self.unet.input_shapes if len(s) == 4), [1, 64, 64, 4])
        self.latent_shape = tuple(int(x) for x in lat_shape)
        vae_out = self.vae.output_shapes[0] if self.vae.output_shapes else [1, 512, 512, 3]
        self.image_hw = (int(vae_out[1]), int(vae_out[2])) if len(vae_out) == 4 else (512, 512)

    def _encode(self, text: str) -> np.ndarray:
        tokens = self.tok.tokenize(text, pad_id=self.pad_id)
        out = self.text_encoder.run(_by_shape(self.text_encoder, [tokens]))
        emb = next(iter(out.values()))
        return emb.reshape(1, 77, self.embed_dim).astype(np.float32)

    def generate(self, prompt: str, negative: str = "", steps: int = 20, guidance: float = 7.5, seed: int | None = None, progress=None) -> tuple[np.ndarray, dict]:
        t0 = time.time()
        steps = max(1, min(60, int(steps)))
        guidance = float(np.clip(guidance, 1.0, 20.0))
        seed = int(seed) if seed is not None else int(np.random.SeedSequence().entropy % (2**31 - 1))
        rng = np.random.default_rng(seed)
        timings: dict[str, float] = {}
        with qnn.Perf():
            emb_c = self._encode(prompt)
            emb_u = self._encode(negative or "lowres, text, error, cropped, worst quality, low quality, jpeg artifacts, signature, watermark")
            timings["text_encoder_ms"] = (time.time() - t0) * 1000
            sched = EulerScheduler(steps, prediction=self.prediction)
            n, lh, lw, lc = self.latent_shape  # NHWC as the UNet expects
            latents = rng.standard_normal((n, lc, lh, lw)).astype(np.float32) * sched.init_noise_sigma  # keep NCHW between steps
            t_unet = time.time()
            for i, t in enumerate(sched.timesteps):
                ts = np.array([[t]], dtype=np.float32)
                latent_in = np.ascontiguousarray(np.transpose(sched.scale_model_input(latents, i), (0, 2, 3, 1)).astype(np.float32))
                eps_c = next(iter(self.unet.run(_by_shape(self.unet, [latent_in, ts, emb_c])).values())).reshape(self.latent_shape).astype(np.float32)
                eps_u = next(iter(self.unet.run(_by_shape(self.unet, [latent_in, ts, emb_u])).values())).reshape(self.latent_shape).astype(np.float32)
                noise = eps_u + guidance * (eps_c - eps_u)
                latents = sched.step(np.transpose(noise, (0, 3, 1, 2)), i, latents)
                if progress:
                    progress(i + 1, steps)
            timings["unet_ms"] = (time.time() - t_unet) * 1000
            t_vae = time.time()
            latent_out = np.ascontiguousarray(np.transpose(latents, (0, 2, 3, 1)).astype(np.float32))
            img = next(iter(self.vae.run(_by_shape(self.vae, [latent_out])).values())).astype(np.float32)
            timings["vae_ms"] = (time.time() - t_vae) * 1000
        h, w = self.image_hw
        img = np.clip(img.reshape(h, w, -1) * 255.0, 0, 255).astype(np.uint8)  # VAE emits [0,1]
        timings["total_ms"] = (time.time() - t0) * 1000
        timings["seed"] = seed
        return img, timings


_engines: dict[str, StableDiffusion] = {}


def get_engine(model_id: str) -> StableDiffusion:
    spec = MODELS.get(model_id)
    if not spec or spec.feature != "images":
        raise KeyError(f"unknown image model {model_id}")
    if not spec.installed():
        raise FileNotFoundError(f"model {model_id} is not downloaded")
    eng = _engines.get(model_id)
    if eng is None:
        # Only one SD model resident at a time (RAM).
        for k in list(_engines):
            qnn.release_group(f"{k}:")
            _engines.pop(k)
        log(f"loading Stable Diffusion engine {model_id}…")
        eng = StableDiffusion(spec)
        _engines[model_id] = eng
    return eng


def any_installed() -> bool:
    return any(m.installed() for m in MODELS.values() if m.feature == "images")
