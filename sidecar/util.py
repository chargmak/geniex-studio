"""Shared helpers: paths, logging, model downloads with progress (Hugging Face Hub + plain URLs)."""
from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

HOME = Path(os.environ.get("GENIEX_SIDECAR_HOME") or (Path.home() / ".geniex-studio" / "sidecar"))
MODELS_DIR = Path(os.environ.get("GENIEX_SIDECAR_MODELS") or (HOME / "models"))
CACHE_DIR = HOME / "cache"
QAIRT_HTP_DIR = os.environ.get("GENIEX_QAIRT_HTP_DIR") or ""

for d in (HOME, MODELS_DIR, CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)


def log(*parts: object) -> None:
    print("[sidecar]", *parts, file=sys.stderr, flush=True)


@dataclass
class Progress:
    downloaded: int = 0
    total: int | None = None
    message: str = ""
    file: str = ""
    done: bool = False
    error: str | None = None

    def as_json(self) -> str:
        p = (self.downloaded / self.total) if self.total else None
        return json.dumps({"type": "error" if self.error else ("done" if self.done else "progress"), "progress": p, "downloaded": self.downloaded, "total": self.total, "message": self.message, "file": self.file, **({"error": self.error} if self.error else {})})


ProgressCb = Callable[[Progress], None]


def download_url(url: str, dest: Path, cb: ProgressCb | None = None, headers: dict | None = None) -> Path:
    """Streamed download with resume support and progress callbacks."""
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    have = tmp.stat().st_size if tmp.exists() else 0
    h = dict(headers or {})
    if have:
        h["Range"] = f"bytes={have}-"
    with requests.get(url, stream=True, headers=h, timeout=60, allow_redirects=True) as r:
        if r.status_code == 416:  # already complete
            tmp.rename(dest)
            return dest
        r.raise_for_status()
        total = r.headers.get("Content-Length")
        total_i = (int(total) + have) if total else None
        mode = "ab" if have and r.status_code == 206 else "wb"
        if mode == "wb":
            have = 0
        prog = Progress(downloaded=have, total=total_i, file=dest.name, message=f"Downloading {dest.name}")
        last = 0.0
        with open(tmp, mode) as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if not chunk:
                    continue
                f.write(chunk)
                prog.downloaded += len(chunk)
                now = time.time()
                if cb and now - last > 0.25:
                    last = now
                    cb(prog)
        if cb:
            cb(prog)
    tmp.rename(dest)
    return dest


def hf_file(repo_id: str, filename: str, dest_dir: Path, cb: ProgressCb | None = None, revision: str = "main") -> Path:
    """Download one file from a public Hugging Face repo into dest_dir/filename (keeps subfolders)."""
    dest = dest_dir / filename
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}"
    token = os.environ.get("HF_TOKEN") or os.environ.get("GENIEX_HFTOKEN")
    headers = {"Authorization": f"Bearer {token}"} if token else None
    return download_url(url, dest, cb, headers)


def hf_list_files(repo_id: str, revision: str = "main") -> list[dict]:
    import requests

    r = requests.get(f"https://huggingface.co/api/models/{repo_id}/tree/{revision}?recursive=true", timeout=30)
    r.raise_for_status()
    return [x for x in r.json() if x.get("type") == "file"]


def dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


class Lock:
    """Only one heavy job at a time (the NPU/QNN contexts are not thread-safe and RAM is finite)."""

    def __init__(self) -> None:
        self._l = threading.Lock()

    def __enter__(self):
        if not self._l.acquire(timeout=0.01):
            raise BusyError("another job is running on the NPU sidecar")
        return self

    def __exit__(self, *a):
        self._l.release()


class BusyError(RuntimeError):
    pass


NPU_LOCK = Lock()
