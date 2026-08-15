# GenieX docs — "Get started" section: exhaustive notes

## 0. How these notes were obtained (important for the parent agent / other subagents)
- WebFetch on the HTML pages returns a *summary* (Mintlify site is client-rendered; the fetch tool's model condenses). Full raw text is available by appending `.md` to any doc URL, e.g. `https://geniex.aihub.qualcomm.com/en/get-started/what-is-geniex.md` (served as `text/markdown`). Also:
  - `https://geniex.aihub.qualcomm.com/llms.txt` — index of every doc page (18 pages) with `.md` links.
  - `https://geniex.aihub.qualcomm.com/llms-full.txt` — the ENTIRE doc set concatenated (~159 KB) — one fetch gets everything.
- I diffed the `.md` pages against the `llms-full.txt` copies: content is identical (only HTML attributes differ). So the notes below are from the complete verbatim source, not a summary.
- Local copies saved at: `C:\Users\stama\AppData\Local\Temp\claude\C--Users-stama-Documents-Projects-GenieX\93414283-ae99-4541-a427-3735562dd649\scratchpad\{what-is-geniex.md, quickstart.md, platforms.md, llms.txt, llms-full.txt}`.
- Full docs index (from llms.txt), so the parent knows where deeper material lives:
  - Get started: `/en/get-started/what-is-geniex`, `/en/get-started/quickstart`, `/en/get-started/platforms`
  - Models: `/en/models/supported` ("Where to find models, how to run them, and which precisions land on the Snapdragon NPU")
  - CLI: `/en/run/cli/install`, `/en/run/cli/quickstart`, `/en/run/cli/local-server` ("Run an OpenAI-compatible HTTP API on localhost backed by Snapdragon NPU/GPU/CPU acceleration"), `/en/run/cli/reference` ("Every GenieX CLI command and flag")
  - Python: `/en/run/python/install`, `/en/run/python/quickstart`, `/en/run/python/api-reference`
  - Linux (Docker): `/en/run/linux/install`
  - Android: `/en/run/android/install`, `/en/run/android/quickstart`, `/en/run/android/api-reference`
  - Tutorials: `/en/tutorials/speculative-decoding-mtp` ("Speed up decoding with a Multi-Token Prediction draft model, in the GenieX CLI and the local server"), `/en/tutorials/audio-input` ("Transcribe and reason over audio on-device with an audio-capable VLM, in the GenieX CLI, local server, and Python SDK")
  - Resources: `/en/resources/faq`, `/en/resources/troubleshooting`
  - Optional links: GitHub https://github.com/qualcomm/GenieX ; Website https://aihub.qualcomm.com/ ; Slack https://aihub.qualcomm.com/community/slack
- NOTE ON SCOPE: The three "Get started" pages contain NO HTTP endpoint definitions, NO request/response JSON, NO SSE format, NO tool-calling spec, NO VLM image-input format, NO env vars, NO keepalive/unload semantics, NO concurrency notes. Those live in `/en/run/cli/local-server`, `/en/run/cli/reference`, `/en/run/python/api-reference`, tutorials, FAQ and troubleshooting. Everything below is what these three pages DO say, plus a few tightly-related cross-references I verified in `llms-full.txt` (marked "[cross-ref]").

---

## 1. Page: What is GenieX — https://geniex.aihub.qualcomm.com/en/get-started/what-is-geniex

Tagline: "On-device AI inference runtime for Qualcomm Snapdragon — run frontier LLMs and VLMs across CLI, Python, Android, and Docker."

### Definition
- "GenieX is an on-device Gen AI inference runtime built for Qualcomm platforms. It is the easiest way to run frontier language and vision-language models locally on Hexagon NPU, Adreno GPU, or CPU with a few lines of code. It is the community version of Qualcomm GENIE."
- Status callout (Info): "**GenieX is in developer preview.** We'd love your feedback — open an issue (https://github.com/qualcomm/GenieX/issues) or join Slack (https://aihub.qualcomm.com/community/slack)."
- Model classes named anywhere in this section: **language models (LLMs)** and **vision-language models (VLMs)** only. Nothing about image generation, diffusion, video, TTS, or embeddings anywhere in the Get-started pages. (Elsewhere in the docs the only other modality is **audio input** via an audio-capable VLM mmproj — see tutorials/audio-input.) So: image/video *generation* is NOT a GenieX capability per the docs.

### Architecture (image alt text, verbatim)
"GenieX architecture stack: CLI, Python API, Java API, Docker, and Serve interfaces sit on the GenieX SDK, which dispatches to the llama.cpp runtime (GGML over CPU/GPU/HTP kernels) or the Qualcomm AI Engine Direct runtime on NPU. Targets Windows, Android, and Linux."
Image URL: https://mintcdn.com/qualcomm-0801e48b/ewrmU9zMnfZyH0O6/Mintlify-image/geniex_arch_v2.png

### Five entry points ("all over a single SDK")
- **CLI** — "run and serve models straight from the terminal."
- **Python** — "embed inference in your apps with the Python SDK."
- **Java/Kotlin** — "the Android SDK for on-device mobile apps."
- **Docker** — "a containerized image for reproducible deployments."
- **OpenAI-compatible server** — "a drop-in local server for existing OpenAI clients."

### Runtimes
- "Under the hood, that SDK dispatches to either the **llama.cpp runtime** (GGML kernels for CPU / GPU / Hexagon HTP) or the **Qualcomm® AI Engine Direct runtime** (NPU-only). The same SDK runs on Windows ARM64, Android, and Linux ARM64."
- Naming note: "**Qualcomm AI Engine Direct** is the official name of what is also known as the *Qualcomm AI Engine Direct SDK*, *Qualcomm AI Runtime*, and *QAIRT*." (Link: https://www.qualcomm.com/developer/software/qualcomm-ai-engine-direct-sdk). CLI runtime identifier is `qairt`; the other is `llama_cpp` (see platforms page). The installed CLI reports "QAIRT Runtime Version: v2.45.0.260326" and "LlamaCPP Runtime Hash: 6ba5ef2" (verified locally with `geniex version --skip-update`).

### "Why two runtimes?" (verbatim bullets)
- "**Most models just work** — point GenieX at almost any GGUF on Hugging Face and it runs on CPU / GPU / NPU via llama.cpp."
- "**Qualcomm® AI Hub Models run optimally** — models published to Qualcomm AI Hub (https://aihub.qualcomm.com/) are pre-compiled per chipset and run through Qualcomm AI Engine Direct on the Hexagon NPU for peak on-device performance."

### "What you can do with GenieX"
- "**Run models locally** on Snapdragon X (Windows ARM64), Snapdragon 8 Elite (Android), and Dragonwing IoT chipsets."
- "**Pick a runtime** — `llama.cpp` for any community GGUF model, Qualcomm AI Engine Direct (`qairt`) for Qualcomm AI Hub pre-compiled NPU bundles."
- "**Build apps** through the CLI, an OpenAI-compatible local server, the Python SDK, the Android SDK, or a Docker image."

### Cards / links
- Quickstart → `/en/get-started/quickstart`; Platforms & runtimes → `/en/get-started/platforms`; Models → `/en/models/supported` ("Tested LLMs and VLMs across the llama.cpp and Qualcomm AI Engine Direct runtimes").
- Community: Report an issue https://github.com/qualcomm/GenieX/issues ; Join Slack https://aihub.qualcomm.com/community/slack
- Legal: License — "GenieX is released under the BSD 3-Clause License." https://github.com/qualcomm/GenieX/blob/main/LICENSE ; Terms of Use https://www.qualcomm.com/site/terms-of-use

---

## 2. Page: Quickstart — https://geniex.aihub.qualcomm.com/en/get-started/quickstart

Tagline: "Pick your interface and get to first inference in minutes." / "Choose the interface that matches what you're building. Each path takes you from install to a working model in a few minutes."

### Interface cards (verbatim descriptions)
| Card | Link | Description |
|---|---|---|
| Command Line | `/en/run/cli/quickstart` | "Run models from a terminal on Windows ARM64, or via Docker on Linux ARM64. Best for trying things out fast." |
| Local Server | `/en/run/cli/local-server` | "OpenAI-compatible API on Windows ARM64 and Linux ARM64." |
| Python SDK | `/en/run/python/quickstart` | "Huggingface style API for scripting and notebooks, available on Windows ARM64 and Linux ARM64." |
| Linux (Docker) | `/en/run/linux/install` | "Docker image for Linux ARM64 with NPU access. Best for Dragonwing IoT and similar platforms." |
| Android SDK | `/en/run/android/quickstart` | "Kotlin SDK from Maven Central, plus a prebuilt demo APK for Snapdragon 8 Elite." |

Implications for the user's Windows-on-Snapdragon machine: the available surfaces are **CLI**, **Local Server (OpenAI-compatible)**, and **Python SDK**. Docker/NPU is Linux ARM64 only; Android SDK is Android only. There is no JS/Node/Rust SDK — a web/desktop UI on Windows must talk to `geniex serve` over HTTP (or shell out to the CLI / embed Python).

### "Before you start" (verbatim)
- "**Platform & runtime** — pick where you'll run (Windows ARM64, Android, Linux ARM64) and which runtime fits your model. See Platforms & runtimes."
- "**Models** — see Models (`/en/models/supported`) for tested examples on each runtime."
- "**Bring your own model** — already have a GGUF or AI Hub bundle on disk? See Run a local model (`/en/run/cli/quickstart#run-a-local-model`)." → i.e., the `localfs` hub path is documented in the CLI quickstart.

---

## 3. Page: Platforms & runtimes — https://geniex.aihub.qualcomm.com/en/get-started/platforms

Tagline: "Snapdragon platforms supported by GenieX and which runtime to pick on each."

Key statement: "GenieX runs exclusively on Qualcomm Snapdragon — no x86 or non-Snapdragon ARM build. To get going, pick the **Snapdragon platform** you'll run on, then pick a **runtime** that matches the model you want to run."

### 3.1 Snapdragon platforms
"GenieX is supported across three Snapdragon families — compute, mobile, and IoT — covering Windows ARM64, Android, and Linux ARM64."

#### Supported (validated) chipsets — verbatim table
"Each row lists the **SoC identifier** you'd see from auto-detection, and the **AI Hub chipset id** used when pulling Qualcomm AI Hub Models."

| Family | Chipset | SoC id | AI Hub chipset id |
|---|---|---|---|
| **Compute** *(Windows ARM64 / Copilot+ PC)* | **Snapdragon® X Elite** | `X1E*` | `qualcomm-snapdragon-x-elite` |
| | **Snapdragon® X2 Elite** | `X2E*` | `qualcomm-snapdragon-x2-elite` |
| **Mobile** *(Android)* | **Snapdragon® 8 Elite** | `SM8750` | `qualcomm-snapdragon-8-elite` |
| | **Snapdragon® 8 Elite Gen 5** | `SM8850` | resolved from `SM8850` *(see note)* |
| **IoT** *(Linux ARM64 — cameras, robotics, industrial)* | **Qualcomm® Dragonwing™ IQ-9075** | `QCS9075` | `qualcomm-qcs9075` |
| | **Qualcomm® Dragonwing™ IQ-8275** | `QCS8275` | `qualcomm-qcs8275` |

→ The user's machine (X1E80100) is the validated **Snapdragon X Elite** row: SoC id pattern `X1E*`, AI Hub chipset id `qualcomm-snapdragon-x-elite`.

#### Note: "Chipset vs. SoC id." (verbatim)
"Snapdragon X-series parts are identified by their Oryon CPU SKU (`X1E80100`, `X2E80100`, …); every part within a generation shares one NPU architecture, so **all X Elite SKUs map to the same AI Hub asset** — including the X Plus and X2 Plus parts. Android reports its SoC through `ro.soc.model`, and Dragonwing boards through the device tree.
On Android, GenieX passes the SoC id (e.g. `SM8850`) straight to Qualcomm AI Hub, which resolves it through its own alias table — GenieX deliberately keeps no second mapping. Pass the **SoC id**, not an AI Hub chipset name, and the right asset is selected. Variant suffixes are not exposed by `ro.soc.model`: a Galaxy S25 reports `SM8750`, not `SM8750-AC` (the alias for `qualcomm-snapdragon-8-elite-for-galaxy`), so pass the chipset explicitly if you need the variant asset."

#### Chipset auto-detection + config commands (verbatim)
"GenieX **auto-detects the chipset** on Windows on Snapdragon, Dragonwing Linux, and Android. Check what it found, or set it explicitly:"
```bash
geniex config get chipset          # show the detected (or configured) chipset
geniex config set chipset          # launch an interactive picker
```
Verified locally (read-only) on the user's CLI v0.4.0:
- `geniex config get chipset --skip-update` → `Snapdragon X Elite CRD` (a display name, not the `X1E*` SoC id nor the AI Hub id — a UI should treat this as an opaque display string).
- `geniex config list --skip-update` → `chipset: Snapdragon X Elite CRD`
- `geniex config --help` → "Available keys: chipset" (the ONLY config key in v0.4.0). Subcommands: `get`, `set`, `list`. `config set <key> [value]`: "Pass an empty string to clear the value. For the "chipset" key, omit the value to launch an interactive chipset picker."
- Global CLI flags seen in `--help`: `--data-dir string` "Custom data directory (env: GENIEX_DATADIR)"; `--log string` "Log level: none, error, warn, info, debug, trace (env: GENIEX_LOG) (default "none")"; `--skip-update` "Skip checking for updates"; `--verbose`; `-v/--version`. Also `completion` (shell autocompletion) and `help` commands exist. (These come from the CLI itself, not the Get-started pages.)

#### Warning (verbatim)
"**Android requires an explicit chipset** for Qualcomm AI Hub pulls — auto-detect via `ro.soc.model` covers the CLI/SDK path, but the Android SDK needs `ModelPullInput.chipset` set to `"SM8750"` or `"SM8850"`. See Android API reference (`/en/run/android/api-reference#modelpullinput`)."

#### Interfaces per OS — verbatim table
| OS | Interfaces |
|---|---|
| **Windows ARM64** *(Compute / Copilot+ PC)* | CLI (`/en/run/cli/quickstart`), Python SDK (`/en/run/python/quickstart`), Local server (`/en/run/cli/local-server`) |
| **Android** *(Mobile)* | Android SDK (`/en/run/android/quickstart`) (Kotlin, Maven Central) |
| **Linux ARM64** *(Dragonwing IoT)* | Native install (`/en/run/cli/install`), Docker (`/en/run/linux/install`) |

"The chipsets above are the validated set. GenieX may run on other Snapdragon parts within the same families — for everything Qualcomm AI Hub can compile for, see the Qualcomm AI Hub device list (https://workbench.aihub.qualcomm.com/docs/hub/devices.html)."

Tip: "**No device on hand?** Sign in to Qualcomm Developer Cloud (QDC) (https://qdc.qualcomm.com/) for remote sessions on Snapdragon X Elite / X2 Elite, Snapdragon 8 Elite / 8 Elite Gen 5, and Dragonwing IQ-9075. See the QDC walkthrough in the FAQ (`/en/resources/faq#qdc-qualcomm-device-cloud`)."

### 3.2 GenieX runtimes
"GenieX ships with two runtimes so you get both **broad model coverage** and **peak Snapdragon performance** in one stack:"
- "**`llama_cpp`** — any GGUF model on Hugging Face, running on Hexagon NPU, Adreno GPU, or CPU through Qualcomm's GGML Hexagon backend. The widest model selection."
- "**`qairt`** (Qualcomm® AI Engine Direct) — pre-compiled bundles from Qualcomm AI Hub (https://aihub.qualcomm.com/models/), compiled and quantized per chipset and pinned to the Hexagon NPU. The fastest path when your model is on Qualcomm AI Hub."
- Naming note repeated: "**Qualcomm AI Engine Direct** (also known as the *Qualcomm AI Engine Direct SDK*, *Qualcomm AI Runtime*, and historically *QAIRT*) is the official name."

Comparison table (verbatim):
| | **llama.cpp** | **Qualcomm AI Engine Direct** |
|---|---|---|
| **Model format** | GGUF (any community model) | Qualcomm AI Hub pre-compiled bundles |
| **Compute units** | NPU / GPU / CPU | NPU only |
| **Precisions (Quantizations) picked by** | You (`Q4_0`, `Q8_0`, `F16`, …) | Pre-quantized in the bundle |
| **Best for** | Bringing your own GGUF from Hugging Face | Highest NPU performance on Qualcomm® AI Hub Models |

"Pick **`llama_cpp`** for any GGUF from Hugging Face, or when you need CPU/GPU fallback (e.g. IoT devices without HTP). Pick **`qairt`** for the fastest NPU path on models published to Qualcomm AI Hub."

#### Defaults (verbatim)
"If you don't pass a compute unit:"
| Runtime | Default compute unit |
|---|---|
| `llama_cpp` | `npu` (pinned to `HTP0`) |
| `qairt` | `npu` |
"For llama.cpp's HTP + CPU per-tensor scheduling (the faster path on Snapdragon), pass `hybrid` explicitly."

### 3.3 llama.cpp runtime details
"The `llama_cpp` runtime executes **any GGUF model** through llama.cpp with Qualcomm's GGML Hexagon backend. Pull any community GGUF from Hugging Face and run it on Snapdragon NPU, Adreno GPU, or pure CPU."

Compute units — "`--compute` maps to the underlying hardware as follows:" (verbatim)
| Alias | Effect |
|---|---|
| `npu` *(default)* | Pin to Hexagon NPU (`HTP0`). Best NPU-only path. |
| `gpu` | Adreno GPU via OpenCL. |
| `cpu` | Pure CPU. Forces `nGpuLayers = 0`. |
| `hybrid` | Empty `device_id` + `n_gpu_layers=-1` (all layers) — llama.cpp's per-tensor HTP+CPU scheduler. **The fast path on Snapdragon.** |

"The precision you pick at `geniex pull` time also determines where the model lands — see Precisions (Quantizations) Supported (`/en/models/supported#precisions-quantizations-supported`)."

[cross-ref, verified in llms-full.txt, Models page] Precisions table for llama.cpp: `Q4_0` *(default)* → runs on **Hexagon NPU** ("Best NPU support in llama.cpp. Recommended for most models."); `Q8_0` → GPU / CPU ("Better quality at ~2× the disk and memory cost."); `F16` → GPU / CPU ("Reference precision. Mainly for evaluation — large and slow."); `Q4_K_M`, `Q5_K_M`, etc. → GPU / CPU ("Mixed-precision K-quants. Not optimized for Hexagon NPU."). Tip: "Stick with `Q4_0` if you want the model to land on the Hexagon NPU. Other precisions will work but typically run on GPU or CPU." The CLI prompts at pull time: `Choose a precision version to download > Q4_0 [1.2 GiB] (default) / Q8_0 [2.0 GiB] / F16 [3.8 GiB]`. Model naming convention seen throughout the docs: `<hf-org>/<repo>:<PRECISION>` e.g. `unsloth/Qwen3-4B-GGUF:Q4_0`, `google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0`.

[cross-ref, Troubleshooting] `--compute hybrid` "runs but at CPU speed (silent NPU fallback)": if the Hexagon driver can't load, hybrid still produces correct output on CPU only. Confirm NPU engagement with env var `GGML_HEX_VERBOSE=1`; expect log lines `Hexagon Arch version vNN` and a `libggml-htp-vNN.so` session; absence means CPU fallback. Also `--compute npu` may fail with `SDKError(Invalid input parameters or handle)` / `Device 'HTP0' not found` (Linux: missing unversioned `libcdsprpc.so` symlink). A UI should surface an "NPU actually active?" health check based on this.

### 3.4 Qualcomm AI Engine Direct (`qairt`) runtime details
"The `qairt` runtime executes pre-compiled bundles from **Qualcomm AI Hub** through Qualcomm® AI Engine Direct. NPU-only, with the bundle compiled and quantized for a specific Snapdragon chipset — typically the fastest NPU path when your model is on Qualcomm AI Hub."

Compute units — "Qualcomm AI Engine Direct is **NPU only**." (verbatim)
| Alias | Effect |
|---|---|
| `npu` *(default)* | Pin `HTP0` — the only supported path. |
| `cpu` / `gpu` | Coerced to `npu` with a warning. Never an error. |
(Note: `hybrid` is not listed for qairt at all.)

Runtime constraints (verbatim): "The bundle has its **precision, context length, and KV cache size baked in** — none can be changed at runtime. On Android, `nGpuLayers != 0` and `nCtx != 0` are rejected with `PARAM_NOT_SUPPORTED`; leave both at defaults and tune `max_tokens` / `enable_thinking` only. To change precision or context length, get a different bundle from Qualcomm AI Hub (https://aihub.qualcomm.com/models/)."
→ For a UI: when the loaded model is a `qairt`/AI Hub bundle, disable/grey-out context-length (`--nctx`), GPU-layers (`--ngl`), precision and compute-unit pickers; only expose `max_tokens` and thinking toggle (`enable_thinking`). Parameter names surfaced here: `nGpuLayers`, `nCtx`, `max_tokens`, `enable_thinking`, `device_id`, `n_gpu_layers`, `PARAM_NOT_SUPPORTED`.

---

## 4. Consolidated checklist vs. the requested capture list (for the "Get started" section only)
- Capabilities: LLM + VLM inference on NPU/GPU/CPU; 5 entry points (CLI, Python, Android Java/Kotlin, Docker, OpenAI-compatible server); two runtimes `llama_cpp` and `qairt`; chipset auto-detect; model pull from Hugging Face GGUF or Qualcomm AI Hub bundles.
- CLI flags/env vars in these pages: only `geniex config get chipset`, `geniex config set chipset`, `--compute {npu|gpu|cpu|hybrid}`, and mention of `geniex pull`. (From CLI --help, not docs: `--data-dir`/`GENIEX_DATADIR`, `--log`/`GENIEX_LOG`, `--skip-update`, `--verbose`. From troubleshooting cross-ref: `GGML_HEX_VERBOSE=1`. From Android API cross-ref: `GENIEX_HFTOKEN` env for HF token.)
- HTTP endpoints / request-response JSON / SSE / error shapes: NOT in this section → `/en/run/cli/local-server`.
- OpenAI compatibility: only stated as "drop-in local server for existing OpenAI clients" / "OpenAI-compatible API on Windows ARM64 and Linux ARM64" → details in local-server page.
- Tool/function calling: NOT mentioned in this section (llms-full.txt shows a `web_search` tool-call walkthrough in the local-server page: "Step 1 - VLM identifies the landmark and requests a web_search call. Step 2 - run the tool, feed the result back as a fresh text-only conversation." — implies tool calling is documented there).
- VLM image input format: NOT in this section (CLI reference mentions image `.jpg .jpeg .png .webp` and audio `.wav .mp3` paths auto-detected in `geniex run`; server format is in local-server page).
- Model naming/precision: `Q4_0`, `Q8_0`, `F16`, K-quants (`Q4_K_M`, `Q5_K_M`); `Q4_0` = the only precision that lands on Hexagon NPU under llama.cpp; qairt bundles pre-quantized per chipset.
- Hub-specific behavior: Hugging Face → GGUF via `llama_cpp`; Qualcomm AI Hub → pre-compiled per-chipset bundle via `qairt` (requires chipset id; Windows auto-detects; Android must set `ModelPullInput.chipset` = `"SM8750"`/`"SM8850"`); `docker` and `localfs` hubs not described in this section (localfs → "Run a local model" in CLI quickstart).
- Compute unit semantics: fully captured above (npu=HTP0 pin; gpu=Adreno OpenCL; cpu forces nGpuLayers=0; hybrid = empty device_id + n_gpu_layers=-1 per-tensor HTP+CPU scheduler = "the fast path on Snapdragon"; qairt: NPU-only, cpu/gpu coerced with warning).
- Speculative decoding, grammar/structured output, thinking mode (`enable_thinking` name only), context/sliding window, keepalive/unload, concurrency, performance tips (only: use `hybrid`, use `Q4_0`, use qairt bundles for peak NPU): mostly NOT in this section.
- Hardware/chipset requirements: Snapdragon only; validated list above; no x86, no non-Snapdragon ARM.
- Install/update: NOT in this section (→ `/en/run/cli/install`, `/en/run/python/install`, etc.).
- Troubleshooting: NOT in this section (→ `/en/resources/troubleshooting`).
- Limitations / NOT supported (explicit in section): no x86 build; no non-Snapdragon ARM build; qairt is NPU-only; qairt bundle precision/context/KV size not changeable at runtime; Android qairt rejects `nGpuLayers != 0` and `nCtx != 0` (`PARAM_NOT_SUPPORTED`); non-`Q4_0` GGUF precisions typically do not run on the NPU; Docker/NPU path is Linux ARM64 (not offered for Windows); Android SDK requires explicit chipset for AI Hub pulls; developer-preview status. Not mentioned at all (therefore not supported per docs): image/video generation, embeddings, TTS, x86.
- Roadmap hints: none beyond "developer preview" and "GenieX may run on other Snapdragon parts within the same families".
- Code samples in this section: only the two `geniex config` lines above.


## KEY FACTS
- Raw markdown for any GenieX doc page is available by appending `.md` to its URL; `https://geniex.aihub.qualcomm.com/llms.txt` lists all 18 pages and `https://geniex.aihub.qualcomm.com/llms-full.txt` (~159 KB) contains the entire doc set verbatim — use these instead of WebFetch summaries.
- GenieX = on-device Gen AI inference runtime for Snapdragon, 'community version of Qualcomm GENIE', developer preview, BSD 3-Clause; runs LLMs and VLMs (plus audio-input VLMs elsewhere in docs) — no image/video generation, embeddings or TTS are mentioned anywhere.
- Five entry points over one SDK: CLI, Python SDK, Android SDK (Java/Kotlin), Docker (Linux ARM64), OpenAI-compatible local server. On Windows ARM64 only CLI, Python SDK and Local server are offered — no JS/Node/Rust SDK, so a Windows UI must use `geniex serve` HTTP or shell out.
- Two runtimes: `llama_cpp` (any Hugging Face GGUF; NPU/GPU/CPU via Qualcomm's GGML Hexagon backend) and `qairt` (Qualcomm AI Engine Direct; Qualcomm AI Hub pre-compiled per-chipset bundles; NPU only).
- `--compute` semantics (llama_cpp): `npu` (default) pins Hexagon `HTP0`; `gpu` = Adreno via OpenCL; `cpu` = pure CPU, forces `nGpuLayers = 0`; `hybrid` = empty `device_id` + `n_gpu_layers=-1`, per-tensor HTP+CPU scheduler, explicitly called 'The fast path on Snapdragon' and must be passed explicitly.
- qairt compute: `npu` only; `cpu`/`gpu` are coerced to `npu` with a warning, never an error; bundle precision, context length and KV-cache size are baked in and cannot be changed at runtime; on Android `nGpuLayers != 0` / `nCtx != 0` are rejected with `PARAM_NOT_SUPPORTED` — only `max_tokens` and `enable_thinking` are tunable.
- Precision determines where a GGUF lands: `Q4_0` (default) is the only precision documented to run on the Hexagon NPU; `Q8_0`, `F16`, `Q4_K_M`, `Q5_K_M` etc. run on GPU/CPU. Model naming convention `<org>/<repo>:<PRECISION>` e.g. `unsloth/Qwen3-4B-GGUF:Q4_0`.
- Validated chipsets: Snapdragon X Elite (`X1E*` -> AI Hub id `qualcomm-snapdragon-x-elite`), X2 Elite (`X2E*` -> `qualcomm-snapdragon-x2-elite`), 8 Elite (`SM8750` -> `qualcomm-snapdragon-8-elite`), 8 Elite Gen 5 (`SM8850`), Dragonwing IQ-9075 (`QCS9075` -> `qualcomm-qcs9075`), IQ-8275 (`QCS8275` -> `qualcomm-qcs8275`); all X Elite/X Plus SKUs map to the same AI Hub asset. No x86 or non-Snapdragon ARM build.
- Chipset is auto-detected on Windows/Linux/Android; `geniex config get chipset` / `geniex config set chipset` (interactive picker); on the user's machine `config get chipset` returns the display string `Snapdragon X Elite CRD`; `chipset` is the only config key in CLI v0.4.0.
- CLI global flags (from --help): `--data-dir` (env `GENIEX_DATADIR`), `--log none|error|warn|info|debug|trace` (env `GENIEX_LOG`), `--skip-update`, `--verbose`; installed version v0.4.0 with QAIRT v2.45.0.260326 and llama.cpp hash 6ba5ef2.
- The Get-started pages contain NO HTTP endpoint, JSON schema, SSE, tool-calling, image-input, keepalive, concurrency, speculative-decoding or grammar details — those live in /en/run/cli/local-server, /en/run/cli/reference, /en/run/python/api-reference, /en/tutorials/* and /en/resources/*.
- Silent-fallback gotcha (troubleshooting cross-ref): `--compute hybrid` can silently run on CPU if the Hexagon driver fails; verify NPU engagement with env `GGML_HEX_VERBOSE=1` (look for `Hexagon Arch version vNN` / `libggml-htp-vNN.so`).

## OPEN QUESTIONS
- The Get-started section never defines the OpenAI-compatible server API surface (endpoints, streaming format, tool calls, image content parts, error shapes) — must be extracted from /en/run/cli/local-server.md and /en/run/cli/reference.md (both available verbatim in llms-full.txt).
- Docs say `hybrid` is 'the fast path on Snapdragon' but default is `npu` (HTP0 pin); which is actually faster for a given model size on X1E80100 needs empirical benchmarking (and NPU engagement should be verified with GGML_HEX_VERBOSE=1).
- The CLI reports the chipset as the display string `Snapdragon X Elite CRD` rather than the documented `X1E*` SoC id / `qualcomm-snapdragon-x-elite` AI Hub id — unclear whether the CLI exposes the machine-readable id anywhere (check `geniex pull --help` / config internals).
- Whether the qairt runtime on Windows accepts `--nctx`/`--ngl` silently or errors (docs only specify the Android `PARAM_NOT_SUPPORTED` behavior).
- Whether Qualcomm AI Hub publishes any non-LLM/VLM (e.g. diffusion) bundles that GenieX could load — Get-started docs only ever mention LLMs and VLMs (audio-input VLMs elsewhere), so image/video generation appears unsupported, but the /en/models/supported page should be checked to confirm.
