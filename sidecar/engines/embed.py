"""nomic-embed-text v1.5 embeddings on the Hexagon NPU (Qualcomm AI Hub QNN DLC, 128-token windows → 512-d)."""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from engines import qnn
from registry import MODELS, ModelSpec
from util import log

MAX_TOKENS = 128


class EmbedEngine:
    def __init__(self, spec: ModelSpec):
        from tokenizers import Tokenizer

        self.spec = spec
        d = spec.dir
        self.tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        try:
            self.tok.enable_truncation(MAX_TOKENS)
            self.tok.enable_padding(length=MAX_TOKENS, pad_id=self.tok.token_to_id("[PAD]") or 0, pad_token="[PAD]")
        except Exception:
            pass
        self.ctx = qnn.get_context(f"{spec.id}:model", d / "nomic_embed_text.dlc")
        self.dims = int(self.ctx.output_shapes[0][-1]) if self.ctx.output_shapes else 512
        log(f"embeddings: {self.dims}-d, inputs {self.ctx.input_names}")

    def embed(self, texts: list[str], prefix: str = "search_document: ") -> np.ndarray:
        out = np.zeros((len(texts), self.dims), dtype=np.float32)
        ids_name = next((n for n in self.ctx.input_names if "token" in n or "ids" in n), self.ctx.input_names[0])
        mask_name = next((n for n in self.ctx.input_names if "mask" in n), self.ctx.input_names[-1])
        with qnn.Perf():
            for i, t in enumerate(texts):
                enc = self.tok.encode((prefix + t) if prefix and not t.startswith(("search_document:", "search_query:")) else t)
                ids = np.array(enc.ids[:MAX_TOKENS], dtype=np.int32)
                mask = np.array(enc.attention_mask[:MAX_TOKENS], dtype=np.int32)
                if len(ids) < MAX_TOKENS:
                    ids = np.pad(ids, (0, MAX_TOKENS - len(ids)))
                    mask = np.pad(mask, (0, MAX_TOKENS - len(mask)))
                res = self.ctx.run({ids_name: ids.reshape(1, MAX_TOKENS), mask_name: mask.reshape(1, MAX_TOKENS)})
                v = np.asarray(next(iter(res.values())), dtype=np.float32).reshape(-1)[: self.dims]
                n = float(np.linalg.norm(v))
                out[i] = v / n if n > 0 else v
        return out


_engine: EmbedEngine | None = None


def get_engine(model_id: str | None = None) -> EmbedEngine:
    global _engine
    spec = MODELS.get(model_id or "nomic-embed-text")
    if not spec or spec.feature != "embeddings":
        raise KeyError(f"unknown embedding model {model_id}")
    if not spec.installed():
        raise FileNotFoundError("embedding model is not downloaded")
    if _engine is None:
        _engine = EmbedEngine(spec)
    return _engine


def any_installed() -> bool:
    return any(m.installed() for m in MODELS.values() if m.feature == "embeddings")
