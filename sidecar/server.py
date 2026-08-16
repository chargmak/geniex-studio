"""GenieX Studio — NPU media sidecar (FastAPI).

OpenAI-shaped endpoints backed by Qualcomm AI Hub models running on the Hexagon NPU through QAI AppBuilder:
  POST /v1/images/generations   (Stable Diffusion 1.5 / 2.1)
  POST /v1/audio/transcriptions (Whisper tiny/base/small)
  POST /v1/audio/speech         (Piper TTS)
  POST /v1/embeddings           (nomic-embed-text)
plus /health, /models, /models/{id}/download (NDJSON progress), DELETE /models/{id}.
Started by the Electron main process: `python -m uvicorn server:app --host 127.0.0.1 --port 18195`.
"""
from __future__ import annotations

import base64
import io
import json
import platform
import queue
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse, Response, StreamingResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import registry  # noqa: E402
from engines import qnn  # noqa: E402
from util import HOME, MODELS_DIR, NPU_LOCK, BusyError, Progress, log  # noqa: E402

VERSION = "0.1.0"
app = FastAPI(title="GenieX Studio NPU sidecar", version=VERSION, docs_url="/docs")


def _features() -> dict[str, bool]:
    from engines import embed, sd, tts, whisper

    ok = qnn.available()
    return {
        "images": ok and sd.any_installed(),
        "stt": ok and whisper.any_installed(),
        "tts": ok and tts.any_installed(),
        "embeddings": ok and embed.any_installed(),
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": VERSION,
        "python": platform.python_version(),
        "arch": platform.machine(),
        "qairt": qnn.qairt_version(),
        "runtimeAvailable": qnn.available(),
        "runtimeError": qnn.import_error(),
        "features": _features(),
        "modelsDir": str(MODELS_DIR),
        "home": str(HOME),
    }


@app.get("/models")
def models() -> dict[str, Any]:
    return {"models": registry.list_models()}


@app.post("/models/{model_id}/download")
def download(model_id: str) -> StreamingResponse:
    if model_id not in registry.MODELS:
        raise HTTPException(404, f"unknown model {model_id}")
    q: queue.Queue[str | None] = queue.Queue()

    def cb(p: Progress) -> None:
        q.put(p.as_json())

    def worker() -> None:
        try:
            registry.download_model(model_id, cb)
        except Exception as e:  # noqa: BLE001
            log("download failed:", traceback.format_exc())
            q.put(json.dumps({"type": "error", "message": f"{type(e).__name__}: {e}"}))
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def gen():
        while True:
            item = q.get()
            if item is None:
                break
            yield item + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.delete("/models/{model_id}")
def delete_model(model_id: str) -> dict[str, Any]:
    if model_id not in registry.MODELS:
        raise HTTPException(404, f"unknown model {model_id}")
    for prefix in (f"{model_id}:",):
        qnn.release_group(prefix)
    registry.remove_model(model_id)
    return {"ok": True}


# ----------------------------------------------------------------------------- images


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: str | None = ""
    model: str | None = None
    size: str = "512x512"
    steps: int = Field(20, ge=1, le=60)
    guidance_scale: float = Field(7.5, ge=1.0, le=20.0)
    seed: int | None = None
    n: int = Field(1, ge=1, le=4)
    response_format: str = "b64_json"


@app.post("/v1/images/generations")
def images(req: ImageRequest) -> JSONResponse:
    from PIL import Image

    from engines import sd

    if not qnn.available():
        raise HTTPException(503, f"NPU runtime unavailable: {qnn.import_error()}")
    model_id = req.model or next((m.id for m in registry.MODELS.values() if m.feature == "images" and m.installed()), None)
    if not model_id:
        raise HTTPException(409, "No image model downloaded. Download Stable Diffusion 1.5 or 2.1 first.")
    try:
        with NPU_LOCK:
            eng = sd.get_engine(model_id)
            data = []
            base_seed = req.seed
            for i in range(req.n):
                seed = (base_seed + i) if base_seed is not None else None
                img, timings = eng.generate(req.prompt, req.negative_prompt or "", steps=req.steps, guidance=req.guidance_scale, seed=seed)
                buf = io.BytesIO()
                Image.fromarray(img, "RGB").save(buf, format="PNG")
                data.append({"b64_json": base64.b64encode(buf.getvalue()).decode("ascii"), "seed": timings.get("seed"), "width": img.shape[1], "height": img.shape[0], "timings": timings})
        return JSONResponse({"created": int(time.time()), "model": model_id, "data": data, "timings": data[-1]["timings"] if data else {}})
    except BusyError as e:
        raise HTTPException(429, str(e))
    except FileNotFoundError as e:
        raise HTTPException(409, str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log("image generation failed:", traceback.format_exc())
        raise HTTPException(500, f"{type(e).__name__}: {e}")


# ----------------------------------------------------------------------------- audio


@app.post("/v1/audio/transcriptions")
async def transcriptions(file: UploadFile = File(...), model: str | None = Form(None), language: str | None = Form(None)) -> JSONResponse:
    from engines import whisper

    if not qnn.available():
        raise HTTPException(503, f"NPU runtime unavailable: {qnn.import_error()}")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty audio")
    try:
        with NPU_LOCK:
            eng = whisper.get_engine(model)
            res = eng.transcribe(data, file.filename or "audio.wav", language=language)
        return JSONResponse(res)
    except BusyError as e:
        raise HTTPException(429, str(e))
    except FileNotFoundError as e:
        raise HTTPException(409, str(e))
    except Exception as e:  # noqa: BLE001
        log("transcription failed:", traceback.format_exc())
        raise HTTPException(500, f"{type(e).__name__}: {e}")


class SpeechRequest(BaseModel):
    input: str
    voice: str | None = None
    model: str | None = None
    speed: float = 1.0
    response_format: str = "wav"


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    from engines import tts

    if not qnn.available():
        raise HTTPException(503, f"NPU runtime unavailable: {qnn.import_error()}")
    if not req.input.strip():
        raise HTTPException(400, "input is empty")
    try:
        with NPU_LOCK:
            eng = tts.get_engine(req.model)
            wav, meta = eng.synthesize(req.input[:5000], speed=req.speed)
        return Response(content=wav, media_type="audio/wav", headers={"X-Sidecar-Duration-Ms": str(int(meta["durationMs"]))})
    except BusyError as e:
        raise HTTPException(429, str(e))
    except FileNotFoundError as e:
        raise HTTPException(409, str(e))
    except Exception as e:  # noqa: BLE001
        log("tts failed:", traceback.format_exc())
        raise HTTPException(500, f"{type(e).__name__}: {e}")


# ----------------------------------------------------------------------------- embeddings


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str | None = None
    kind: str = "document"  # document | query (nomic task prefixes)


@app.post("/v1/embeddings")
def embeddings(req: EmbeddingRequest) -> JSONResponse:
    from engines import embed

    if not qnn.available():
        raise HTTPException(503, f"NPU runtime unavailable: {qnn.import_error()}")
    texts = [req.input] if isinstance(req.input, str) else list(req.input)
    if not texts:
        raise HTTPException(400, "input is empty")
    if len(texts) > 256:
        raise HTTPException(400, "max 256 inputs per request")
    try:
        with NPU_LOCK:
            eng = embed.get_engine(req.model)
            t0 = time.time()
            vecs = eng.embed(texts, prefix="search_query: " if req.kind == "query" else "search_document: ")
        return JSONResponse({"object": "list", "model": eng.spec.id, "dims": int(vecs.shape[1]), "data": [{"object": "embedding", "index": i, "embedding": v.tolist()} for i, v in enumerate(vecs)], "durationMs": (time.time() - t0) * 1000})
    except BusyError as e:
        raise HTTPException(429, str(e))
    except FileNotFoundError as e:
        raise HTTPException(409, str(e))
    except Exception as e:  # noqa: BLE001
        log("embeddings failed:", traceback.format_exc())
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@app.on_event("startup")
def _startup() -> None:
    log(f"sidecar {VERSION} starting — python {platform.python_version()} {platform.machine()}, models at {MODELS_DIR}, runtime available={qnn.available()}")
