"""Thin wrapper over Qualcomm AI AppBuilder (qai_appbuilder) QNN contexts.

- The wheel bundles the QAIRT HTP runtime (Windows arm64), so nothing needs to be installed system-wide.
- QNNConfig.Config() must run once per process before any context is created.
- Contexts are process-global C++ handles; keep them cached and reuse across requests.
- `NamedContext` orders inputs/outputs by the names baked into the context binary, so we don't depend on
  positional order assumptions.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import numpy as np

from util import log

_configured = False
_lock = threading.Lock()
_available: bool | None = None
_import_error: str | None = None


def available() -> bool:
    global _available, _import_error
    if _available is None:
        try:
            import qai_appbuilder  # noqa: F401

            _available = True
        except Exception as e:  # pragma: no cover
            _available = False
            _import_error = f"{type(e).__name__}: {e}"
            log("qai_appbuilder unavailable:", _import_error)
    return _available


def import_error() -> str | None:
    available()
    return _import_error


def qairt_version() -> str | None:
    try:
        import qai_appbuilder

        return getattr(qai_appbuilder, "__version__", None)
    except Exception:
        return None


def configure() -> None:
    """Idempotent QNNConfig.Config(HTP)."""
    global _configured
    with _lock:
        if _configured:
            return
        from qai_appbuilder import LogLevel, ProfilingLevel, QNNConfig, Runtime

        QNNConfig.Config(Runtime.HTP, LogLevel.ERROR, ProfilingLevel.OFF)
        _configured = True
        log("QNN configured (HTP)")


class NamedContext:
    """QNNContext with name-ordered I/O and dtype coercion."""

    def __init__(self, name: str, path: str | Path, native: bool = False):
        configure()
        from qai_appbuilder import DataType, QNNContext

        dt = DataType.NATIVE if native else DataType.FLOAT
        self.name = name
        self.path = str(path)
        self.native = native
        self.ctx = QNNContext(name, self.path, input_data_type=dt, output_data_type=dt)
        self.input_names: list[str] = list(self.ctx.getInputName())
        self.output_names: list[str] = list(self.ctx.getOutputName())
        self.input_shapes: list[list[int]] = [list(s) for s in self.ctx.getInputShapes()]
        self.output_shapes: list[list[int]] = [list(s) for s in self.ctx.getOutputShapes()]
        try:
            self.input_dtypes = [str(t) for t in self.ctx.getInputDataType()]
            self.output_dtypes = [str(t) for t in self.ctx.getOutputDataType()]
        except Exception:
            self.input_dtypes = []
            self.output_dtypes = []
        log(f"loaded {name}: inputs={list(zip(self.input_names, self.input_shapes, self.input_dtypes))} outputs={list(zip(self.output_names, self.output_shapes, self.output_dtypes))}")

    @staticmethod
    def _np_dtype(qnn_dtype: str, default: Any) -> Any:
        s = qnn_dtype.lower()
        if "float16" in s or "fp16" in s or "half" in s:
            return np.float16
        if "float32" in s or s == "float":
            return np.float32
        if "int32" in s:
            return np.int32
        if "int64" in s:
            return np.int64
        if "uint16" in s:
            return np.uint16
        if "uint8" in s:
            return np.uint8
        if "int8" in s:
            return np.int8
        if "bool" in s:
            return np.bool_
        return default

    def run(self, inputs: dict[str, np.ndarray], perf: str = "burst") -> dict[str, np.ndarray]:
        """Run with inputs keyed by name; returns outputs keyed by name (reshaped to declared shapes)."""
        arrays: list[np.ndarray] = []
        for i, n in enumerate(self.input_names):
            if n not in inputs:
                # tolerate name mismatches by position when counts line up
                key = list(inputs.keys())[i] if len(inputs) == len(self.input_names) else None
                if key is None:
                    raise KeyError(f"{self.name}: missing input '{n}' (have {list(inputs)})")
                a = inputs[key]
            else:
                a = inputs[n]
            a = np.ascontiguousarray(a)
            declared = self._np_dtype(self.input_dtypes[i], None) if i < len(self.input_dtypes) else None
            if self.native and declared is not None:
                a = a.astype(declared, copy=False)
            elif not self.native:
                # FLOAT mode: float tensors are fed as float32 (AppBuilder quantises internally), but tensors the
                # binary declares as integer (token / phoneme ids, lengths, masks) must stay integer — AppBuilder
                # copies their bytes verbatim, so a float32 cast would feed reinterpreted garbage ids.
                if declared is not None and np.issubdtype(declared, np.integer):
                    a = a.astype(declared, copy=False)
                elif declared is not None and declared == np.bool_:
                    a = a.astype(np.bool_, copy=False)
                else:
                    a = a.astype(np.float32, copy=False)
            arrays.append(a.reshape(-1))
        outs = self.ctx.Inference(arrays)
        result: dict[str, np.ndarray] = {}
        for i, n in enumerate(self.output_names):
            o = np.asarray(outs[i])
            shape = self.output_shapes[i] if i < len(self.output_shapes) else None
            if shape and int(np.prod(shape)) == o.size:
                o = o.reshape(shape)
            result[n] = o
        return result

    def release(self) -> None:
        try:
            self.ctx.release()
        except Exception:
            pass


class Perf:
    """Context manager: burst clocks during a job."""

    def __enter__(self):
        try:
            from qai_appbuilder import PerfProfile

            PerfProfile.SetPerfProfileGlobal(PerfProfile.BURST)
        except Exception:
            pass
        return self

    def __exit__(self, *a):
        try:
            from qai_appbuilder import PerfProfile

            PerfProfile.RelPerfProfileGlobal()
        except Exception:
            pass


_cache: dict[str, NamedContext] = {}
_cache_lock = threading.Lock()


def get_context(key: str, path: str | Path, native: bool = False) -> NamedContext:
    with _cache_lock:
        c = _cache.get(key)
        if c is None or c.path != str(path):
            if c is not None:
                c.release()
            c = NamedContext(key, path, native=native)
            _cache[key] = c
        return c


def release_group(prefix: str) -> None:
    with _cache_lock:
        for k in [k for k in _cache if k.startswith(prefix)]:
            _cache.pop(k).release()
