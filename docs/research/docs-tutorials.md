# GenieX docs — "Tutorials & Resources" section: exhaustive notes

Source pages (all fetched verbatim as raw markdown via the `.md` suffix; the docs are a Mintlify site and every page is available as `<url>.md`; full index at `https://geniex.aihub.qualcomm.com/llms.txt`):

1. `https://geniex.aihub.qualcomm.com/en/tutorials/speculative-decoding-mtp`
2. `https://geniex.aihub.qualcomm.com/en/tutorials/audio-input`
3. `https://geniex.aihub.qualcomm.com/en/resources/faq`
4. `https://geniex.aihub.qualcomm.com/en/resources/troubleshooting`

`llms.txt` confirms these are the ONLY four pages in Tutorials & Resources (the rest of the docs = get-started/what-is-geniex, get-started/quickstart, get-started/platforms, models/supported, run/cli/{install,quickstart,local-server,reference}, run/python/{install,quickstart,api-reference}, run/linux/install, run/android/{install,quickstart,api-reference}). Optional links: GitHub `https://github.com/qualcomm/GenieX`, Website `https://aihub.qualcomm.com/`, Slack `https://aihub.qualcomm.com/community/slack`.

Cross-checked against the locally installed CLI v0.4.0 (`geniex infer --help --skip-update`, `geniex serve --help --skip-update`, `geniex --help --skip-update`) — see section 5 at the end.

---

## 1. Speculative decoding with MTP (`/en/tutorials/speculative-decoding-mtp`)

Subtitle: "Speed up decoding with a Multi-Token Prediction draft model, in the GenieX CLI and the local server."

### Concept (as stated by docs)
- Speculative decoding "speeds up a large model without changing what it produces." A cheap **draft** proposes several tokens ahead; the large **target** verifies them all in one forward pass; accepted prefix committed at once. Verification costs one pass regardless of how many tokens; "accepted tokens after the first are nearly free — and the output stays identical to what the target would have generated alone."
- **MTP (Multi-Token Prediction)** = "the strongest variant": prediction heads trained *alongside* the target that read the target's own hidden states, so proposals come from the same distribution the target samples from (vs. a separately-trained small draft model whose guesses drift).

### Hard constraints (Note callout, verbatim)
> Speculative decoding is **`llama_cpp`-only** and **text-only**. On the `qairt` runtime these settings are ignored with a warning. If you enable it on a multimodal model, GenieX runs the LLM path and drops image / audio content with a warning.

So: NOT supported on `qairt` (settings ignored w/ warning); NOT supported for VLM/audio (enabling it on a multimodal model silently downgrades to text-only LLM path, dropping image/audio content with a warning).

### Step 1: Pull the model pair
- "MTP needs a draft trained against **the exact target** you're running — an arbitrary small GGUF can't be substituted, and a mismatched pair fails at load time."

| Role | Model |
|---|---|
| Target | `google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0` |
| Draft | `RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0` |

```bash
geniex pull google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0
geniex pull RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0
```
- "Both models are resident at once, so plan for roughly 20 GB of free disk and enough RAM to hold the pair."
- Model naming convention shown: `org/repo[:precision]` (HF hub, GGUF, precision suffix `:Q4_0`).

### Step 2: `geniex infer` flags
```bash
geniex infer google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0 --spec-type draft-mtp --draft-model RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0 --draft-tokens 3
```

| Flag | Default | Effect |
|---|---|---|
| `--spec-type` | *(off)* | Set to `draft-mtp` to enable MTP. |
| `--draft-model` | — | Catalogue name `org/repo[:precision]` or a local GGUF path. Required by `draft-mtp`. |
| `--draft-tokens` | `3` | Max draft tokens per verification step. |
| `--draft-min` | `0` | Min draft tokens per step. `0` = llama.cpp default. |
| `--draft-p-min` | `0` | Draft stops proposing below this confidence. `0` = llama.cpp default. |

- Confirmation it engaged: profiling block gains a `draft accept` line (accepted/proposed):
```text
decode speed:   56.4 tok/s
stop reason:    eos
draft accept:   14/75 (18.7%)
```
- Failure is non-fatal: if the draft context can't be built, GenieX logs `speculative decoding setup failed; falling back to plain decoding` and continues at normal speed.
- (CLI v0.4.0 `--help` additionally lists `--spec-type` values: `draft-mtp,draft-eagle3,draft-simple,ngram-simple,ngram-map-k,ngram-map-k4v,ngram-mod,ngram-cache`, comma-separated, "llama_cpp only". `--draft-model` = "draft/MTP model for draft-* spec types: catalogue name or local GGUF path". `--draft-p-min` = "min greedy draft probability". The tutorial page documents only `draft-mtp`.)

### Step 3: Local server (per-request speculation)
- "speculation is configured **per request**, so `geniex serve` has no `--spec-type` flag."
```bash
geniex serve
```
- `POST /v1/chat/completions` takes the same three settings as `spec_*` fields; everything else is the standard OpenAI-compatible body:
```json
{
  "model": "google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0",
  "messages": [
    {
      "role": "user",
      "content": "Hello! Briefly introduce yourself."
    }
  ],
  "spec_type": "draft-mtp",
  "spec_draft_model": "RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0",
  "spec_n_max": 3,
  "nctx": 8192,
  "max_completion_tokens": 2048,
  "temperature": 0.8,
  "top_p": 0.95,
  "stream": false
}
```
- Field mapping (exact names):
  - `spec_type` — enables MTP (`"draft-mtp"`)
  - `spec_draft_model` — draft model name (must already be pulled)
  - `spec_n_max` — same as `--draft-tokens`
  - `spec_n_min` — same as `--draft-min` (accepted)
  - `spec_p_min` — same as `--draft-p-min` (accepted)
- Also visible in this body (non-OpenAI extensions the server accepts): `nctx` (per-request context window), `max_completion_tokens` (OpenAI-standard name), `temperature`, `top_p`, `stream`.
- Built-in Swagger UI: `http://127.0.0.1:18181` (paste the body there). Full API on `/en/run/cli/local-server`.
- Warning (verbatim): "**The server never auto-downloads a draft model.** Unlike `geniex infer`, it only uses what's already cached, so a missing draft errors mid-request — complete Step 1 first." (Implication: `geniex infer` DOES auto-pull a missing draft model.)
- Note (verbatim): "The `spec_*` fields are part of the model cache key, so changing any of them rebuilds the model on the next request. Keep them stable across a run." → UI design implication: keep spec settings constant per loaded model; toggling them triggers a full model reload.

Next-steps links: `/en/run/cli/reference` (every `geniex infer` flag), `/en/run/cli/local-server` (full OpenAI-compatible API).

---

## 2. Audio input (`/en/tutorials/audio-input`)

Subtitle: "Transcribe and reason over audio on-device with an audio-capable VLM, in the GenieX CLI, local server, and Python SDK."

### Mechanism
- A VLM whose multimodal projector (mmproj GGUF) carries a **conformer audio encoder** can take audio alongside text and images. GenieX feeds the clip through llama.cpp's **mtmd** (multimodal) path — same mechanism as images — "so a single turn can mix text, image, and audio."
- Note (verbatim): "Audio is the **`llama_cpp`** path only. QAIRT bundles report `audio: false` and a QAIRT model given audio fails with `GenieXError(-201201): Multimodal generation failed`. Audio runs on `--compute npu` / `gpu` / `cpu`; the NPU is the default and fast path on Snapdragon."
- Audio support "is not a metadata flag — it means the mmproj GGUF actually contains an audio encoder."

### Step 1: Model
- Recommended: `google/gemma-4-E2B-it-qat-q4_0-gguf` — `Q4_0` weights (≈3.1 GiB) + conformer mmproj (≈0.9 GiB) pulled together, ~4.0 GiB total.
```bash
geniex pull google/gemma-4-E2B-it-qat-q4_0-gguf
```
- Sample assets:
```bash
curl -L -o jfk.wav https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav
curl -L -o landmark.jpg "https://images.pexels.com/photos/402028/pexels-photo-402028.jpeg?w=1024"
```

### Step 2: CLI (`geniex infer`)
- Drop an **absolute** `.wav` / `.mp3` path into the prompt (or drag the file into the terminal). Audio and image paths are auto-detected; one prompt can carry both:
```bash
geniex infer google/gemma-4-E2B-it-qat-q4_0-gguf \
  -p "Describe the image and transcribe the audio. Image: /full/path/to/landmark.jpg Audio: /full/path/to/jfk.wav"
```
- Verified output on `--compute npu`, Snapdragon X Elite:
```text
**Image Description:**
This is a scenic, panoramic photograph that features a traditional Japanese temple ... The overall mood of the image is serene and beautiful.

**Audio Transcription:**
"And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
```
- Interactive `/mic` command (launch `geniex infer <model>` with no `-p`): records a clip and feeds it straight in; "It only appears when the loaded model supports audio."
```text
> /mic
Recording is going on, press Ctrl-C to stop
```
  `Ctrl-C` stops; GenieX saves to a temp `.wav` and transcribes it.
- Warning: `/mic` needs **SoX** on `PATH`; otherwise GenieX prints `SoX is not installed, some features may not work` at startup. Install:
```bash
sudo apt install sox       # Debian/Ubuntu
sudo yum install sox       # RHEL/CentOS/Fedora
sudo pacman -S sox         # Arch Linux
```
```powershell
winget install --id=ChrisBagwell.SoX -e
# then restart your terminal so sox is on PATH
```

### Step 3: Local server (OpenAI-compatible `input_audio`)
- Send an OpenAI-compatible `input_audio` content part. `input_audio.data` takes the same three formats as an image URL — a **local path**, an **HTTP/HTTPS URL**, or a **base64 data URL**. A single message can mix `image_url` and `input_audio`:
```bash
geniex serve
```
```bash
curl http://127.0.0.1:18181/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemma-4-E2B-it-qat-q4_0-gguf",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Describe the image, then transcribe the audio."},
          {"type": "image_url", "image_url": {"url": "/full/path/to/landmark.jpg"}},
          {"type": "input_audio", "input_audio": {"data": "/full/path/to/jfk.wav"}}
        ]
      }
    ],
    "max_tokens": 256
  }'
```
- Exact content-part shapes: `{"type":"text","text":...}`, `{"type":"image_url","image_url":{"url":...}}`, `{"type":"input_audio","input_audio":{"data":...}}`. NOTE: the docs do NOT show an OpenAI `"format": "wav"` key inside `input_audio` — the server decodes by content (magic bytes), and `data` accepts a local filesystem path or http(s) URL in addition to base64 data URL (a GenieX extension over OpenAI). `max_tokens` is accepted (alongside `max_completion_tokens` seen on the MTP page).
- Warning: **Docker** — local paths resolve **inside the container**; the install command mounts `$PWD/data` to `/data`; pass `/data/jfk.wav`, or use an HTTP URL / base64 data URL.
- Full request shape and Python `openai`-client equivalent: `/en/run/cli/local-server#vlm-request`.

### Step 4: Python SDK
```python
import os
from geniex import AutoModelForVision2Seq

image_path = os.path.abspath("landmark.jpg")
audio_path = os.path.abspath("jfk.wav")

model = AutoModelForVision2Seq.from_pretrained(
    "google/gemma-4-E2B-it-qat-q4_0-gguf",
    device_map="npu",                       # audio runs on npu / gpu / cpu, not qairt
)
print(model.capabilities())  # -> {'vision': True, 'audio': True}

messages = [{
    "role": "user",
    "content": [
        {"type": "image", "image": image_path},
        {"type": "audio", "audio": audio_path},
        {"type": "text", "text": "Describe the image, then transcribe the audio."},
    ],
}]
prompt = model.tokenizer.apply_chat_template(
    messages, tokenize=False, add_generation_prompt=True,
)

output = model.generate(prompt, images=[image_path], audios=[audio_path], max_new_tokens=256)
print(output.text)

model.close()
```
- Python API points: `AutoModelForVision2Seq.from_pretrained(name, device_map="npu")`, `model.capabilities()` → `{'vision': True, 'audio': True}`, `model.tokenizer.apply_chat_template(...)`, `model.generate(prompt, images=[...], audios=[...], max_new_tokens=...)`, `output.text`, `model.close()`. Chat-template content types are `image` / `audio` / `text` (differ from server's `image_url` / `input_audio`).

### Supported formats and preprocessing (table, verbatim content)
| | Details |
|---|---|
| CLI / prompt auto-detection | `.wav` and `.mp3` extensions only. Any other path in the prompt is treated as an image. |
| Server | No extension allowlist — `input_audio.data` bytes are decoded by content, so anything llama.cpp can decode works. |
| Decoder (llama.cpp) | Recognizes WAV, MP3, and FLAC by magic bytes. Note the mismatch: a `.flac` **path** in a CLI prompt is misrouted to images even though the decoder itself handles FLAC — pass FLAC via the server or a `.wav`/`.mp3` on the CLI. |
| Channels / sample rate | Audio is always down-mixed to **mono** and resampled to the encoder's target rate (typically **16 kHz**; some architectures use 24 kHz). Handled automatically — no need to pre-convert. |
| Duration | No maximum. Clips shorter than the encoder's chunk length are zero-padded; longer clips are chunked automatically. |
- Note: "Channel/sample-rate/duration handling lives in the bundled llama.cpp mtmd audio path (third-party), not in GenieX — behavior may shift with the pinned llama.cpp version."

### Failure modes (table)
| Situation | What happens |
|---|---|
| Audio sent to a QAIRT model | `capabilities()` reports `audio: false`; generation fails with `GenieXError(-201201): Multimodal generation failed`. QAIRT has no audio decode path. |
| Audio sent to a vision-only VLM (mmproj without audio encoder) | Audio is **silently skipped** with a `model does not support audio input; skipping N audio file(s)` warning; generation continues text-only. Check `capabilities()['audio']` first. |
| Unreadable / unsupported audio file | File is dropped with a debug log. If that leaves fewer media than the chat template expects, generation fails later with `-201201`. |

Next-steps links: `/en/run/cli/reference#geniex-infer-vlm`, `/en/run/cli/local-server#vlm-request`, `/en/run/python/quickstart`.

---

## 3. FAQ (`/en/resources/faq`)

### General
- **What is GenieX?** "A multi-platform AI inference SDK built for Qualcomm Snapdragon. GenieX runs frontier LLMs and VLMs on-device — Hexagon NPU, Adreno GPU, or CPU compute units — across Windows ARM64, Android, and Linux ARM64." (Only LLMs and VLMs are ever mentioned — no diffusion/image-gen/video-gen/TTS anywhere in this section.)
- **Which interface?**
  - Trying things out, scripting → CLI (Windows ARM64 or Linux ARM64) `/en/run/cli/install`
  - Building an app → **Local server** (OpenAI-compatible HTTP) `/en/run/cli/local-server` or Python SDK `/en/run/python/install`
  - Mobile → Android SDK (Kotlin, Maven Central) `/en/run/android/install`
  - Reproducible IoT deployment → Docker image on Linux ARM64 EVKs, pinned to a release tag
  - Quickstart `/en/get-started/quickstart` routes into all four.
- **Supported hardware**: `/en/get-started/platforms` — Snapdragon X on Windows ARM64, Snapdragon 8 Elite on Android, Dragonwing QCS9075 on Linux ARM64.

### Runtimes
- **llama.cpp vs Qualcomm AI Engine Direct**:
  - **llama.cpp** — runs any GGUF model, supports NPU/GPU/CPU compute units. "Best for trying community models."
  - **Qualcomm AI Engine Direct** (`qairt`) — runs pre-compiled Qualcomm AI Hub Models, **NPU only**. "Typically the fastest path when your model is on Qualcomm AI Hub." Link: `/en/get-started/platforms#geniex-runtimes`.
- **Default runtime/compute**: "If you don't pass a compute unit, both `llama_cpp` and `qairt` default to `npu`. For llama_cpp's faster HTP + CPU per-tensor scheduler path, pass `hybrid` explicitly." → `hybrid` = HTP (Hexagon) + CPU per-tensor scheduler, described as FASTER than plain `npu` for llama_cpp; must be opted into explicitly.
- **Precision**: "For llama.cpp on Snapdragon NPU: **`Q4_0`**. It has the best Hexagon NPU support. Qualcomm AI Hub Models are pre-quantized — no choice." Link: `/en/models/supported#precisions-quantizations-supported`.

### Models
- **Any HF model?** "Any **GGUF** model on the llama.cpp runtime." Link `/en/models/supported#run-a-gguf-model-from-hugging-face`. "Qualcomm AI Engine Direct requires a pre-compiled Qualcomm AI Hub Model — adding a new one means registering it on the C++ side first."
- **HF token for gated models** — env vars:
  - Windows: `$env:HF_TOKEN = "hf_..."` (or `$env:GENIEX_HFTOKEN = "hf_..."`)
  - Linux: `export HF_TOKEN="hf_..."` (or `export GENIEX_HFTOKEN="hf_..."`)
  - Or `huggingface-cli login` → persists token to `~/.cache/huggingface/token`.
  - Priority: `GENIEX_HFTOKEN` > `HF_TOKEN` > token file. Tokens at `https://huggingface.co/settings/tokens`. Full steps: `/en/models/supported#set-up-a-hugging-face-token`.
- **Supported models list**: `/en/models/supported` — split by runtime (Qualcomm AI Engine Direct, llama.cpp).

### Chipsets & devices
- **Need Snapdragon?** Yes. "GenieX targets Qualcomm Snapdragon chipsets — Hexagon NPU, Adreno GPU, and Snapdragon ARM CPU compute units. There's no x86 or non-Snapdragon ARM build." No device → Qualcomm Developer Cloud / Device Cloud.
- **AI Hub Model says NPU required — CPU?** "No. Qualcomm AI Engine Direct is NPU-only by design. `cpu` and `gpu` aliases are coerced to NPU with a warning. Use the llama.cpp runtime (with a GGUF) if you need CPU/GPU fallback."

### QDC (Qualcomm Device Cloud)
- No own device needed: sign in `https://qdc.qualcomm.com/`, pick a Snapdragon device, start an Interactive Session.
- SSH to QDC device: portal **Interactive Sessions → Connect** for SSH instructions; run the SSH tunnel command replacing `<PRIVATE_KEY_FILE_PATH>`. Tip: `WARNING: UNPROTECTED PRIVATE KEY FILE!` → `chmod 600 /path/to/your-key.pem`. Then in a new terminal (default password `oelinux123`):
```bash
ssh -o StrictHostKeychecking=no -o UserKnownHostsFile=/dev/null -p 2222 root@localhost
```
- Test Android demo without device: use **Snapdragon 8 Elite** or **8 Elite Gen 5** Interactive Session on QDC; build sample app from `https://github.com/qualcomm/ai-hub-apps/blob/release/geniex_chat_android/README.md` in Android Studio (**Build → Build APK(s)**). Steps: pick device → configure session (enable **Wi-Fi**, **Keep screen on**; SSH not required) → **Upload file** the `.apk` before session begins → start, tap APK to install, open **GenieX Demo** → optional VLM image test:
```bash
curl -L "https://s7d1.scene7.com/is/image/dmqualcommprod/Qualcomm_AIHub_image2-1?$QC_Responsive$&fmt=png-alpha" -o /data/local/tmp/qualcomm.png
cp /data/local/tmp/qualcomm.png /sdcard/Download/
```

### Python
- Linux ARM64 Python: GenieX requires **ARM64** Python; "x86_64 / AMD64 builds are not supported, even under emulation." QDC Yocto devices ship ARM64 Python (`python3 --version`). Option 1 Miniconda (recommended; Yocto + Ubuntu ARM64):
```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh
# CONDA_OVERRIDE_GLIBC: Yocto images often ship without `ldd`, which makes the
# installer's glibc probe fail with "Installer requires GLIBC >=2.28, but system has .".
# The override skips the probe; the real glibc on Qualcomm Linux 1.7+ is already 2.39.
CONDA_OVERRIDE_GLIBC=2.39 bash Miniconda3-latest-Linux-aarch64.sh -b -p $HOME/miniconda
eval "$($HOME/miniconda/bin/conda shell.bash hook)"
# Newer conda releases require explicit ToS acceptance for the default channels
# in non-interactive mode; without these, `conda create` errors out.
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r
conda create -n geniex python=3.13 -y
conda activate geniex
python --version
```
  Option 2 apt (Ubuntu ARM64 only): `sudo apt update && sudo apt install -y python3 python3-pip python3-venv` then `python3 --version`. QDC Yocto has no `apt`.
- **Miniconda on Windows ARM64?** "No. There is currently no native Windows ARM64 Miniconda installer." Use official Python 3.13.3 ARM64 installer `https://www.python.org/ftp/python/3.13.3/python-3.13.3-arm64.exe` (`/en/run/python/install`). "Do not install the x86 / AMD64 build: GenieX wheels only target ARM64." → RELEVANT TO USER: machine has Python 3.14; docs point at 3.13.3 ARM64 (wheel availability for 3.14 unknown — verify on the Python install page).

### Server / API
- **OpenAI-compatible?** "Yes — see Local server. You can point the official `openai` Python client at `http://127.0.0.1:18181/v1` and reuse OpenAI code unchanged." Base URL: `http://127.0.0.1:18181/v1`.
- **Does `geniex serve` auto-download models?** "No. Pull models with `geniex pull` before starting the server."

---

## 4. Troubleshooting (`/en/resources/troubleshooting`)

### Install / pip
- SSL/certificate errors during pip install (corporate proxy / QDC): TLS inspection; pre-download the SDK and point pip at the local file — PowerShell snippet at `/en/run/python/install#install-via-pip`.
- **Windows SmartScreen blocks the CLI installer**: "The `.exe` is not yet code-signed. Click **More info → Run anyway**."

### CLI
- **`geniex` not found after install**: "The installer doesn't add itself to `PATH`." Run:
```powershell
Set-Alias geniex (where.exe geniex)
```
  (User's binary path: `C:\Users\stama\AppData\Local\GenieX CLI\geniex.exe` — a UI that shells out should use the absolute path, not rely on PATH.)
- **`--compute cpu` or `--compute gpu` errors with a Qualcomm AI Hub Model**: AI Engine Direct is NPU-only. Use `--compute npu` (or omit — `npu` is default for `qairt`). For CPU/GPU, switch to a GGUF model on llama.cpp (`/en/get-started/platforms#llamacpp`).
- **`Context length exceeded` during a long chat**: conversation outgrew the context window (`--nctx`, default 4096).
  - llama.cpp (GGUF): raise at runtime, e.g. `geniex infer <model> --nctx 8192`, up to the model's trained maximum. "A larger window uses more memory."
  - Qualcomm AI Engine Direct (NPU): "the window is fixed in the compiled bundle and `--nctx` has no effect. Add `--sliding-window` to keep chatting (evicts the oldest context), or pull a bundle built for a longer context."
  - See `/en/run/cli/reference#increasing-the-context-length`.

### Server
- **`geniex serve` returns 'model not found'**: server doesn't auto-download. Pull first, e.g. `geniex pull ai-hub-models/Qwen3-4B-Instruct-2507`, then restart `geniex serve`. (Model naming for AI Hub hub: `ai-hub-models/<ModelName>`.)
- **Docker container can't see the NPU**: `--privileged` required plus volume mounts for `/usr/lib` (`/en/run/cli/install`).

### Linux
- **`docker pull` fails permission/unauthorized**: (1) Registry login — Docker Hub `docker.io/qualcomm/geniex` is public, no login; Qualcomm Container Registry needs `docker login docker-registry.qualcomm.com -u '$app' -p <token printed in docs>` → `Login Succeeded`. (2) Docker group: `sudo usermod -aG docker $USER` then `newgrp docker`.
- **Container loads model but inference fails `Failed to create device: 14001`**: container can't reach NPU; need `--privileged`, `/usr/lib` mount, host driver packages `qcom-adreno1`, `qcom-fastrpc1` (`/en/run/linux/install#install-host-dependencies`).
- **`--compute npu` fails `SDKError(Invalid input parameters or handle)` / `Device 'HTP0' not found`**: llama.cpp Hexagon backend `dlopen`s the **unversioned** `libcdsprpc.so`, but `qcom-fastrpc1` only ships `libcdsprpc.so.1`. `install.sh` creates the symlink on bare metal; if deployed from tarball:
```bash
sudo ln -sf /usr/lib/aarch64-linux-gnu/libcdsprpc.so.1 /usr/lib/aarch64-linux-gnu/libcdsprpc.so
sudo ln -sf /usr/lib/aarch64-linux-gnu/libadsprpc.so.1 /usr/lib/aarch64-linux-gnu/libadsprpc.so
sudo ldconfig
```
- **`--compute hybrid` runs but at CPU speed (silent NPU fallback)**: if the Hexagon driver can't load, `hybrid` still produces correct output but runs entirely on CPU — silent. Confirm NPU engaged with env var **`GGML_HEX_VERBOSE=1`**: expect `Hexagon Arch version vNN` and a `libggml-htp-vNN.so` session; no such lines = CPU fallback. (Useful diagnostic for a UI "NPU active?" indicator; documented for Linux but the env var is a ggml-hexagon backend var.)
- **`device is missing CPU features geniex requires`**: aarch64 Linux build compiled for **armv8.2-a** with `fp16`, `dotprod`, `lse` (atomics), `rdm`; baseline armv8.0 boards fail at startup with a clear error rather than `SIGILL`. Check is global — changing `--compute` won't help. Check:
```bash
LD_SHOW_AUXV=1 /bin/true | grep AT_HWCAP   # look for atomics, asimdrdm, asimddp, fphp, asimdhp
cat /proc/cpuinfo | grep Features          # same features, under the kernel's names
```
  Report via GitHub Issues or Slack.

### Android
- **Model loads but generation self-repeats or outputs nothing**: raw user text passed to `generateStreamFlow` instead of chat-templated prompt. "Qualcomm AI Engine Direct pipelines treat their input as already-templated — pass `applyChatTemplate().formattedText`, not the raw user message." (General insight: the qairt path expects pre-templated prompts.)
- **AI Hub pull fails `INVALID_INPUT`**: Android needs explicit `chipset` for AI Hub pulls — "auto-detect only runs on Windows on Snapdragon." Set `ModelPullInput.chipset` to `"SM8750"` (Snapdragon 8 Elite) or `"SM8850"` (Snapdragon 8 Elite Gen 5). `/en/run/android/api-reference#modelpullinput`.
- **AI Engine Direct load fails 'unknown model name'**: model id from AI Hub must match qairt runtime registry (`qwen3_4b_instruct_2507`, `qwen2_5_vl_7b_instruct`, etc.). New AI Hub model = register on C++ side: `third-party/geniex-qairt/models/{llm,vlm}_model_registry.h`.
- **`nGpuLayers` or `nCtx` rejected on AI Engine Direct**: "Qualcomm AI Hub Models are compiled with fixed KV cache and context length. Leave both `nGpuLayers` and `nCtx` at their defaults; tune `max_tokens` and `enable_thinking` instead." (Reveals `enable_thinking` as a qairt-side knob and confirms fixed nctx/ngl for qairt.)

### Still stuck
- GitHub Issues `https://github.com/qualcomm/GenieX/issues`; Slack `https://aihub.qualcomm.com/community/slack`.

---

## 5. Cross-check with installed CLI v0.4.0 (`--help`, read-only)

`geniex infer --help --skip-update` (relevant lines):
- Sampler: `--temperature`, `--top-p`, `--top-k`, `--min-p`, `--repetition-penalty` (default 1), `--presence-penalty`, `--frequency-penalty`, `--seed`, `--grammar-path`, `--grammar-string`.
- Model: `-c/--compute cpu|gpu|npu|hybrid` (default npu); `-n/--ngl` (-1=all, llama_cpp only); `--nctx` (default 4096, llama_cpp only); `--max-tokens` (default 2048); `--stop` / `--stop-file` (llama_cpp only); `--think` (default true; `--think=false` disables); `-s/--system-prompt`; `-i/--input`; `-p/--prompt`; `-t/--token-file` (llama_cpp only); `--sliding-window` (qairt only); `--spec-type` (comma-separated: `draft-mtp,draft-eagle3,draft-simple,ngram-simple,ngram-map-k,ngram-map-k4v,ngram-mod,ngram-cache`, llama_cpp only); `--draft-model`; `--draft-tokens` (default 3); `--draft-min`; `--draft-p-min`.
- Global: `--data-dir` (env `GENIEX_DATADIR`), `--log none|error|warn|info|debug|trace` (env `GENIEX_LOG`, default none), `--skip-update`, `--verbose`.

`geniex serve --help --skip-update`: `--host` (env `GENIEX_HOST`, default `127.0.0.1:18181`), `--origins` (env `GENIEX_ORIGINS`, default `*`), `--keepalive` (env `GENIEX_KEEPALIVE`, default 300 s), `--nctx` (env `GENIEX_NCTX`, default 4096, llama_cpp only), `-n/--ngl` (env `GENIEX_NGL`), `-c/--compute` (env `GENIEX_COMPUTE`), `--https` (env `GENIEX_HTTPS`), `--certfile` (env `GENIEX_CERTFILE`, default `cert.pem`), `--keyfile` (env `GENIEX_KEYFILE`, default `key.pem`). Confirms docs statement: no `--spec-type` on `serve`.

Top-level: commands `pull`, `remove`, `clean`, `list`, `model`, `infer`, `serve`, `run`, `config`, `version`, `update`, `help`, `completion`.

---

## 6. Consolidated implications for a UI/agent app (derived strictly from these four pages)

- **Server is the app-building surface**: OpenAI-compatible at `http://127.0.0.1:18181/v1`; `POST /v1/chat/completions`; Swagger UI at root `http://127.0.0.1:18181`. Server never auto-pulls (main models OR draft models) → the UI must run `geniex pull` (or drive it) before serving; "model not found" = not pulled.
- **Compute semantics**: default `npu` for both runtimes; `hybrid` = llama_cpp HTP+CPU per-tensor scheduler, explicitly called "faster" — but on driver failure it silently falls back to CPU (verify with `GGML_HEX_VERBOSE=1`). `qairt` is NPU-only; `cpu`/`gpu` coerced to NPU with warning. llama.cpp supports NPU/GPU/CPU.
- **Precision**: `Q4_0` for llama.cpp on Hexagon NPU; AI Hub models pre-quantized.
- **Context**: llama_cpp `--nctx`/`nctx` (default 4096, per-request `nctx` accepted in server body); qairt fixed context, `--sliding-window` evicts oldest; `Context length exceeded` error otherwise.
- **Speculative decoding**: llama_cpp + text-only; per-request `spec_type`/`spec_draft_model`/`spec_n_max`/`spec_n_min`/`spec_p_min`; part of model cache key (changing = reload); draft must be trained for the exact target; on multimodal models it drops media.
- **Audio**: llama_cpp only, needs mmproj with conformer encoder (e.g. `google/gemma-4-E2B-it-qat-q4_0-gguf`); server `input_audio.data` = local path | http(s) URL | base64 data URL; formats WAV/MP3/FLAC (server, by magic bytes); auto mono + 16 kHz; no max duration; error `-201201` on qairt; silently skipped on vision-only VLMs. `image_url.url` accepts the same three forms (local path / URL / base64 data URL).
- **Multimodal in one turn**: text + `image_url` + `input_audio` parts in a single user message are supported (llama_cpp VLM).
- **Thinking**: CLI `--think` default true; qairt side exposes `enable_thinking`.
- **Auth for gated HF models**: `GENIEX_HFTOKEN` > `HF_TOKEN` > `~/.cache/huggingface/token`.
- **Windows specifics**: installer not code-signed (SmartScreen); does not add to PATH; Python must be ARM64 (docs cite 3.13.3); no Miniconda for WoA.
- **NOT supported / not mentioned**: x86 builds; non-Snapdragon ARM; qairt on CPU/GPU; qairt audio; qairt speculative decoding; spec decoding with images/audio; FLAC via CLI path detection; `--nctx`/`--ngl` on qairt; server auto-download. Nothing in this section mentions image generation, video generation, diffusion, TTS/speech output, embeddings, or tool/function calling — these four pages are silent on them (check `/en/run/cli/local-server` for tool-calling/streaming/error-shape details).

## KEY FACTS
- Tutorials & Resources = exactly 4 pages (confirmed via https://geniex.aihub.qualcomm.com/llms.txt); every docs page is available as raw markdown by appending `.md` to the URL.
- Speculative decoding (MTP) is llama_cpp-only and text-only: ignored with a warning on qairt; on a multimodal model it runs the LLM path and DROPS image/audio content with a warning.
- MTP CLI flags: `--spec-type draft-mtp`, `--draft-model org/repo[:precision]|local GGUF path` (required), `--draft-tokens` (default 3), `--draft-min` (0=llama.cpp default), `--draft-p-min` (0=llama.cpp default). Draft must be trained against the exact target; mismatched pair fails at load. Example pair: target `google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0`, draft `RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0` (~20 GB disk).
- Server MTP is per-request on POST /v1/chat/completions via body fields `spec_type`, `spec_draft_model`, `spec_n_max` (=--draft-tokens), `spec_n_min`, `spec_p_min`; `geniex serve` has no --spec-type flag; spec_* fields are part of the model cache key (changing them rebuilds/reloads the model); the server NEVER auto-downloads a draft (or any) model — pull first.
- Server body also accepts non-OpenAI `nctx` per request, plus `max_completion_tokens`, `max_tokens`, `temperature`, `top_p`, `stream`; Swagger UI at http://127.0.0.1:18181, OpenAI base URL http://127.0.0.1:18181/v1 usable with the official `openai` client unchanged.
- Audio input is llama_cpp only via llama.cpp mtmd path; requires an mmproj GGUF that actually contains a conformer audio encoder (e.g. `google/gemma-4-E2B-it-qat-q4_0-gguf`, ~4.0 GiB); runs on npu (default/fast) / gpu / cpu; qairt reports `audio: false` and fails with `GenieXError(-201201): Multimodal generation failed`.
- Server audio: content part `{"type":"input_audio","input_audio":{"data": <local path | http(s) URL | base64 data URL>}}`; same three forms as `image_url.url`; a single message can mix text + image_url + input_audio; server decodes by magic bytes (WAV/MP3/FLAC), no extension allowlist; auto mono + resample (typ. 16 kHz); no max duration (zero-pad/chunk).
- CLI audio: only absolute `.wav`/`.mp3` paths auto-detected in the prompt (`.flac` misrouted to images); interactive `/mic` command needs SoX (`winget install --id=ChrisBagwell.SoX -e`); vision-only VLMs silently skip audio with warning `model does not support audio input; skipping N audio file(s)`.
- Python SDK: `AutoModelForVision2Seq.from_pretrained(name, device_map="npu")`, `model.capabilities()` -> {'vision': True, 'audio': True}, `model.generate(prompt, images=[...], audios=[...], max_new_tokens=...)`, `output.text`, `model.close()`.
- Default compute is `npu` for both llama_cpp and qairt; `hybrid` (llama_cpp HTP + CPU per-tensor scheduler) is described as the faster path and must be passed explicitly; qairt is NPU-only (cpu/gpu coerced to npu with a warning); on driver failure `hybrid` silently falls back to CPU — verify with env `GGML_HEX_VERBOSE=1` (look for `Hexagon Arch version vNN` / `libggml-htp-vNN.so`).
- Precision guidance: `Q4_0` has the best Hexagon NPU support for llama.cpp; Qualcomm AI Hub models are pre-quantized (no choice); any GGUF on Hugging Face runs on llama.cpp; qairt needs pre-compiled AI Hub models registered on the C++ side.
- Context: llama_cpp `--nctx` default 4096, raise up to model max (more memory); qairt context is fixed in the compiled bundle (`--nctx`/`--ngl` have no effect), use `--sliding-window` to evict oldest context; overflow error text is `Context length exceeded`.
- HF gated models: env `GENIEX_HFTOKEN` > `HF_TOKEN` > `~/.cache/huggingface/token` (`huggingface-cli login`).
- Windows notes: CLI installer .exe not code-signed (SmartScreen: More info -> Run anyway); installer does not add to PATH (`Set-Alias geniex (where.exe geniex)`); Python must be ARM64 (docs cite 3.13.3 ARM64 installer; no Miniconda for Windows ARM64; x86/AMD64 wheels not supported even under emulation).
- Server-side `serve` env/flags (from CLI v0.4.0 --help): GENIEX_HOST (127.0.0.1:18181), GENIEX_ORIGINS (*), GENIEX_KEEPALIVE (300 s), GENIEX_NCTX (4096), GENIEX_NGL (-1), GENIEX_COMPUTE, GENIEX_HTTPS, GENIEX_CERTFILE (cert.pem), GENIEX_KEYFILE (key.pem); global GENIEX_DATADIR, GENIEX_LOG.
- GenieX scope per FAQ: 'runs frontier LLMs and VLMs on-device' on Hexagon NPU / Adreno GPU / CPU across Windows ARM64, Android, Linux ARM64; no x86 or non-Snapdragon ARM builds. None of these four pages mention image generation, video generation, diffusion, TTS, embeddings, or tool/function calling.
- qairt pipelines treat input as already chat-templated (Android: pass `applyChatTemplate().formattedText`); qairt exposes `enable_thinking` and `max_tokens` as the tunables; CLI `--think` defaults to true.
- Support channels: GitHub Issues https://github.com/qualcomm/GenieX/issues and Slack https://aihub.qualcomm.com/community/slack.

## OPEN QUESTIONS
- Tool/function calling, streaming SSE chunk format, error JSON shapes, /v1/models and other endpoints are NOT covered in this section — must be read from /en/run/cli/local-server.md and /en/run/cli/reference.md.
- Whether `spec_n_max`/`spec_*` and `nctx` per-request fields also work on the `geniex run` client, and whether other spec types (draft-eagle3, draft-simple, ngram-*) listed in `geniex infer --help` are usable via server `spec_type` — the tutorial only documents `draft-mtp`.
- Whether the server's `input_audio` part accepts/needs OpenAI's `format` key (docs omit it; decoding is by magic bytes) and whether streaming (`stream: true`) works with audio/image requests.
- Which Gemma-4 / other audio-capable GGUFs beyond `google/gemma-4-E2B-it-qat-q4_0-gguf` ship a conformer mmproj, and how the UI can query `capabilities()` (vision/audio) over HTTP rather than the Python SDK.
- Python 3.14 compatibility: docs specify the Python 3.13.3 ARM64 installer; whether GenieX wheels exist for 3.14 ARM64 needs checking on /en/run/python/install.md.
- Whether `GGML_HEX_VERBOSE=1` diagnostic and the `hybrid` speed advantage apply identically on Windows on Snapdragon (docs describe the silent-fallback case under the Linux heading).
- Memory/RAM guidance for MTP pair (docs only say 'enough RAM to hold the pair') and whether the draft model can be resident on a different compute unit than the target.
- Nothing here answers image/video generation feasibility — these pages only ever mention LLM/VLM; that question must be answered from the Models page and external ecosystem, not from this section.
