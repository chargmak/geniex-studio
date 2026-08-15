# GenieX "Models & CLI" docs — exhaustive notes (verified against raw .md sources + local CLI v0.4.0 --help)

Sources fetched verbatim (the site serves raw Mintlify markdown at `<page-url>.md`; the index is `https://geniex.aihub.qualcomm.com/llms.txt`):
- https://geniex.aihub.qualcomm.com/en/models/supported.md
- https://geniex.aihub.qualcomm.com/en/run/cli/install.md
- https://geniex.aihub.qualcomm.com/en/run/cli/quickstart.md
- https://geniex.aihub.qualcomm.com/en/run/cli/local-server.md
- https://geniex.aihub.qualcomm.com/en/run/cli/reference.md
- (extra, because the CLI reference links to it for runtime constraints) https://geniex.aihub.qualcomm.com/en/get-started/platforms.md
- Local: `"C:\Users\stama\AppData\Local\GenieX CLI\geniex.exe" <cmd> --help --skip-update` for every command; `geniex list --format json`; `geniex config list`; `geniex model list`.

Full llms.txt index (other sections exist, not covered here): get-started/what-is-geniex, get-started/quickstart, get-started/platforms, models/supported, run/cli/{install,quickstart,local-server,reference}, run/python/{install,quickstart,api-reference}, run/linux/install, run/android/{install,quickstart,api-reference}, tutorials/speculative-decoding-mtp, tutorials/audio-input, resources/faq, resources/troubleshooting; GitHub https://github.com/qualcomm/GenieX ; Slack https://aihub.qualcomm.com/community/slack

---

## 1. Runtimes and compute units (from Models + Platforms pages)

Two runtimes:
- **`llama_cpp`** — any GGUF model (Hugging Face) via llama.cpp + Qualcomm's GGML Hexagon backend. Compute units: NPU / GPU / CPU (+ `hybrid`). Precision chosen by user at pull time.
- **`qairt`** (Qualcomm AI Engine Direct; a.k.a. Qualcomm AI Runtime / QAIRT) — pre-compiled, pre-quantized bundles from Qualcomm AI Hub, compiled per chipset. **NPU only.** Precision, context length, and KV cache size are baked into the bundle.

`--compute` / `-c` values: `cpu`, `gpu`, `npu`, `hybrid`. Default = `npu` for both runtimes.

llama.cpp mapping (platforms page):
| Alias | Effect |
|---|---|
| `npu` (default) | Pin to Hexagon NPU (`HTP0`). Best NPU-only path. |
| `gpu` | Adreno GPU via OpenCL. |
| `cpu` | Pure CPU. Forces `nGpuLayers = 0`. |
| `hybrid` | Empty `device_id` + `n_gpu_layers=-1` (all layers) — llama.cpp's per-tensor HTP+CPU scheduler. Docs call this "**The fast path on Snapdragon**" and say: "For llama.cpp's HTP + CPU per-tensor scheduling (the faster path on Snapdragon), pass `hybrid` explicitly." |

qairt mapping: `npu` (default) pins `HTP0`, "the only supported path"; `cpu`/`gpu` → per platforms page "Coerced to `npu` with a warning. Never an error." BUT per CLI reference page: "Qualcomm AI Hub Models run on NPU only. Using `--compute cpu` or `--compute gpu` returns an error." (docs contradict each other — see open questions).

qairt runtime constraints (platforms page): "The bundle has its precision, context length, and KV cache size baked in — none can be changed at runtime." `--nctx` has no effect for qairt. To change precision/context, get a different bundle from https://aihub.qualcomm.com/models/.

Chipset: GenieX auto-detects on Windows on Snapdragon. `geniex config get chipset` / `geniex config set chipset` (interactive picker). On this machine `geniex config list` → `chipset: Snapdragon X Elite CRD`. AI Hub chipset id for X Elite = `qualcomm-snapdragon-x-elite`; SoC id `X1E*`; all X Elite/X Plus SKUs map to the same AI Hub asset. GenieX runs ONLY on Snapdragon (no x86, no non-Snapdragon ARM).

## 2. Models page (models/supported)

Two places to get models:
- Qualcomm AI Hub (https://aihub.qualcomm.com/models/) — pre-compiled qairt bundles + curated GGUF models for llama.cpp.
- Hugging Face (https://huggingface.co/models?library=gguf) — any GGUF for llama.cpp.

**Input modalities table:**
| Modality | Supported by | Notes |
|---|---|---|
| Text | LLM, VLM | Every model. |
| Image | VLM | Any VLM (QAIRT bundle or GGUF with an image mmproj). |
| Audio | VLM (llama.cpp only) | A GGUF VLM whose mmproj carries a conformer encoder — e.g. `google/gemma-4-E2B-it-qat-q4_0-gguf`. QAIRT bundles do not support audio. |
"A single VLM turn can mix text, image, and audio."
Nothing about image/video/audio OUTPUT generation, embeddings, or TTS anywhere in this section. Model types are `llm` | `vlm` only.

**Run an AI Hub model:** `geniex infer ai-hub-models/Qwen3-4B` — "Qualcomm AI Engine Direct is NPU-only. Pass `--compute npu` or omit the flag." NOTE: local `geniex model list` (v0.4.0) prints names in the `qualcomm/*` namespace ("Names are ready to pull, e.g. 'geniex pull qualcomm/Qwen3-4B'"), and the local-server tool-calling example uses `qualcomm/Qwen3-VL-4B-Instruct`. Both `ai-hub-models/*` and `qualcomm/*` appear in docs.

**Run a GGUF from HF:** `geniex infer <org>/<repo>-GGUF` e.g. `geniex infer unsloth/Phi-4-mini-instruct-GGUF`. Prompts: Model type (`vlm` for vision-language e.g. Qwen3-VL family, `llm` otherwise); Precision (`Q4_0` for best Hexagon NPU support).

**HF token for gated models** — checked in order (first non-empty wins): 1) `GENIEX_HFTOKEN` env var, 2) `HF_TOKEN` env var, 3) `~/.cache/huggingface/token` file (written by `huggingface-cli login`). PowerShell: `$env:HF_TOKEN = "hf_..."` or `$env:GENIEX_HFTOKEN = "hf_..."`.

**Run a local qairt bundle (CLI):** register with `geniex pull local/<name> --local-path <abs path>` then `geniex infer local/<name>`.
- Self-converted from HF example (PowerShell):
```powershell
$model = "llama_v3_2_3b_instruct"
hf download yichqian/geniex-qairt-models `
  --local-dir $model `
  --include "$model/**"
geniex pull local/$model --local-path (Resolve-Path "$model\$model").Path
geniex infer local/$model
```
- Already on disk: `--local-path` → extracted bundle dir (containing `.bin` shards + `metadata.json`), e.g. `geniex pull local/my-bundle --local-path C:\models\my-bundle`.
- Directly from AI Hub `.zip` without extracting: `geniex pull local/my-bundle --local-path C:\downloads\model.zip`.
- `geniex pull` copies files into its local cache; delete the original afterwards; `geniex list` confirms.
- Python equivalent: `AutoModelForCausalLM.from_pretrained(r"C:\<your_path>\Qwen3-4B-Instruct-2507", model_name="qwen3_4b_instruct_2507", device_map="qairt")`.
- Android: `HubSource.LOCALFS`; model_name is just a cache key ("`local/...` prefix is a common convention"); a QAIRT folder is recognized by `metadata.json` + `.bin` shards (or `.zip`); loose `.bin` files without `metadata.json` won't be detected.

**Run a local GGUF (CLI):** `geniex pull local/my-model --local-path C:\models\my-model` (dir containing the `.gguf`), then `geniex infer local/my-model`. Python: `from_pretrained(r"C:\models\my-model\model.gguf", device_map="auto")` — "auto -> npu for llama_cpp". Android: `geniex.json` manifest used if present, else layout inferred from file names; for VLM drop `mmproj-*.gguf` in same dir; `ModelConfig(nCtx = 4096)`; `compute_unit = null` → NPU.

**Precisions (Quantizations) — llama.cpp** (CLI prompts at pull):
```
Choose a precision version to download
> Q4_0       [1.2 GiB] (default)
  Q8_0       [2.0 GiB]
  F16        [3.8 GiB]
```
| Precision | Runs on | Notes |
|---|---|---|
| **`Q4_0`** (default) | **Hexagon NPU** | Best NPU support in llama.cpp. Recommended for most models. |
| `Q8_0` | GPU / CPU | Better quality at ~2× the disk and memory cost. |
| `F16` | GPU / CPU | Reference precision. Mainly for evaluation — large and slow. |
| `Q4_K_M`, `Q5_K_M`, etc. | GPU / CPU | Mixed-precision K-quants. Not optimized for Hexagon NPU. |
Tip: "Stick with `Q4_0` if you want the model to land on the Hexagon NPU. Other precisions will work but typically run on GPU or CPU."

**Precisions — Qualcomm AI Engine Direct** (statically pre-quantized, no runtime choice):
| Precision | Runs on | Notes |
|---|---|---|
| **`w4a16`** (most common) | Hexagon NPU | Weights int4, activations int16. Best balance of size and accuracy. |
| `w4` | Hexagon NPU | Weights int4, activations float. Slightly higher accuracy than w4a16 at the cost of more compute. |

## 3. CLI Install page

- Ships as native **Windows ARM64** executable and Linux ARM64 (native or Docker, for Dragonwing QCS9075 etc.).
- Windows prerequisites: Snapdragon X-series (X Elite or X2 Elite); PowerShell.
- Installer: https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/geniex-cli.exe — "The installer is not yet code-signed — Windows SmartScreen will warn you. Click More info → Run anyway."
- Add to PATH: `Set-Alias geniex (where.exe geniex)`; verify `geniex --help`.
- Linux native: apt `libatomic1 libglib2.0-0 ocl-icd-libopencl1`, then `sudo apt-get install -y qcom-adreno1 qcom-fastrpc1 libqnn1` (PPA `ppa:ubuntu-qcom-iot/qcom-ppa`); libs needed: `libOpenCL_adreno.so.1`, `libCB.so.1`, `libadreno_utils.so.1`, `libgsl.so.1`, `libllvm-*.so.1` (qcom-adreno1), `libdmabufheap.so.0.0.0`, `libpropertyvault.so.0.0.0`, `libcdsprpc.so.1.0.0` (qcom-fastrpc1). Install script: `curl -fsSL https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/install.sh | sh` (verifies SHA256, no sudo; flags after `sh -s --`: `--version v0.1.8`, `--prefix /opt/geniex`). Root → `/usr/local/lib/geniex/` + `/usr/local/bin/geniex`; non-root → `${XDG_DATA_HOME:-~/.local/share}/geniex/` + `~/.local/bin/geniex`. Export `HOME=/root` if unset.
- Update: CLI has `geniex update` ("Update geniex to the latest version") and auto-checks for updates unless `--skip-update`.

## 4. CLI Quickstart page

- Prereqs: CLI installed; know runtime choice (`qairt` for AI Hub models, `llama_cpp` for any GGUF).
- qairt examples: `geniex infer ai-hub-models/Qwen3-4B` (LLM); `geniex infer ai-hub-models/Qwen2.5-VL-7B-Instruct` (VLM).
- llama.cpp examples: `geniex infer unsloth/Qwen3.5-0.8B-GGUF` (LLM); `geniex infer Qwen/Qwen3-VL-2B-Instruct-GGUF` (VLM). Pick `Q4_0`.
- Prompt guidance: "For `Qwen3.5` and `Gemma4`, pick `llm` for now (multimodal support coming soon)." (roadmap hint: multimodal for Qwen3.5/Gemma4 GGUF coming.)
- Local models via `geniex pull --local-path` (see Models page).
- Next steps: Local server on `localhost:18181`; CLI reference.

## 5. Local server page (OpenAI-compatible HTTP API)

- "Run models on-device and connect them to any application or framework that speaks the OpenAI protocol — agentic frameworks like LangChain, AI-native apps like OpenClaw, or your own code."
- Prereqs: CLI installed; **a model pulled — `geniex serve` does NOT auto-download models.**
- Start: `geniex pull ai-hub-models/Qwen3-4B-Instruct-2507` then `geniex serve`. Default `http://127.0.0.1:18181`. `geniex serve -h` for options.
- **Built-in Swagger UI at `http://127.0.0.1:18181`** (browser) — shows example request body + schema, Try it out / Execute. (Use this to read the exact OpenAPI schema incl. `/v1/models` response, which the docs do not spell out.)

**Endpoints documented:**
- `POST /v1/chat/completions` — conversation; LLM (text) and VLM (text + image or audio). Streaming supported.
- `POST /v1/completions` — raw prompt continuation, no chat template. LLM only.
- `GET /v1/models` — list available models.
- `GET /v1/models/{model}` — info about a specific model.
No other endpoints documented (no embeddings, images, audio transcription/speech, files, etc.).

**Chat request example (LLM):**
```json
{
  "model": "ai-hub-models/Qwen3-4B-Instruct-2507",
  "messages": [{"role": "user", "content": "Hello! Briefly introduce yourself."}],
  "max_tokens": 256,
  "temperature": 0.7,
  "stream": false
}
```
Documented request fields: `model` (with optional `:<precision>` suffix e.g. `unsloth/Qwen3-4B-GGUF:Q4_0`, `Q4_K_M`, `Q8_0`), `messages`, `max_tokens`, `temperature`, `stream`, `stop`, `tools`, `tool_choice` ("auto"), plus extra_body fields `enable_think` (bool) and `reasoning_format` (string). `/v1/completions` also: `prompt`, `echo`, sampler knobs `temperature`, `top_p`, `top_k`, `min_p`, `repetition_penalty`, `seed` ("work as on /v1/chat/completions"); `suffix` is NOT supported.

**VLM content parts:** `{"type":"text","text":...}`, `{"type":"image_url","image_url":{"url":...}}`, `{"type":"input_audio","input_audio":{"data":...}}`. Both `image_url.url` and `input_audio.data` accept the same three formats:
| Format | Image example | Audio example |
|---|---|---|
| Local file path (`file://` prefix optional) | `C:/Users/Username/Pictures/photo.jpg` | `/data/jfk.wav`, `file:///tmp/jfk.wav` |
| HTTP/HTTPS URL — fetched by the server | `https://example.com/image.jpg` | `https://example.com/clip.mp3` |
| Base64 data URL | `data:image/png;base64,iVBORw0KGgo...` | `data:audio/wav;base64,UklGR...` |
A single message can mix `image_url` and `input_audio`. Docker note: local paths resolve inside the container; `$PWD/data` is mounted to `/data`.
Warning: "Audio input runs on the llama.cpp backend only. QAIRT models report `audio: false` and a QAIRT model given audio fails with `GenieXError(-201201): Multimodal generation failed`." (`audio: false` implies the model info/capabilities exposes an `audio` boolean.)

VLM curl:
```bash
curl http://127.0.0.1:18181/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemma-4-E2B-it-qat-q4_0-gguf",
    "messages": [{"role": "user","content": [
        {"type": "text", "text": "Describe the image, then transcribe the audio."},
        {"type": "image_url", "image_url": {"url": "/full/path/to/landmark.jpg"}},
        {"type": "input_audio", "input_audio": {"data": "/full/path/to/jfk.wav"}}
    ]}],
    "max_tokens": 256
  }'
```

**/v1/completions example (FIM):**
```json
{
  "model": "unsloth/Qwen2.5-Coder-3B-GGUF:Q4_0",
  "prompt": "<|fim_prefix|>def fibonacci(n):\n    <|fim_suffix|>\n    return a<|fim_middle|>",
  "max_tokens": 64,
  "temperature": 0.2,
  "stop": ["<|endoftext|>"],
  "stream": false
}
```
Response `choices[0].text` = raw completion.

**Python OpenAI SDK client:**
```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18181/v1", api_key="geniex")  # any non-empty string; server does not check it
```
Streaming: `stream=True`, iterate `chunk.choices[0].delta.content` (standard OpenAI SSE chunk shape). Non-streaming: `resp.choices[0].message.content`, `finish_reason` ("stop"), `resp.usage` → `CompletionUsage(completion_tokens=58, prompt_tokens=19, total_tokens=77, ...)`.

**Thinking control:** `extra_body={"enable_think": False}` — "turns off Qwen3's default `<think>…</think>` reasoning prefix". Default: thinking on (CLI `--think` default true).

**Separating reasoning:** `extra_body={"reasoning_format": "deepseek"}` moves chain-of-thought into `message.reasoning_content` (read via `msg.model_extra.get("reasoning_content")`), leaving `content` clean. Values: `none` (default, kept inline in `content` as `<think>…</think>`), `deepseek` / `deepseek-legacy` / `auto` (all separate). Streaming: CoT arrives as `delta.reasoning_content`, reply as `delta.content`. "Tool-call requests ignore this parameter (tool parsing needs the raw tagged text)." `reasoning_format` ≠ `enable_think`.

**Tool calling:** standard OpenAI `tools` schema (`{"type":"function","function":{"name","description","parameters"}}`) + `tool_choice="auto"`. "The server extracts the tool call from the model's generated text (`<tool_call>…</tool_call>` tags or a fenced ```json block) and re-emits it as OpenAI `tool_calls`." Works with VLMs too. `finish_reason` = `"tool_calls"`; access `first.choices[0].message.tool_calls[0]` → `.id`, `.function.name`, `.function.arguments` (JSON string). Follow-up turn: append the assistant message and `{"role":"tool","tool_call_id": call.id, "content": json.dumps(result)}`.
LIMIT: "Only one tool call per assistant turn is parsed — parallel tool calls in a single response are not supported."
Qwen3-VL tips: (1) prime with a system message that spells out the exact `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` shape; (2) on the follow-up turn drop `tools=` and drop the image content to avoid re-invoking the tool and re-running the vision encoder.
Full example (model `qualcomm/Qwen3-VL-4B-Instruct`, `pip install ddgs`):
```python
tools = [{"type":"function","function":{"name":"web_search","description":"Search the web for travel information about a location.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Search query, e.g. 'things to do in Kyoto'"}},"required":["query"]}}}]
system_prompt = ("You are a travel assistant. Call the web_search tool to look up any location the user asks about before answering. Once you receive the tool results, do not call the tool again - use them to write a short, friendly reply for the user. Emit tool calls in the exact format: <tool_call>{\"name\": \"web_search\", \"arguments\": {\"query\": \"<your query>\"}}</tool_call>")
messages = [{"role":"system","content":system_prompt},{"role":"user","content":[{"type":"image_url","image_url":{"url":IMAGE_URL}},{"type":"text","text":"Identify the landmark, then call web_search for travel tips about it."}]}]
first = client.chat.completions.create(model="qualcomm/Qwen3-VL-4B-Instruct", messages=messages, tools=tools, tool_choice="auto", max_tokens=512, extra_body={"enable_think": False})
call = first.choices[0].message.tool_calls[0]   # finish_reason == "tool_calls"
result = web_search(**json.loads(call.function.arguments))
followup = [{"role":"system","content":system_prompt},{"role":"user","content":"Summarize travel tips using the search results below."}, first.choices[0].message, {"role":"tool","tool_call_id":call.id,"content":json.dumps(result)}]
final = client.chat.completions.create(model="qualcomm/Qwen3-VL-4B-Instruct", messages=followup, max_tokens=256, extra_body={"enable_think": False})
```

**`geniex serve` flags (from local v0.4.0 --help; docs only say "run geniex serve -h"):**
```
--host string       Default server address (env: GENIEX_HOST) (default "127.0.0.1:18181")
--origins string    Default CORS origins (env: GENIEX_ORIGINS) (default "*")
--keepalive int     Keepalive seconds (env: GENIEX_KEEPALIVE) (default 300)
--nctx int32        Default context window size, llama_cpp only (env: GENIEX_NCTX) (default 4096)
-n, --ngl int32     Default layers to offload to gpu/npu, -1 = all, llama_cpp only (env: GENIEX_NGL) (default -1)
-c, --compute string  Default compute unit: cpu, gpu, npu, or hybrid (env: GENIEX_COMPUTE)
--https             Enable HTTPS/TLS (env: GENIEX_HTTPS)
--certfile string   TLS certificate file path (env: GENIEX_CERTFILE) (default "cert.pem")
--keyfile string    TLS private key file path (env: GENIEX_KEYFILE) (default "key.pem")
```
Global flags: `--data-dir string` (env `GENIEX_DATADIR`), `--log string` none|error|warn|info|debug|trace (env `GENIEX_LOG`, default none), `--skip-update`, `--verbose`, `-v/--version`.
Keepalive/model-unload semantics, concurrency, per-request compute selection, and `/v1/models` response schema are NOT documented on these pages (keepalive is only visible via `--keepalive` = "Keepalive seconds", default 300 — presumably idle-unload timer; verify via Swagger UI / testing).

## 6. CLI reference page (verbatim content + local --help additions)

**Top-level commands (local --help):** Model: `pull`, `remove` (alias `rm`), `clean`, `list` (alias `ls`), `model` (`set-type`, `list`). Inference: `infer`, `serve`, `run` ("Infer a model with server"). Management: `config` (`get`/`set`/`list`; "Available keys: chipset"), `version`, `update`. Additional: `help`, `completion` (shell autocompletion).

**`geniex pull <model-name>[:<precision>]`**
| Flag | Description |
|---|---|
| `--model-hub` | `aihub` \| `hf` \| `localfs` (docs); local help adds `docker`. Auto-detected when omitted. |
| `--local-path` | Path to local dir or AI Hub `.zip`. Implies `--model-hub localfs`. |
| `--model-type` | `llm` \| `vlm`. Auto-detected when omitted. |
Local help: "Append ':<precision>' to pull a specific precision; otherwise you'll be prompted." "Docker Hub models (e.g. `docker.io/ai/gemma3`, or `ai/gemma3` with `--model-hub docker`) use ':<tag>' instead of a precision — omit it to pull the 'latest' tag." AI Hub models are pre-quantized — no precision choice.

**`geniex infer <model-name>[:<precision>] [flags]`** — interactive chat session. Thinking: `--think` (show reasoning) / `--think=false` (respond directly). Compute: `--compute npu|gpu|cpu` (llama.cpp supports all; AI Hub NPU only). VLM: text-only just chat; for image/audio give the **absolute path** or drag file into terminal — image (`.jpg`, `.jpeg`, `.png`, `.webp`) and audio (`.wav`, `.mp3`) paths auto-detected; one prompt can carry both. `google/gemma-4-E2B-it-qat-q4_0-gguf` ~4.0 GiB (Q4_0 weights + conformer mmproj, pulled together). Example: `geniex infer google/gemma-4-E2B-it-qat-q4_0-gguf -p "Describe the image and transcribe the audio. Image: /full/path/to/landmark.jpg Audio: /full/path/to/jfk.wav"` (verified on `--compute npu`, Snapdragon X Elite). Interactive `/mic` records a clip (Ctrl-C stops + transcribes) — needs **SoX** on PATH (`winget install --id=ChrisBagwell.SoX -e`); else warns `SoX is not installed`.

**`geniex run <model-name>[:<precision>]`** (local help): "Infer a model with server. The server must be running and the model should be downloaded and cached locally." Same flag set as `infer`.

**Sampler flags (infer/run):**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--temperature` | float | — | Sampling temperature |
| `--top-p` | float | — | nucleus |
| `--top-k` | int | — | top-k |
| `--min-p` | float | — | min-p |
| `--repetition-penalty` | float | `1` | >1 reduces repetition |
| `--presence-penalty` | float | — | |
| `--frequency-penalty` | float | — | |
| `--seed` | int | — | reproducible outputs |
| `--grammar-path` | string | — | GBNF grammar file (constrained generation) |
| `--grammar-string` | string | — | inline GBNF |
| `--enable-json` | — | — | Force JSON-only output (docs only; NOT present in local v0.4.0 --help) |

**Model flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --compute` | string | `npu` | cpu, gpu, npu, hybrid |
| `-n, --ngl` | int | `-1` | layers to offload to GPU/NPU, -1 = all (llama_cpp only) |
| `--nctx` | int | `4096` | context window (max input+output tokens); llama_cpp only |
| `--max-tokens` | int | `2048` | max tokens per response |
| `--stop` | string[] | — | stop sequences (repeatable; llama_cpp only per local help) |
| `--stop-file` | string | — | file of stop sequences, one per line (llama_cpp only) |
| `--think` / `--think=false` | bool | `true` | thinking mode |
| `-s, --system-prompt` | string | — | system prompt |
| `-i, --input` | string | — | prompt txt file (local help) |
| `-p, --prompt` | stringArray | — | pass prompt (local help) |
| `-t, --token-file` | string | — | space-separated token IDs (llama_cpp only; local help) |
| `--sliding-window` | — | `false` | (qairt only) evict oldest context above a small anchored prefix instead of erroring on context overflow |
| `--spec-type` | string | — | speculative decoding type(s), comma-separated: `draft-mtp`,`draft-eagle3`,`draft-simple`,`ngram-simple`,`ngram-map-k`,`ngram-map-k4v`,`ngram-mod`,`ngram-cache` (llama_cpp only; local help) |
| `--draft-model` | string | — | draft/MTP model for draft-* types: catalogue name or local GGUF path (llama_cpp only) |
| `--draft-tokens` | int32 | `3` | max draft tokens per step |
| `--draft-min` | int32 | 0 (=llama.cpp default) | min draft tokens per step |
| `--draft-p-min` | float32 | 0 (=llama.cpp default) | min greedy draft probability |
(Speculative decoding is otherwise documented in the tutorial `tutorials/speculative-decoding-mtp`, not in this section.)

**Context length:** llama.cpp: `--nctx <N>` raises at runtime up to the model's trained maximum; larger window = more KV-cache memory (`geniex infer unsloth/Qwen3-8B-GGUF --nctx 8192`). qairt: baked into bundle, `--nctx` no effect; use `--sliding-window` or pull a longer-context bundle. Error text: "context length exceeded".

**Logging:** `--log` global flag ≡ `GENIEX_LOG` env (flag wins). Values `none` (CLI default), `error`, `warn`, `info`, `debug`, `trace`. e.g. `geniex --log debug list`.

**Utility:** `geniex list` (names + sizes; local: `--format table|json|csv`, stable schema; on this machine `geniex list --format json` → `[]`, i.e. no models cached), `geniex remove <model>[:<precision>] ...` (`-y/--yes` skip confirm; precision suffix removes single precision), `geniex clean` (delete all cached models), `geniex model set-type <model-name> [llm|vlm]` (override type in cached manifest; interactive if omitted), `geniex model list [--all]` (AI Hub models with a qairt (NPU) build compatible with this device).

**`geniex model list` output on this machine (Snapdragon X Elite CRD), all in `qualcomm/*` namespace:** llm: Falcon3-7B-Instruct, Llama-SEA-LION-v3.5-8B-R, Llama-v3-8B-Instruct, Llama-v3-ELYZA-JP-8B, Llama-v3.1-8B-Instruct, Llama-v3.2-1B-Instruct, Llama-v3.2-3B-Instruct, Llama-v3.2-3B-Instruct-SSD, Llama3-TAIDE-LX-8B-Chat-Alpha1, Phi-3.5-Mini-Instruct, Qwen3-0.6B, Qwen3-1.7B, Qwen3-4B, Qwen3-4B-Instruct-2507, Qwen3-8B; vlm: Gemma-4-E4B-it, Qwen2.5-VL-7B-Instruct, Qwen3-VL-4B-Instruct, Qwen3-VL-8B-Instruct.

**Version on this machine:** `GenieX CLI Version: v0.4.0`, `QAIRT Runtime Version: v2.45.0.260326`, `LlamaCPP Runtime Hash: 6ba5ef2`.

## 7. Explicit NOT-supported / limitations list (from these pages)
- qairt (AI Hub bundles): NPU only; no CPU/GPU; no audio input (`audio: false`, error `GenieXError(-201201)`); precision/context/KV cache fixed; `--nctx`/`--ngl` no effect.
- Audio input: llama.cpp only, needs conformer mmproj (e.g. gemma-4-E2B).
- Tool calling: one tool call per assistant turn; no parallel tool calls; `reasoning_format` ignored on tool-call requests.
- `/v1/completions`: LLM only; `suffix` not supported.
- `geniex serve` does not auto-download models.
- Windows installer not code-signed.
- Qwen3.5 / Gemma4 GGUF: pick `llm` "for now (multimodal support coming soon)".
- K-quants / Q8_0 / F16 not optimized for Hexagon NPU (run on GPU/CPU).
- Only Snapdragon hardware; only model types `llm`/`vlm`. No mention of embeddings, image generation, video, TTS, or any diffusion model support anywhere in the section.

## KEY FACTS
- Raw markdown of every docs page is served at <page-url>.md; index at https://geniex.aihub.qualcomm.com/llms.txt (WebFetch summarizes; use Invoke-WebRequest for verbatim).
- Two runtimes: llama_cpp (any GGUF, compute npu|gpu|cpu|hybrid; Q4_0 is the only precision that lands on Hexagon NPU; --nctx/--ngl adjustable) and qairt/Qualcomm AI Engine Direct (AI Hub pre-compiled bundles, NPU only, precision/context/KV cache baked in, --nctx no effect, use --sliding-window on overflow).
- Default compute is npu (pinned HTP0) for both runtimes; docs call `hybrid` (per-tensor HTP+CPU scheduler, n_gpu_layers=-1) 'the fast path on Snapdragon' for llama.cpp.
- Server: `geniex serve` -> http://127.0.0.1:18181 with Swagger UI at root; endpoints POST /v1/chat/completions, POST /v1/completions (raw, no chat template, LLM only, no `suffix`), GET /v1/models, GET /v1/models/{model}. Serve flags (v0.4.0): --host, --origins (default *), --keepalive (default 300s), --nctx, --ngl, --compute, --https/--certfile/--keyfile; env GENIEX_HOST/ORIGINS/KEEPALIVE/NCTX/NGL/COMPUTE/HTTPS/CERTFILE/KEYFILE/DATADIR/LOG.
- OpenAI SDK works with base_url=http://127.0.0.1:18181/v1 and any non-empty api_key; model id may carry `:<precision>` suffix (e.g. unsloth/Qwen3-4B-GGUF:Q4_0); streaming uses standard delta.content chunks.
- Extra body params: `enable_think` (bool, disables <think> generation) and `reasoning_format` (none|deepseek|deepseek-legacy|auto) which moves CoT to message.reasoning_content / delta.reasoning_content; ignored on tool-call requests.
- Tool calling: standard OpenAI `tools` + tool_choice=auto; server parses <tool_call>...</tool_call> or fenced ```json from model text into tool_calls with finish_reason 'tool_calls'; ONLY ONE tool call per assistant turn (no parallel); works with VLMs; Qwen3-VL needs a system prompt spelling out the <tool_call> JSON shape.
- VLM input: content parts image_url.url / input_audio.data accept local file path (file:// optional), http(s) URL (fetched by server), or base64 data URL; one message can mix image+audio; audio only on llama.cpp with conformer mmproj (google/gemma-4-E2B-it-qat-q4_0-gguf), QAIRT models report audio:false and fail with GenieXError(-201201).
- geniex serve does NOT auto-download models; pull first. Hubs: aihub|hf|docker|localfs (docker uses :<tag> not precision; localfs via --local-path dir or AI Hub .zip). HF gated token order: GENIEX_HFTOKEN > HF_TOKEN > ~/.cache/huggingface/token.
- Model types are only llm|vlm; docs mention no embeddings, image generation, video, or TTS endpoints/models anywhere in the section.
- CLI infer/run flags include GBNF grammar (--grammar-path/--grammar-string; docs also list --enable-json which is absent from local v0.4.0 help), sampler knobs, --think, --system-prompt, --stop/--stop-file (llama_cpp only), speculative decoding --spec-type draft-mtp|draft-eagle3|draft-simple|ngram-* with --draft-model/--draft-tokens(3)/--draft-min/--draft-p-min (llama_cpp only).
- This machine: GenieX CLI v0.4.0, QAIRT v2.45.0.260326, llama.cpp hash 6ba5ef2, chipset config 'Snapdragon X Elite CRD', zero cached models; `geniex model list` shows 19 qairt-compatible AI Hub models in the qualcomm/* namespace (Qwen3 0.6B–8B, Qwen3-4B-Instruct-2507, Llama 3.x, Phi-3.5, Falcon3-7B, VLMs: Qwen3-VL-4B/8B, Qwen2.5-VL-7B, Gemma-4-E4B-it).
- Roadmap hint: Qwen3.5 / Gemma4 GGUF multimodal 'coming soon' (pick llm for now); Windows installer not yet code-signed.

## OPEN QUESTIONS
- Model namespace: docs use `ai-hub-models/<Name>` for AI Hub pulls but v0.4.0 `geniex model list` and the tool-calling example use `qualcomm/<Name>` — need to confirm which (or both) v0.4.0 accepts on pull/serve.
- Contradiction: CLI reference says `--compute cpu|gpu` with AI Hub models 'returns an error', platforms page says they are 'coerced to npu with a warning. Never an error.' — verify actual v0.4.0 behavior.
- Server internals not documented on these pages: exact `/v1/models` and `/v1/models/{model}` response JSON (incl. the implied `audio` capability boolean), error response shapes, SSE framing details, whether per-request `compute`/`nctx`/`ngl` overrides exist, keepalive/idle-unload semantics (--keepalive default 300s), concurrency/queueing, and whether multiple models can be loaded at once — inspect the Swagger UI/OpenAPI at http://127.0.0.1:18181 once the server is run.
- Whether server-side JSON/grammar-constrained output is exposed (CLI has --grammar-path/--grammar-string and docs list --enable-json; OpenAI `response_format` support is not mentioned).
- `--enable-json` appears in the docs sampler table but not in local v0.4.0 `infer --help` — may be newer or removed.
- Whether speculative decoding (--spec-type/--draft-model) is configurable via `geniex serve` or per-request; only infer/run flags show it (see tutorials/speculative-decoding-mtp, outside this section).
- No documentation in this section of embeddings, image/video generation, or TTS — confirm in FAQ/other sections whether these are planned; per these pages GenieX is LLM/VLM-only.
