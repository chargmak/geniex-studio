"""Piper TTS (VITS, English) on the Hexagon NPU via Qualcomm AI Hub QNN context binaries.

Port of qai-appbuilder samples/models/audio/audio_generation/pipertts_en (encoder → SDP → flow → HiFi-GAN decoder
in 64-frame windows). G2P: the sample uses gruut (needs python-crfsuite, no win_arm64 wheel), so we do
CMUdict → ARPAbet → espeak-style IPA → Piper phoneme ids ourselves. Numbers are spelled out; unknown words fall
back to letter-by-letter spelling.
"""
from __future__ import annotations

import io
import re
import time
from pathlib import Path

import numpy as np

from engines import qnn
from registry import MODELS, ModelSpec
from util import log

SAMPLE_RATE = 22050
ENC_TEXT_MAX = 512
FLOW_T_MEL = 1536
FEAT_DIM = 192
UPSAMPLE = 256
DEC_OVERLAP = 12
MAX_DEC = 40
DEC_SEQ = MAX_DEC + 2 * DEC_OVERLAP  # 64

# fmt: off
PIPER_IDS: dict[str, int] = {
    '_': 0, '^': 1, '$': 2, ' ': 3, '!': 4, "'": 5, '(': 6, ')': 7, ',': 8, '-': 9, '.': 10, ':': 11, ';': 12, '?': 13,
    'a': 14, 'b': 15, 'c': 16, 'd': 17, 'e': 18, 'f': 19, 'h': 20, 'i': 21, 'j': 22, 'k': 23, 'l': 24, 'm': 25, 'n': 26,
    'o': 27, 'p': 28, 'q': 29, 'r': 30, 's': 31, 't': 32, 'u': 33, 'v': 34, 'w': 35, 'x': 36, 'y': 37, 'z': 38,
    'æ': 39, 'ç': 40, 'ð': 41, 'ø': 42, 'ħ': 43, 'ŋ': 44, 'œ': 45, 'ǀ': 46,
    'ǁ': 47, 'ǂ': 48, 'ǃ': 49, 'ɐ': 50, 'ɑ': 51, 'ɒ': 52, 'ɓ': 53, 'ɔ': 54,
    'ɕ': 55, 'ɖ': 56, 'ɗ': 57, 'ɘ': 58, 'ə': 59, 'ɚ': 60, 'ɛ': 61, 'ɜ': 62,
    'ɞ': 63, 'ɟ': 64, 'ɠ': 65, 'ɡ': 66, 'ɢ': 67, 'ɣ': 68, 'ɤ': 69, 'ɥ': 70,
    'ɦ': 71, 'ɧ': 72, 'ɨ': 73, 'ɪ': 74, 'ɫ': 75, 'ɬ': 76, 'ɭ': 77, 'ɮ': 78,
    'ɯ': 79, 'ɰ': 80, 'ɱ': 81, 'ɲ': 82, 'ɳ': 83, 'ɴ': 84, 'ɵ': 85, 'ɶ': 86,
    'ɸ': 87, 'ɹ': 88, 'ɺ': 89, 'ɻ': 90, 'ɽ': 91, 'ɾ': 92, 'ʀ': 93, 'ʁ': 94,
    'ʂ': 95, 'ʃ': 96, 'ʄ': 97, 'ʈ': 98, 'ʉ': 99, 'ʊ': 100, 'ʋ': 101, 'ʌ': 102,
    'ʍ': 103, 'ʎ': 104, 'ʏ': 105, 'ʐ': 106, 'ʑ': 107, 'ʒ': 108, 'ʔ': 109, 'ʕ': 110,
    'ʘ': 111, 'ʙ': 112, 'ʛ': 113, 'ʜ': 114, 'ʝ': 115, 'ʟ': 116, 'ʡ': 117, 'ʢ': 118,
    'ʲ': 119, 'ˈ': 120, 'ˌ': 121, 'ː': 122, 'ˑ': 123, '˞': 124, 'β': 125, 'θ': 126,
    'χ': 127, 'ᵋ': 128, 'ⱱ': 129, '0': 130, '1': 131, '2': 132, '3': 133, '4': 134, '5': 135, '6': 136,
    '7': 137, '8': 138, '9': 139, '̧': 140, '̃': 141, '̪': 142, '̯': 143, '̩': 144, 'ʰ': 145,
    'ˤ': 146, 'ε': 147, '↓': 148, '#': 149, '"': 150, '↑': 151, '̺': 152, '̻': 153,
}
# ARPAbet → espeak-ng style IPA (as Piper en_US voices were trained on)
ARPA_IPA: dict[str, str] = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "B": "b", "CH": "tʃ", "D": "d", "DH": "ð",
    "EH": "ɛ", "ER": "ɚ", "EY": "eɪ", "F": "f", "G": "ɡ", "HH": "h", "IH": "ɪ", "IY": "i", "JH": "dʒ", "K": "k",
    "L": "l", "M": "m", "N": "n", "NG": "ŋ", "OW": "oʊ", "OY": "ɔɪ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "UH": "ʊ", "UW": "u", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
# fmt: on
# Letter names for spelling acronyms / unknown words (cmudict's first entry for "a" is the article ə, not the letter)
LETTER_NAMES: dict[str, list[str]] = {
    "a": ["EY1"], "b": ["B", "IY1"], "c": ["S", "IY1"], "d": ["D", "IY1"], "e": ["IY1"], "f": ["EH1", "F"], "g": ["JH", "IY1"],
    "h": ["EY1", "CH"], "i": ["AY1"], "j": ["JH", "EY1"], "k": ["K", "EY1"], "l": ["EH1", "L"], "m": ["EH1", "M"], "n": ["EH1", "N"],
    "o": ["OW1"], "p": ["P", "IY1"], "q": ["K", "Y", "UW1"], "r": ["AA1", "R"], "s": ["EH1", "S"], "t": ["T", "IY1"], "u": ["Y", "UW1"],
    "v": ["V", "IY1"], "w": ["D", "AH1", "B", "AH0", "L", "Y", "UW0"], "x": ["EH1", "K", "S"], "y": ["W", "AY1"], "z": ["Z", "IY1"],
}
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
PUNCT_IDS = {",": 8, ".": 10, "?": 13, "!": 4, ":": 11, ";": 12}

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def num_to_words(n: int) -> str:
    if n < 0:
        return "minus " + num_to_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + num_to_words(n % 100))
    for div, name in ((10**9, "billion"), (10**6, "million"), (10**3, "thousand")):
        if n >= div:
            return num_to_words(n // div) + " " + name + ("" if n % div == 0 else " " + num_to_words(n % div))
    return str(n)


class CmuDict:
    def __init__(self, path: Path):
        self.d: dict[str, list[str]] = {}
        for line in path.read_text(encoding="utf8", errors="ignore").splitlines():
            if not line or line.startswith(";;;"):
                continue
            line = line.split("#", 1)[0].strip()
            parts = line.split()
            if len(parts) < 2:
                continue
            w = parts[0].lower()
            w = re.sub(r"\(\d+\)$", "", w)
            if w not in self.d:
                self.d[w] = parts[1:]

    def lookup(self, word: str) -> list[str] | None:
        w = word.lower()
        if w in self.d:
            return self.d[w]
        # simple morphology fallbacks
        for suf, add in (("'s", ["Z"]), ("s", ["Z"]), ("ed", ["D"]), ("ing", ["IH0", "NG"])):
            if w.endswith(suf) and w[: -len(suf)] in self.d and len(w) > len(suf) + 2:
                return self.d[w[: -len(suf)]] + add
        return None


def arpa_to_ipa(phones: list[str]) -> str:
    out: list[str] = []
    for p in phones:
        m = re.match(r"([A-Z]+)(\d)?$", p)
        if not m:
            continue
        base, stress = m.group(1), m.group(2)
        ipa = ARPA_IPA.get(base)
        if ipa is None:
            continue
        if base in VOWELS:
            if base == "AH" and stress == "0":
                ipa = "ə"
            if base == "ER" and stress in ("1", "2"):
                ipa = "ɜː"
            if base in ("IY", "UW", "AA", "AO") and stress in ("1", "2"):
                ipa = ipa + "ː"
            if stress == "1":
                out.append("ˈ")
            elif stress == "2":
                out.append("ˌ")
        out.append(ipa)
    return "".join(out)


class G2P:
    def __init__(self, cmu: CmuDict):
        self.cmu = cmu

    def _spell(self, word: str) -> str:
        return " ".join(arpa_to_ipa(LETTER_NAMES[ch]) for ch in word.lower() if ch in LETTER_NAMES)

    def word_ipa(self, word: str) -> str:
        raw = word.strip("'\"")
        w = raw.lower()
        if not w:
            return ""
        if w.isdigit():
            return " ".join(self.word_ipa(x) for x in num_to_words(int(w[:12])).split())
        if "-" in w:
            return " ".join(self.word_ipa(x) for x in w.split("-") if x)
        # mixed letters/digits ("X1E80100", "3D", "mp4") → letter runs + number runs
        if any(c.isdigit() for c in w) and any(c.isalpha() for c in w):
            return " ".join(self.word_ipa(x) for x in re.findall(r"[A-Za-z]+|\d+", raw))
        # acronyms: 2–3 capitals are always spelled (AI, NPU, CPU, API); longer ones only if not a dictionary word (NASA vs HDMI)
        if raw.isupper() and raw.isalpha() and (len(raw) <= 3 or self.cmu.lookup(w) is None):
            return self._spell(raw)
        # camelCase / PascalCase product names ("GenieX", "PowerShell") → parts
        if raw not in (raw.lower(), raw.upper(), raw.capitalize()) and self.cmu.lookup(w) is None:
            parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+", raw)
            if len(parts) > 1:
                return " ".join(self.word_ipa(p) for p in parts)
        ph = self.cmu.lookup(w)
        if ph is None and "'" in w:
            ph = self.cmu.lookup(w.replace("'", ""))
        if ph is None:
            return self._spell(w)  # unknown word: spell it out letter by letter
        return arpa_to_ipa(ph) if ph else ""

    def text_to_ids(self, text: str) -> np.ndarray:
        text = text.replace("’", "'").replace("“", '"').replace("”", '"')
        text = re.sub(r"(\d),(\d)", r"\1\2", text)  # 1,000 → 1000
        text = re.sub(r"(\d)\.(\d)", r"\1 point \2", text)
        tokens = re.findall(r"[A-Za-z0-9']+|[,.?!:;]", text)
        phonemes: list[int] = []
        prev_word = False
        for tok in tokens:
            if tok in PUNCT_IDS:
                # espeak/piper attach punctuation directly to the preceding word ("wˈɜːld." not "wˈɜːld .")
                phonemes.append(PUNCT_IDS[tok])
                phonemes.append(PIPER_IDS[" "])
                prev_word = False
                continue
            ipa = self.word_ipa(tok)
            if not ipa:
                continue
            if prev_word:
                phonemes.append(PIPER_IDS[" "])
            for ch in ipa:
                if ch == " ":
                    phonemes.append(PIPER_IDS[" "])
                elif ch in PIPER_IDS:
                    phonemes.append(PIPER_IDS[ch])
            prev_word = True
        while phonemes and phonemes[-1] == PIPER_IDS[" "]:
            phonemes.pop()
        # piper-phonemize's phoneme_ids_espeak(): BOS, PAD, then every phoneme followed by PAD, then EOS.
        # The voice was trained on this interleaved-PAD layout — without the pads the output is slurred/unintelligible.
        pad = PIPER_IDS["_"]
        ids: list[int] = [PIPER_IDS["^"], pad]
        for p in phonemes:
            ids.append(p)
            ids.append(pad)
        ids.append(PIPER_IDS["$"])
        return np.array(ids[:ENC_TEXT_MAX], dtype=np.int32)


class PiperEngine:
    def __init__(self, spec: ModelSpec):
        self.spec = spec
        d = spec.dir
        self.g2p = G2P(CmuDict(d / "cmudict.dict"))
        self.enc = qnn.get_context(f"{spec.id}:encoder", d / "encoder.bin")
        self.sdp = qnn.get_context(f"{spec.id}:sdp", d / "sdp.bin")
        self.flow = qnn.get_context(f"{spec.id}:flow", d / "flow.bin")
        self.dec = qnn.get_context(f"{spec.id}:decoder", d / "decoder.bin")

    def _run(self, ctx: qnn.NamedContext, arrays: list[np.ndarray]) -> list[np.ndarray]:
        feed = {n: a for n, a in zip(ctx.input_names, arrays)}
        out = ctx.run(feed)
        return [out[n] for n in ctx.output_names]

    def _sentence(self, ids: np.ndarray, noise_scale=0.667, noise_scale_w=0.8, length_scale=1.0) -> np.ndarray:
        n = len(ids)
        x = np.zeros((1, ENC_TEXT_MAX), dtype=np.int32)
        x[0, :n] = ids
        m_p, logs_p, x_enc, x_mask = self._run(self.enc, [x, np.array([n], dtype=np.int32)])
        y_lengths, w_ceil = self._run(self.sdp, [x_enc, x_mask, np.array([noise_scale_w], np.float32), np.array([length_scale], np.float32)])
        durs = np.clip(np.round(np.asarray(w_ceil).reshape(-1)[:n]).astype(np.int32), 0, None)
        y_len = min(int(np.asarray(y_lengths).reshape(-1)[0]), FLOW_T_MEL)
        attn = np.zeros((FLOW_T_MEL, ENC_TEXT_MAX), dtype=np.float32)
        t = 0
        for i, dcount in enumerate(durs):
            for _ in range(int(dcount)):
                if t >= y_len:
                    break
                attn[t, i] = 1.0
                t += 1
            if t >= y_len:
                break
        y_mask = np.zeros((1, 1, FLOW_T_MEL), dtype=np.float32)
        y_mask[0, 0, :y_len] = 1.0
        z = self._run(self.flow, [attn[None], m_p, logs_p, np.array([noise_scale], np.float32), y_mask])[0].reshape(1, FEAT_DIM, FLOW_T_MEL)
        # HiFi-GAN in overlapping windows
        chunks: list[np.ndarray] = []
        buf = np.zeros((1, FEAT_DIM, DEC_SEQ), dtype=np.float32)
        first_end = min(MAX_DEC + DEC_OVERLAP, z.shape[2])
        buf[0, :, :first_end] = z[0, :, :first_end]
        audio = self._run(self.dec, [buf])[0].reshape(-1)
        chunks.append(audio[: MAX_DEC * UPSAMPLE])
        done = MAX_DEC
        while done < y_len:
            s, e = done - DEC_OVERLAP, done + MAX_DEC + DEC_OVERLAP
            zs = z[:, :, s : min(e, z.shape[2])]
            if zs.shape[2] < DEC_SEQ:
                zs = np.pad(zs, ((0, 0), (0, 0), (0, DEC_SEQ - zs.shape[2])))
            audio = self._run(self.dec, [np.ascontiguousarray(zs, dtype=np.float32)])[0].reshape(-1)
            frames = min(MAX_DEC, y_len - done)
            chunks.append(audio[DEC_OVERLAP * UPSAMPLE : (DEC_OVERLAP + frames) * UPSAMPLE])
            done += frames
        out = np.concatenate(chunks)[: y_len * UPSAMPLE]
        return out.astype(np.float32)

    def synthesize(self, text: str, speed: float = 1.0) -> tuple[bytes, dict]:
        t0 = time.time()
        # split into sentences to keep sequences short and add small pauses
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
        # keep every chunk well inside the encoder's 512-id window (~2 ids per phoneme with interleaved pads):
        # split long sentences at clause punctuation, then at ~24-word boundaries.
        chunks: list[str] = []
        for s in sentences:
            if len(s.split()) <= 24:
                chunks.append(s)
                continue
            clause = ""
            for part in re.split(r"(?<=[,;:])\s+", s):
                words = part.split()
                while len(words) > 24:
                    chunks.append(" ".join(words[:24]))
                    words = words[24:]
                part = " ".join(words)
                if clause and len((clause + " " + part).split()) > 24:
                    chunks.append(clause)
                    clause = part
                else:
                    clause = (clause + " " + part).strip()
            if clause:
                chunks.append(clause)
        pieces: list[np.ndarray] = []
        with qnn.Perf():
            for s in chunks[:200]:
                ids = self.g2p.text_to_ids(s)
                if len(ids) <= 3:
                    continue
                pieces.append(self._sentence(ids, length_scale=float(np.clip(1.0 / max(0.25, speed), 0.5, 2.0))))
                pieces.append(np.zeros(int(0.15 * SAMPLE_RATE), dtype=np.float32))
        audio = np.concatenate(pieces) if pieces else np.zeros(SAMPLE_RATE // 4, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size else 1.0
        if peak > 0:
            audio = audio / peak * 0.95
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return buf.getvalue(), {"durationMs": (time.time() - t0) * 1000, "audioSeconds": len(audio) / SAMPLE_RATE, "sentences": len(sentences)}


_engine: PiperEngine | None = None


def get_engine(model_id: str | None = None) -> PiperEngine:
    global _engine
    spec = MODELS.get(model_id or "piper-en")
    if not spec or spec.feature != "tts":
        raise KeyError(f"unknown TTS model {model_id}")
    if not spec.installed():
        raise FileNotFoundError("Piper voice is not downloaded")
    if _engine is None:
        _engine = PiperEngine(spec)
    return _engine


def any_installed() -> bool:
    return any(m.installed() for m in MODELS.values() if m.feature == "tts")
