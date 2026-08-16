"""Model catalogue: what can be downloaded, from where (all public, no account), and how to detect installs.

Assets are the Qualcomm AI Hub compiled bundles for Snapdragon X Elite (QNN context binaries / DLC), plus the
tokenizer/vocab files those models need. Everything lands under MODELS_DIR/<id>/.
"""
from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from util import MODELS_DIR, Progress, ProgressCb, dir_size, download_url, hf_file, log

S3 = "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models"


@dataclass
class Asset:
    url: str
    filename: str            # saved as MODELS_DIR/<id>/<filename>
    extract: bool = False    # unzip into the model dir
    hf: tuple[str, str] | None = None  # (repo_id, path) alternative to url


@dataclass
class ModelSpec:
    id: str
    feature: str            # images | stt | tts | embeddings
    name: str
    description: str
    runtime: str
    size_bytes: int
    assets: list[Asset]
    required: list[str]     # files (relative to model dir) that must exist to count as installed
    license: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def dir(self) -> Path:
        return MODELS_DIR / self.id

    def installed(self) -> bool:
        return all((self.dir / f).exists() for f in self.required)

    def info(self) -> dict:
        return {
            "id": self.id,
            "feature": self.feature,
            "name": self.name,
            "description": self.description,
            "sizeBytes": self.size_bytes,
            "installed": self.installed(),
            "runtime": self.runtime,
            "license": self.license,
        }


MODELS: dict[str, ModelSpec] = {
    "sd15": ModelSpec(
        id="sd15",
        feature="images",
        name="Stable Diffusion 1.5 (512², w8a16)",
        description="Qualcomm AI Hub build for Snapdragon X Elite. ~5 s per 512×512 image at 20 steps on the NPU. Best all-round choice on 16 GB.",
        runtime="qnn",
        size_bytes=712_142_562 + 1_500_000,
        assets=[
            Asset(f"{S3}/stable_diffusion_v1_5/releases/v0.60.0/stable_diffusion_v1_5-qnn_context_binary-w8a16-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset("", "tokenizer/vocab.json", hf=("stable-diffusion-v1-5/stable-diffusion-v1-5", "tokenizer/vocab.json")),
            Asset("", "tokenizer/merges.txt", hf=("stable-diffusion-v1-5/stable-diffusion-v1-5", "tokenizer/merges.txt")),
        ],
        required=["text_encoder.bin", "unet.bin", "vae.bin", "tokenizer/vocab.json", "tokenizer/merges.txt"],
        license="CreativeML OpenRAIL-M",
        extra={"embed_dim": 768, "pad_id": 49407, "size": 512, "prediction": "epsilon"},
    ),
    "sd21": ModelSpec(
        id="sd21",
        feature="images",
        name="Stable Diffusion 2.1 (512², w8a16)",
        description="Qualcomm AI Hub build for Snapdragon X Elite. ~7 s per 512×512 image at 20 steps. Slightly better prompt adherence than 1.5.",
        runtime="qnn",
        size_bytes=874_927_585 + 1_500_000,
        assets=[
            Asset(f"{S3}/stable_diffusion_v2_1/releases/v0.60.0/stable_diffusion_v2_1-qnn_context_binary-w8a16-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset("", "tokenizer/vocab.json", hf=("sd2-community/stable-diffusion-2-1", "tokenizer/vocab.json")),
            Asset("", "tokenizer/merges.txt", hf=("sd2-community/stable-diffusion-2-1", "tokenizer/merges.txt")),
        ],
        required=["text_encoder.bin", "unet.bin", "vae.bin", "tokenizer/vocab.json", "tokenizer/merges.txt"],
        license="CreativeML OpenRAIL++-M",
        # AI Hub's v2.1 build comes from sd2-community/stable-diffusion-2-1 → v-prediction (Qualcomm reference scheduler)
        extra={"embed_dim": 1024, "pad_id": 49407, "size": 512, "prediction": "v_prediction"},
    ),
    "whisper-tiny": ModelSpec(
        id="whisper-tiny",
        feature="stt",
        name="Whisper tiny (multilingual)",
        description="Fastest speech-to-text on the NPU (~26 ms encoder / 2.4 ms per token). Good for dictation.",
        runtime="qnn",
        size_bytes=105_804_334 + 3_000_000,
        assets=[
            Asset(f"{S3}/whisper_tiny/releases/v0.60.0/whisper_tiny-qnn_context_binary-float-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset(f"{S3}/whisper_asr_shared/v1/openai_assets/mel_filters.npz", "mel_filters.npz"),
            Asset("", "tokenizer.json", hf=("openai/whisper-tiny", "tokenizer.json")),
        ],
        required=["encoder.bin", "decoder.bin", "mel_filters.npz", "tokenizer.json"],
        license="MIT",
        extra={"layers": 4, "heads": 6, "d_model": 384},
    ),
    "whisper-base": ModelSpec(
        id="whisper-base",
        feature="stt",
        name="Whisper base (multilingual)",
        description="Balanced accuracy/speed (~49 ms encoder / 3.7 ms per token). Recommended for dictation.",
        runtime="qnn",
        size_bytes=180_775_815 + 3_000_000,
        assets=[
            Asset(f"{S3}/whisper_base/releases/v0.60.0/whisper_base-qnn_context_binary-float-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset(f"{S3}/whisper_asr_shared/v1/openai_assets/mel_filters.npz", "mel_filters.npz"),
            Asset("", "tokenizer.json", hf=("openai/whisper-base", "tokenizer.json")),
        ],
        required=["encoder.bin", "decoder.bin", "mel_filters.npz", "tokenizer.json"],
        license="MIT",
        extra={"layers": 6, "heads": 8, "d_model": 512},
    ),
    "whisper-small": ModelSpec(
        id="whisper-small",
        feature="stt",
        name="Whisper small (multilingual)",
        description="Most accurate of the three (~133 ms encoder / 10 ms per token). ~570 MB.",
        runtime="qnn",
        size_bytes=572_816_378 + 3_000_000,
        assets=[
            Asset(f"{S3}/whisper_small/releases/v0.60.0/whisper_small-qnn_context_binary-float-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset(f"{S3}/whisper_asr_shared/v1/openai_assets/mel_filters.npz", "mel_filters.npz"),
            Asset("", "tokenizer.json", hf=("openai/whisper-small", "tokenizer.json")),
        ],
        required=["encoder.bin", "decoder.bin", "mel_filters.npz", "tokenizer.json"],
        license="MIT",
        extra={"layers": 12, "heads": 12, "d_model": 768},
    ),
    "piper-en": ModelSpec(
        id="piper-en",
        feature="tts",
        name="Piper TTS (English)",
        description="Neural text-to-speech (VITS) on the NPU, 22.05 kHz. G2P via CMUdict (bundled download).",
        runtime="qnn",
        size_bytes=69_094_096 + 3_700_000,
        assets=[
            Asset(f"{S3}/pipertts_en/releases/v0.60.0/pipertts_en-voice_ai-float-qualcomm_snapdragon_x_elite.zip", "bundle.zip", extract=True),
            Asset("https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict", "cmudict.dict"),
        ],
        required=["encoder.bin", "sdp.bin", "flow.bin", "decoder.bin", "cmudict.dict"],
        license="MIT",
    ),
    "nomic-embed-text": ModelSpec(
        id="nomic-embed-text",
        feature="embeddings",
        name="Nomic Embed Text v1.5",
        description="Text embeddings for local RAG on the NPU (128-token windows, 512-d output, ~9 ms each).",
        runtime="qnn-dlc",
        size_bytes=506_368_345,
        assets=[
            Asset(f"{S3}/nomic_embed_text/releases/v0.60.0/nomic_embed_text-qnn_dlc-float.zip", "bundle.zip", extract=True),
        ],
        required=["nomic_embed_text.dlc", "tokenizer.json"],
        license="Apache-2.0",
    ),
}


def list_models() -> list[dict]:
    return [m.info() for m in MODELS.values()]


def _find_and_flatten(model_dir: Path, wanted: list[str]) -> None:
    """Zips sometimes nest files in a folder; move required files up to model_dir."""
    for req in wanted:
        target = model_dir / req
        if target.exists():
            continue
        name = Path(req).name
        for cand in model_dir.rglob(name):
            if cand.is_file() and cand != target:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(cand), str(target))
                break


def download_model(model_id: str, cb: ProgressCb) -> None:
    spec = MODELS.get(model_id)
    if not spec:
        raise KeyError(f"unknown model {model_id}")
    spec.dir.mkdir(parents=True, exist_ok=True)
    total_assets = len(spec.assets)
    for i, a in enumerate(spec.assets):
        prefix = f"[{i + 1}/{total_assets}] "
        dest = spec.dir / a.filename
        if a.extract:
            if spec.installed():
                continue
        elif dest.exists() and dest.stat().st_size > 0:
            continue

        def relay(p: Progress, _prefix=prefix) -> None:
            # download_url reuses one Progress object across callbacks — only prefix once
            base = p.message or "Downloading"
            if not base.startswith(_prefix):
                p.message = _prefix + base
            cb(p)

        if a.hf:
            hf_file(a.hf[0], a.hf[1], spec.dir if a.filename == a.hf[1] else spec.dir / "_hf", relay)
            src = (spec.dir if a.filename == a.hf[1] else spec.dir / "_hf") / a.hf[1]
            if src != dest:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dest))
        else:
            download_url(a.url, dest, relay)
        if a.extract:
            cb(Progress(message=f"{prefix}Extracting {dest.name}…", file=dest.name))
            with zipfile.ZipFile(dest) as z:
                z.extractall(spec.dir)
            _find_and_flatten(spec.dir, spec.required)
            try:
                dest.unlink()
            except OSError:
                pass
    shutil.rmtree(spec.dir / "_hf", ignore_errors=True)
    if not spec.installed():
        missing = [f for f in spec.required if not (spec.dir / f).exists()]
        raise RuntimeError(f"download finished but files are missing: {missing}")
    cb(Progress(done=True, message="Ready", file=""))


def remove_model(model_id: str) -> None:
    spec = MODELS.get(model_id)
    if spec and spec.dir.exists():
        shutil.rmtree(spec.dir, ignore_errors=True)


def read_metadata(spec: ModelSpec) -> dict:
    p = spec.dir / "metadata.json"
    try:
        return json.loads(p.read_text(encoding="utf8"))
    except Exception:
        return {}
