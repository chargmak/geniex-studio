# GenieX docs — "Python SDK & Linux (Docker)" section: exhaustive notes

Sources read in full (raw markdown, not summaries). NOTE FOR PARENT: `WebFetch` on this Mintlify site returns a lossy summary; the reliable way to get verbatim page text is to append `.md` to any docs URL (e.g. `https://geniex.aihub.qualcomm.com/en/run/python/api-reference.md`). Full page index at `https://geniex.aihub.qualcomm.com/llms.txt`. In addition to the 4 assigned pages I read the Python SDK source on GitHub (`qualcomm/GenieX` → `bindings/python/**`, `_sdk_fetch.py`, `BUILD.md`, `examples/python/windows.ipynb`), the PyPI JSON metadata for `geniex`, and the directly cross-linked pages (Audio-input tutorial §Python, FAQ §Python, Platforms §runtimes). Items marked **[SOURCE]** come from the GitHub source, not the docs pages; items marked **[INFERENCE]** are my conclusions.

---

## 1. Page: Python Install — https://geniex.aihub.qualcomm.com/en/run/python/install

- Tagline: "Install the GenieX Python SDK on Windows ARM64 or Linux ARM64." "The GenieX Python SDK ships as an ARM64 wheel for Windows ARM64 and Linux ARM64."
- **Prerequisites**
  - "Snapdragon X-series chipset (X Elite or X2 Elite). See Supported platforms (/en/get-started/platforms)."
  - "**ARM64 Python 3.10+** — x86_64 / AMD64 builds are not supported."
- **Install via pip — Windows ARM64 tab**
  - "If Python is not installed, download Python 3.13.3 for ARM64" → `https://www.python.org/ftp/python/3.13.3/python-3.13.3-arm64.exe`
  - "Confirm Python is the ARM64 build — **must print `ARM64`** (not `AMD64`)":
    ```powershell
    python -c "import platform; print(platform.machine())"
    ```
  - Create venv and install:
    ```powershell
    python -m venv geniex-env
    .\geniex-env\Scripts\Activate.ps1
    pip install -U geniex
    ```
  - "This pulls the package from PyPI (https://pypi.org/project/geniex/)."
- **Install via pip — Linux ARM64 tab**
  - "The Qualcomm embedded Linux (Yocto) ships with Python pre-installed. Verify with: `python3 --version`"
  - `python3 -m pip install -U geniex` — "This pulls the package from PyPI and auto-fetches the Linux ARM64 SDK libraries."
  - Note: "If Python is not pre-installed, see [How do I install Python on a Linux ARM64 device?](/en/resources/faq#how-do-i-install-python-on-a-linux-arm64-device) for a verified Miniconda recipe (covers Qualcomm Yocto and Ubuntu ARM64)."
- **Verify**
  ```python
  import geniex
  print(geniex.version())
  ```
- Next: Quickstart (/en/run/python/quickstart).

### 1a. Install mechanics [SOURCE + PyPI metadata] — important for a Windows ARM64 / Python 3.14 machine
- PyPI `geniex` latest = **0.4.0**; releases: 0.3.14, 0.3.16–0.3.20, 0.4.0. `requires_python` is empty. Only artifact is a **source tarball `geniex-0.4.0.tar.gz` (58 KB)** — no binary wheels on PyPI (docs' "ships as an ARM64 wheel" is loose wording; the wheel is *assembled locally* at install time). Deps: `tqdm>=4.65`; extras `notebook` (`ipywidgets>=8`), `test` (`pytest>=7.0`).
- Build backend is an in-tree PEP 517 wrapper `_geniex_backend` (aliases `tomli`→`tomllib` for Qualcomm Linux's stripped Python 3.12), `build-system.requires = ["setuptools>=77.0", "wheel", "tomli>=2.0"]` → **pip needs network + build isolation**.
- Custom `build_py` runs `_sdk_fetch.fetch(...)` during `pip install`, which downloads the native SDK zip **`geniex-sdk-<platform>-<release_tag>.zip`** — platform map: `('win32','arm64') → 'windows-arm64'`, `('linux','aarch64'|'arm64') → 'linux-arm64'`; any other platform → `RuntimeError('Unsupported platform ...')` and pip aborts. Sources tried in order: S3 `https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/<asset>` then GitHub `https://github.com/qualcomm/GenieX/releases/download/<tag>/<asset>`. It first fetches `<asset>.sha256`, then does an HTTP-Range partial fetch of just the needed zip entries (core `geniex.dll`/`libgeniex.so` + `lib/llama_cpp/**` and/or `lib/qairt/**`), falling back to full download + SHA-256 check when Range isn't honored. Libs land in `site-packages/geniex/lib/` (`geniex.dll`, `lib/llama_cpp/`, `lib/qairt/`). I HEAD-checked: `geniex-sdk-windows-arm64-v0.4.0.zip` exists on both S3 and GitHub, **83,853,224 bytes**, `Accept-Ranges: bytes`.
- Three mutually-exclusive distributions with the same `geniex` import surface: `pip install geniex` (llama.cpp **and** QAIRT, "~220 MB"), `pip install geniex-llama-cpp` (llama.cpp only, "~15 MB"), `pip install geniex-qairt` (QAIRT only, "~210 MB"). "Installing two into the same environment will have the second install overwrite the first."
- Build-time env vars: `GENIEX_SDK_DOWNLOAD_URL` (override base URL, supports `file:///`, pins single source), `GENIEX_SKIP_SDK_DOWNLOAD=1` (skip; then set `GENIEX_LIB_PATH` at runtime).
- **Warning (README):** "Do not install `llama-cpp-python` into the same environment. Both packages embed their own llama.cpp shared libraries; loading both leads to symbol conflicts — `DLL load failed` on Windows, segfaults, or wrong outputs."
- Native loader (`_ffi/_lib.py`): search order `GENIEX_LIB_PATH` → wheel layout (`geniex/lib/geniex.dll`) → in-tree dev build (`<repo>/sdk/pkg-geniex/lib`) → OS linker. On Windows it calls `os.add_dll_directory()` for `lib/` and each plugin subdir, pre-loads all `.dll`s with ctypes, prepends to `PATH`, and sets `GENIEX_PLUGIN_PATH` if unset. Everything is `ctypes` (no compiled CPython extension) → **[INFERENCE] Python 3.14 ARM64 should be usable** (docs say 3.10+, docs installer link is 3.13.3, notebook kernel was 3.12.10); untested by docs.
- Console script `geniex-py` (name chosen to avoid clashing with the Go `geniex` binary). PyPI package `_version.py` on `main` says `0.1.0`; release builds substitute the tag.

---

## 2. Page: Python Quickstart — https://geniex.aihub.qualcomm.com/en/run/python/quickstart

- Tagline: "Run your first model from the GenieX Python SDK on Windows ARM64."
- Prereqs: SDK installed; "Familiarity with runtime choice — `qairt` for Qualcomm AI Hub Models, `llama_cpp` for any GGUF."
- "The SDK follows the same design as Hugging Face `transformers` — load with `AutoModelForCausalLM.from_pretrained()`, then call `.generate()`."

### LLM inference (GGUF) — verbatim
"Any GGUF model from Hugging Face runs via `llama_cpp`. Model weights are downloaded on first use."
```python
from geniex import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-0.6B-GGUF",     # HF repo id of a GGUF model, or a local .gguf path
    device_map="auto",          # "auto" | "cpu" | "gpu" | "npu" | "hybrid"
                                # | "<runtime>" | "<runtime>:<compute-unit>"
                                # auto -> npu for both llama_cpp and qairt
)

messages = [{"role": "user", "content": "What is 2+2?"}]
prompt = model.tokenizer.apply_chat_template(
    messages, add_generation_prompt=True,
)

# One-shot
output = model.generate(prompt, max_new_tokens=256)
print(output.text)
print(f"[{output.profile.generated_tokens} tok, "
      f"{output.profile.decode_speed:.1f} tok/s, stop={output.profile.stop_reason}]")

# Streaming
streamer = model.generate(prompt, max_new_tokens=256, stream=True)
for chunk in streamer:
    print(chunk, end="", flush=True)

model.close()
```

### LLM inference (QAIRT) — verbatim
"Pre-compiled bundles from Qualcomm AI Hub run entirely on the Hexagon NPU via the `qairt` runtime. Use `device_map="qairt"` (or `"npu"`). Model weights are downloaded on first use."
```python
from geniex import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained(
    "ai-hub-models/Qwen3-4B",   # Qualcomm AI Hub model id
    device_map="qairt",         # NPU-only
)
# ... identical apply_chat_template / generate / stream / close as above
```

### VLM inference (QAIRT) — verbatim
```bash
curl -o demo.jpg https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/demo.jpg
```
```python
import os
from geniex import AutoModelForCausalLM

image_path = os.path.abspath("demo.jpg")

model = AutoModelForCausalLM.from_pretrained(
    "ai-hub-models/Qwen2.5-VL-7B-Instruct",  # Qualcomm AI Hub VLM bundle
    device_map="qairt",
)
messages = [{
    "role": "user",
    "content": [
        {"type": "image", "image": image_path},
        {"type": "text", "text": "Describe the image."},
    ],
}]
prompt = model.tokenizer.apply_chat_template(
    messages, tokenize=False, add_generation_prompt=True,
)

streamer = model.generate(prompt, images=[image_path], max_new_tokens=256, stream=True)
for chunk in streamer:
    print(chunk, end="", flush=True)

model.close()
```
**VLM image input format (Python SDK): message content is a list of typed parts `{"type": "image", "image": "<abs file path>"}` + `{"type": "text", "text": "..."}`; AND the same paths must be passed again as `generate(images=[...])`. File paths only (no URLs / base64 in the Python SDK).**

### Audio inference (GGUF) — verbatim
"Audio input runs on the **llama.cpp** backend with an audio-capable model — its mmproj must carry a conformer encoder. `google/gemma-4-E2B-it-qat-q4_0-gguf` is one such model. Load it with `AutoModelForVision2Seq`, then pass file paths to `generate(images=[...], audios=[...])` — a single call can carry both."
- **Warning:** "Audio input runs on the **llama.cpp** backend only. QAIRT bundles report `capabilities()['audio'] == False` and raise `GenieXError(-201201): Multimodal generation failed` if given audio."
```bash
curl -L -o jfk.wav https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav
curl -L -o landmark.jpg "https://images.pexels.com/photos/402028/pexels-photo-402028.jpeg?w=1024"
```
```python
import os
from geniex import AutoModelForVision2Seq

image_path = os.path.abspath("landmark.jpg")
audio_path = os.path.abspath("jfk.wav")

model = AutoModelForVision2Seq.from_pretrained(
    "google/gemma-4-E2B-it-qat-q4_0-gguf",  # GGUF VLM with an audio mmproj
    device_map="npu",                       # audio runs on npu / gpu / cpu, not qairt
)
# capabilities() confirms the loaded mmproj handles audio.
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
"Output (verified on `device_map="npu"`, Snapdragon X Elite)" — describes a Japanese temple photo then transcribes JFK's "ask not what your country can do for you…".
- Jupyter walkthrough: `https://github.com/qualcomm/GenieX/blob/main/examples/python/windows.ipynb` ("covers environment setup and inference end-to-end"). [SOURCE] Notebook details: checks `platform.machine()` is ARM64; warns "Do **not** use conda or x86 Python (run `conda deactivate`)"; downloads Python 3.13.3 ARM64 installer; `python -m venv --clear geniex-env`; installs with `%pip install -i https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple "geniex[notebook]"`; Example 1 uses `AutoModelForCausalLM.from_pretrained("bartowski/Qwen_Qwen3.5-0.8B-GGUF", precision="Q4_0", device_map="llama_cpp")`; Example 2 uses `"ggml-org/SmolVLM-500M-Instruct-GGUF", precision="Q8_0", device_map="llama_cpp"` with `curl --ssl-no-revoke -Lo demo.jpg ...`; prints `streamer.output.profile` after streaming.
- Next-steps cards: API reference; Models (/en/models/supported): "Supported models, GGUF on Hugging Face, and self-converted Qualcomm AI Engine Direct bundles."

---

## 3. Page: API reference — https://geniex.aihub.qualcomm.com/en/run/python/api-reference

"The GenieX Python SDK follows the same design patterns as Hugging Face `transformers` — use `AutoModel*.from_pretrained()` to load a model, then call `.generate()` for inference."

### `AutoModelForCausalLM`
"Factory for loading causal language models — both text-only and multimodal. Returns a `GenieXLLM` for text-only models, or a `GenieXVLM` when a multimodal model is detected (e.g. `phi4_multimodal`, `qwen3.5-vl`, `gemma4`)."
```python
from geniex import AutoModelForCausalLM
model = AutoModelForCausalLM.from_pretrained("ai-hub-models/Qwen3-4B-Instruct", device_map="auto")
```
`from_pretrained()` params (docs table):
| Param | Type | Default | Description |
|---|---|---|---|
| `model_name_or_path` | `str` | required | "HuggingFace repo id, short alias (e.g. `"qwen3"`), or local path." |
| `device_map` | `str` | `"auto"` | "`"auto"` picks the first available runtime + compute unit. Also accepts `"<runtime>"` (runtime) or `"<runtime>:<compute_unit>"` (runtime + compute unit)." |
| `precision` | `str \| None` | `None` | "Precision (quantization) variant (e.g. `"Q4_K_M"`). Filters files when downloading from Hub." |
| `mmproj_path` | `str \| None` | `None` | "Path to the multimodal projector file. Auto-resolved from Hub; pass explicitly to force VLM mode." |
Additional (expandable): `model_name` (`str|None`, "Override the registry model name (e.g. `"granite4"` for Qualcomm AI Engine Direct)"), `hf_token` (`str|None`, "HuggingFace bearer token for gated models"), `max_tokens` (`int`, "Maximum tokens for generation") — **[SOURCE] `max_tokens` is NOT actually consumed by `from_pretrained` (unknown kwargs are silently ignored); use `generate(max_new_tokens=)`.**
Returns `GenieXLLM` or `GenieXVLM` (auto-detected).

**[SOURCE] Real signature:** `from_pretrained(model_name_or_path, *, model_name=None, precision=None, device_map='auto', n_ctx=0, n_gpu_layers=-1, mmproj_path=None, tokenizer_path=None, hf_token=None, progress=None, **kwargs)`. Extra kwargs routed into the C `geniex_ModelConfig`: ints `n_threads, n_threads_batch, n_batch, n_ubatch, n_seq_max, spec_n_max, spec_n_min`; float `spec_p_min`; strings `chat_template_path, chat_template_content, spec_type, spec_draft_model` → **speculative decoding is configurable from Python via `spec_type=`/`spec_draft_model=`/`spec_n_max`/`spec_n_min`/`spec_p_min` (undocumented on the page)**; if `spec_type` is set on a VLM-classified model it prints "Warning: spec_type set on a VLM-classified model; running the LLM path, image / audio inputs will be ignored". `progress`: `None` → tqdm bars (tqdm.auto → notebook widget in Jupyter), `False` → muted, or a callable `(files: list[FileProgress]) -> bool`. `n_ctx=0` = model default. On `qairt`: `n_gpu_layers` forced to 0 and `n_ctx` forced to 0 (warning if you passed non-defaults) — bundle has ctx/precision/KV baked in. `.gguf` path + qairt → `ValueError(".gguf models are not supported by device_map='...' (QAIRT/NPU). Use device_map='auto' or 'hybrid' instead.")`. Local path + `model_name=` registers the bundle in the cache via `hub='localfs'` (raises `ValueError` if `metadata.json` `model_id` mismatches). Cache lookup order: existing local path → local cache (`get_paths`) → `ensure_cached(hub='auto')` (downloads). If `precision` was given and the SDK returns `-100000` it's translated to `ValueError("Could not resolve quant ...")`. VLM detection: `mmproj_path` present (llama_cpp) OR QAIRT bundle `metadata.json` → `genie.supports_vision` OR cached manifest type `vlm`. `supports_thinking` detection: reads `tokenizer_config.json` `chat_template` for `enable_thinking` or `<think>`; if no such file (GGUF embeds template) → falls back to `True`.

### `AutoModelForVision2Seq`
"Factory for loading vision-language / multimodal models. Returns a `GenieXVLM` instance."
```python
from geniex import AutoModelForVision2Seq
model = AutoModelForVision2Seq.from_pretrained("ai-hub-models/Qwen2.5-7B-Instruct", device_map="qairt")
```
Same params as CausalLM plus `mmproj_path` ("Auto-resolved when downloading from Hub."). Returns `GenieXVLM`.

### `GenieXLLM`
`generate()` — "Run text generation from a formatted prompt string."
| Param | Type | Docs default | Description |
|---|---|---|---|
| `prompt` | `str` | required | "The formatted prompt string (use `model.tokenizer.apply_chat_template()` to build it)." |
| `max_new_tokens` | `int` | `512` | |
| `temperature` | `float` | `0.7` | |
| `top_p` | `float` | `0.9` | |
| `top_k` | `int` | `40` | |
| `min_p` | `float` | `0.0` | |
| `stream` | `bool` | `False` | "If `True`, returns a `TextIteratorStreamer` instead." |
| `repetition_penalty` | `float` | `1.1` | |
| `presence_penalty` | `float` | `0.0` | |
| `frequency_penalty` | `float` | `0.0` | |
| `seed` | `int` | `-1` | "Random seed (`-1` = random)." |
| `stop` | `list[str] \| None` | `None` | "Stop sequences." |
| `grammar` | `str \| None` | `None` | "GBNF grammar string for constrained generation." |
Returns `GenerateOutput` (or `TextIteratorStreamer` when `stream=True`).
**[SOURCE] discrepancy:** in code the sampler defaults are all `0` / `0.0` (`temperature=0.0, top_p=0.0, top_k=0, min_p=0.0, repetition_penalty=0.0, presence_penalty=0.0, frequency_penalty=0.0, seed=0`) with comment "0 = defer to bundle/plugin default. Pass non-zero to override." The docs' 0.7/0.9/40/1.1/-1 are presumably the plugin defaults. Extra source-only kwargs on `GenieXLLM.generate`: `sliding_window: bool = False`, `sliding_window_n_keep: int = 0` ("Opt-in ring-buffer context eviction (qairt only)"; `0` = plugin default 4). Grammar goes to C `grammar_string`; there is also a C `grammar_path` field but the Python API only exposes the string. Streaming: `generate(stream=True)` runs the C call on a daemon thread and yields via a queue; ctypes releases the GIL during the C call.
- `reset()` — "Resets conversation state and clears the KV cache." (source: "Clear KV cache and reset sampler state.")
- `save_kv_cache(path)` / `load_kv_cache(path)` — "Save or load the key-value cache to/from a file path (`str`)." (LLM only, not on VLM.)
- `close()` — "Releases the model handle and frees resources. Also supports context-manager usage":
  ```python
  with AutoModelForCausalLM.from_pretrained("qwen3") as model:
      output = model.generate(prompt)
  ```
- **[SOURCE] extra:** `forward_logits(input_ids: list[int], *, all_positions=False, top_n=0)` → raw logits (one row for last token, or one per token); `top_n>0` returns `(token_id, logit)` pairs; "Intended for on-target accuracy metrics (perplexity, MMLU, MMMU)". Property `supports_thinking: bool`. `__repr__` shows model/backend/device/quant.

### `GenieXVLM`
`generate()` — same params plus `images: list[str] | None` ("List of image file paths for the model to process."), `audios: list[str] | None` ("List of audio file paths"). Example: `model.generate(prompt, images=["/path/to/image.jpg"], max_new_tokens=256)`. `reset()`/`close()` same as LLM. **[SOURCE]:** raises `ValueError('messages reference image content but generate(images=[...]) is empty...')` (same for audio) if the last apply_chat_template had image/audio parts but you didn't pass them; raises `FileNotFoundError` for missing files; `capabilities()` → `{'vision': bool, 'audio': bool}` ("Plugins without modality probes (e.g. QAIRT) return both as `False`"). Only the **last user message's** media is checked ("prior-turn media is already in the KV cache and must not be re-supplied"). No `sliding_window`, no `save/load_kv_cache`, no `forward_logits` on VLM. VLM `apply_chat_template` accepts either string content or list of parts; parts map to C `geniex_VlmContent(type, text)` where `text = item.get('text') or item.get('image') or item.get('audio')`. C VLM template input also has a `grounding` bool that Python does not expose.

### `ModelTokenizer` (`model.tokenizer`)
"Provides a `transformers`-compatible chat template interface." `apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=None, tools=None) -> str`.
| Param | Type | Default | Description |
|---|---|---|---|
| `messages` | `list[dict]` | required | dicts with `"role"` and `"content"` |
| `tokenize` | `bool` | `False` | "Must be `False` — standalone tokenization is not supported." (source raises `ValueError('tokenize=True is not supported by geniex — the C runtime decodes tokens internally...')`) |
| `add_generation_prompt` | `bool` | `True` | |
| `enable_thinking` | `bool \| None` | `None` | "`None` (default) and `True` both let a thinking-capable model think (and are no-ops on non-thinking models). `False` asks a thinking-capable model to skip its thinking turn — forced to `True` with a warning on non-thinking models, where the suppression block is OOD. Capability is auto-detected and exposed as `model.supports_thinking`." |
| `tools` | `list[dict] \| str \| None` | `None` | "Tool definitions as a list of dicts or pre-serialised JSON string." (source: list is `json.dumps`'d and passed to the C template as the `tools` string) |
**Tool/function calling in the Python SDK = template-level only**: tools are injected into the chat template; the SDK returns raw text — **[INFERENCE] there is no tool-call parser / `tool_calls` structure in the Python SDK; the app must parse the model's native tool-call syntax (e.g. `<tool_call>{...}</tool_call>` for Qwen) itself, or use `geniex serve`'s OpenAI API instead.** No `role: "tool"` handling is documented for Python.

### Output classes
- `GenerateOutput`: `text: str` ("The generated text (thinking tags stripped if present)."), `thinking: str | None` ("The model's reasoning content, or `None`."), `profile: ProfileData`. [SOURCE] thinking is extracted with regex `<think>(.*?)</think>` from the full text; **streamed chunks are raw and DO include `<think>` tags** — only the final `streamer.output` is split.
- `ProfileData`: `ttft: int` ("Time to first token (ms)"), `prompt_tokens: int`, `generated_tokens: int`, `prefill_speed: float` (tok/s), `decode_speed: float` (tok/s), `stop_reason: str|None` ("Why generation stopped (e.g. `"eos"`, `"limit"`)"), timing fields `prompt_time: int` ("Prompt processing time (ms)"), `decode_time: int` ("Decode time (ms)"). **[SOURCE] units discrepancy: the code formats these as microseconds (`_format_us`, CLI prints `p.ttft / 1e6` seconds) → treat ttft/prompt_time/decode_time as µs, not ms.** [SOURCE] extra fields: `draft_n_total`, `draft_n_accepted` (speculative decoding stats), `backend`, `device`, `quant`, `model_path`. [SOURCE] stop_reason values seen: C plugin returns `'length'` for both max_tokens and context-length; Python promotes context overflow (C error `-200004 GENIEX_ERROR_LLM_TOKENIZATION_CONTEXT_LENGTH`) to `stop_reason='context_length'` and returns normally instead of raising; `'cancelled'` after `streamer.cancel()`.
- `TextIteratorStreamer`: "Yields decoded text chunks as they are generated." `__iter__()` yields `str`; `output` → `GenerateOutput | None` "available after iteration finishes"; `cancel()` "Stop generation at the next token boundary."
  ```python
  streamer = model.generate(prompt, max_new_tokens=256, stream=True)
  for chunk in streamer:
      print(chunk, end="", flush=True)
  final = streamer.output  # GenerateOutput available after iteration
  ```
  [SOURCE] exceptions raised in the generation thread are re-raised from the iterator after the sentinel; after `cancel()` you should keep draining the iterator so `.output` gets populated.

### Model manager — `geniex.model_manager` ("The same model manager the CLI uses")
```python
from geniex import model_manager as mm

MODEL = "Qwen/Qwen3-0.6B-GGUF"
mm.pull(MODEL)
print(f"pull complete: {MODEL}")
paths = mm.get_paths(MODEL)
print(f"model path:    {paths}")
local_models = mm.list_models()
print(f"local models:  {local_models}")
mm.remove(MODEL)
print(f"model removed: {MODEL}")
```
| Function | Docs description |
|---|---|
| `pull(model_name, ...)` | "Download a model by alias or `org/repo[:precision]`." |
| `list_models()` | "Returns `list[str]` of cached model names." |
| `get_paths(model_name)` | "Returns `ModelPaths` with resolved local file paths." |
| `get_type(model_name)` | "Returns `"llm"` or `"vlm"`." |
| `resolve_alias(alias)` | "Resolves a short alias to canonical `org/repo`." |
| `remove(model_name)` | "Delete a cached model from disk." |
| `clean()` | "Remove all cached models. Returns count removed." |
`pull()` params (docs): `model_name` (required, "`org/repo` or a short alias"), `precision` (`str|None`, e.g. `"Q4_K_M"`), `hub` (`str`, `"auto"`; docs list `"auto" | "hf" | "localfs"`), `local_path` ("required when `hub="localfs"`"), `hf_token`, `on_progress` ("Callback `(files: list[FileProgress]) -> bool`; return `False` to cancel").
`ModelPaths` attrs (docs): `model_path`, `model_dir`, `model_name`, `runtime`, `mmproj_path` (VLM only), `tokenizer_path`, `compute_unit` (**[SOURCE] `compute_unit` does not exist in the dataclass; real fields: `model_path, model_dir, model_name, runtime, model_type ('llm'|'vlm'), mmproj_path, tokenizer_path`**).
**[SOURCE] full model_manager surface:** `init(data_dir=None)` ("precedence: argument → `GENIEX_DATADIR` env → `~/.cache/geniex`"), `deinit()`, `pull(model_name, *, precision, hub, local_path, hf_token, chipset, display_name, model_type, on_progress)` where `hub` accepts `'auto'|'hf'|'huggingface'|'aihub'|'docker'|'dockerhub'|'localfs'|'local'` or raw int (enum: AUTO=0, HUGGINGFACE=1, MODELSCOPE=2, AIHUB=3, VOLCES=4, DOCKER=5, LOCALFS=127); `hf_token` falls back to `GENIEX_HFTOKEN`; `chipset` = "AI Hub target chipset; auto-detected on Windows-on-Snapdragon"; `display_name` = AI Hub display_name, optional when name starts with `qualcomm/`, `qai-hub-models/`, or `aihub/`; `model_type` `'llm'|'vlm'|None(auto)`; pull is "blocking, resumable". `list_detailed() -> list[ModelDetail(name, model_name, runtime, model_type, total_size, precisions)]`; `query(model_name, *, hub, local_path, hf_token, chipset, display_name) -> ModelQuery(model_name, runtime, model_type, candidates: list[PrecisionCandidate(precision, size)])` — "Resolve a model's remote candidate precisions without downloading", candidates sorted by SDK priority (index 0 = recommended); `ensure_cached(name, *, precision, hub, local_path, hf_token, on_progress) -> ModelPaths` (resolve alias, query to pick head precision if none given so only one quant downloads, pull if missing); `set_type(model_name, 'llm'|'vlm')`; `resolve_effective_hub(model_name, hub='auto') -> int` ("`auto` resolves to Docker Hub when the name carries a Docker Hub prefix (`docker.io/…`)"); `last_error_message()` (thread-local detailed error for last failing model-manager call); `list_chipsets() -> list[ChipsetInfo(name, aliases)]` (from `platform.json`, cached 24h); `detect_chipset(offline=False) -> str|None`; `list_hub_models(chipset=None) -> list[HubModel(name, model_type, chipsets)]` ("List Qualcomm AI Hub models with a qairt (NPU) build", from `manifest.json`, cached 24h). Alias handling: `org/repo:precision` splits on last `:`; bare names go through `resolve_alias`; unknown bare names "pass through — the SDK canonicalises them to aihub/<name>". Cache manifest per model is `<model_dir>/geniex.json` with keys `ModelFile` (dict keyed by precision; QAIRT uses key `"N/A"` with top-level `Precision`), `MMProjFile`, `TokenizerFile`, `ExtraFiles`, `PluginId`, `ModelType`, each file entry has `Name`, `Size`, `Downloaded`.

### SDK functions (docs table)
| Function | Description |
|---|---|
| `geniex.init()` | "Initialize the SDK. Called automatically on first model load." |
| `geniex.deinit()` | "Shut down the SDK and release resources." |
| `geniex.version()` | "Returns the SDK version string." |
| `geniex.get_runtime_list()` | "Returns `list[str]` of available runtime IDs." |
| `geniex.get_compute_unit_list(runtime)` | "Returns `list[tuple[str, str]]` of `(compute_unit, compute_unit_name)` pairs for the given runtime." |
[SOURCE] also exported: `GenieXError` (`.code` int; message `GenieXError(<code>): <msg>`), `set_log_level('trace'|'debug'|'info'|'warn'|'error'|'none')`, `get_plugin_version(plugin_id)` (e.g. `'qairt'`), `resolve_device_map(device_map, model_name=None) -> (runtime, compute_unit, ngl_override)`, classes `GenieXLLM, GenieXVLM, GenerateOutput, ProfileData, TextIteratorStreamer`, `__version__`. `get_runtime_list()`/`get_compute_unit_list()` raise `RuntimeError` if `init()` hasn't been called (issue #715). `init()` registers `atexit(deinit)`. Older README names `get_plugin_list`/`get_device_list` (`geniex._ffi.get_device_list(plugin)`) = same thing.

### device_map / compute-unit semantics [README table + SOURCE + Platforms page]
| Alias | `llama_cpp` resolves to | `qairt` resolves to | Notes |
|---|---|---|---|
| `cpu` | empty `device_id`, `ngl=0` | `NPU` + warning | "Pure CPU for `llama_cpp`. QAIRT is NPU-only; other aliases are coerced with a stderr warning (no hard error)." |
| `gpu` | `GPUOpenCL` | `NPU` + warning | "Adreno via `ggml-opencl`." |
| `npu` | `HTP0` | `NPU` | "Pinned single-session HTP. Deterministic; slower than `hybrid` on LLMs (~30% TTFT)." |
| `hybrid` | empty `device_id`, `ngl=-1` | `NPU` + warning | "llama.cpp's per-tensor HTP+CPU scheduler — the fast path on Snapdragon." |
- "`device_map="auto"` (the default) picks `npu` for both `llama_cpp` and `qairt`." Source: `auto` = first entry of `get_runtime_list()` + SDK default device.
- Alias owners: `cpu/gpu/hybrid → llama_cpp`, `npu → qairt` — BUT "When the model was pulled via `geniex.model_manager` the manifest already records its plugin, so a bare alias binds to that plugin — `device_map="npu"` on a cached llama_cpp model resolves to `llama_cpp:HTP0`, not qairt." Full control: `device_map="<plugin>:<device_id>"` e.g. `"llama_cpp:HTP0,HTP1,HTP2,HTP3"` (multi-HTP session ids). `qairt:<anything but NPU>` → warning "qairt runtime only supports NPU inference; ignoring device_map=... and running on NPU". Enumerate with `geniex-py devices` or `geniex.get_compute_unit_list(runtime)`.
- Platforms page: default compute unit `llama_cpp` → `npu` (pinned `HTP0`), `qairt` → `npu`; "For llama.cpp's HTP + CPU per-tensor scheduling (the faster path on Snapdragon), pass `hybrid` explicitly." QAIRT: "The bundle has its **precision, context length, and KV cache size baked in** — none can be changed at runtime."

### Env vars (README) [SOURCE]
| Var | Purpose |
|---|---|
| `GENIEX_DATADIR` | "Model cache directory (default: `~/.cache/geniex`)." |
| `GENIEX_HFTOKEN` | "HuggingFace token for gated repos." |
| `GENIEX_LIB_PATH` | "Point at a pre-built `libgeniex.so` / `geniex.dll`." |
| `GENIEX_LOG` | "Log level: `trace`/`debug`/`info`/`warn`/`error`/`none`. Default `info`." (`off`/`0`/`false` → `none`) |
Also `GENIEX_PLUGIN_PATH` (set automatically by loader if unset), `NO_COLOR` (geniex-py). Logging: "SDK and binding logs flow through Python's stdlib `logging` under the `geniex` logger. Set `GENIEX_LOG` before `geniex.init()` or call `geniex.set_log_level("debug")` at runtime."

### `geniex-py` console CLI [SOURCE README + cli.py]
```
geniex-py chat qwen3                       # interactive chat (auto-downloads)
geniex-py chat unsloth/Qwen3-4B-GGUF --quant Q4_K_M
geniex-py chat /path/to/model.gguf --system "You are a concise assistant."
geniex-py pull qwen3 ; geniex-py ls ; geniex-py ls qwen3 (prints geniex.json) ; geniex-py rm qwen3 ; geniex-py rm --all ; geniex-py devices ; geniex-py version
```
Global: `-v/-vv/-vvv`, `--log-level {trace,debug,info,warn,error,none}`. `chat` flags: `--quant`, `--system`, `-p/--prompt` (single turn), `--max-tokens` (512), `--temperature` (0.7), `--n-ctx` (0=model default), `--device` (`auto|cpu|gpu|npu|hybrid|<plugin>|<plugin>:<device>`), `--hub {auto,hf,huggingface,aihub,docker,dockerhub,localfs,local}` ("default: auto = HuggingFace"), `--display-name` (required with `--hub aihub`), `--chipset` (e.g. `qualcomm-snapdragon-x-elite`; auto-detect on Windows-on-Snapdragon), `--local-path` (required with `--hub localfs`). In chat: `/reset`, `/exit`/`/quit`, Ctrl-D quits, Ctrl-C interrupts reply (calls `streamer.cancel()`). VLM chat auto-detects media paths in the prompt via regex for `.jpg|.jpeg|.png|.webp|.mp3|.wav`. Ctrl-C during pull: "(aborted — partial download preserved; rerun to resume)".

### C API inventory exposed through ctypes [SOURCE `_ffi/_api.py`] (hints at what the native SDK supports)
`geniex_init/deinit/free/version/get_plugin_version/get_plugin_list/get_device_list/resolve_device/set_log/get_error_message`; LLM: `geniex_llm_create/destroy/reset/generate/get_model_info/forward_logits/apply_chat_template/save_kv_cache/load_kv_cache`; VLM: `geniex_vlm_create/destroy/reset/generate/apply_chat_template/get_capabilities`; model manager: `geniex_model_init/deinit/pull/last_error_message/remove/clean/get_paths/paths_free/get_type/set_type/list_detailed/query/resolve_alias/resolve_hub/list_chipsets/detect_chipset/list_hub/…_free`. `geniex_LlmGenerateInput` also has `input_ids`/`input_ids_count` (token-id prompt) not exposed in Python. `geniex_ModelConfig` fields: `n_ctx, n_threads, n_threads_batch, n_batch, n_ubatch, n_seq_max, n_gpu_layers, chat_template_path, chat_template_content, spec_type, spec_draft_model, spec_n_max, spec_n_min, spec_p_min`. `geniex_GenerationConfig`: `max_tokens, stop[], sampler_config, image_paths[], audio_paths[], sliding_window, sliding_window_n_keep`. `geniex_SamplerConfig`: `temperature, top_p, top_k, min_p, repetition_penalty, presence_penalty, frequency_penalty, seed, grammar_path, grammar_string`. Error codes referenced: `-100302` PLUGIN_INVALID, `-200004` TOKENIZATION_CONTEXT_LENGTH, `-100000` UNKNOWN, `-201201` Multimodal generation failed.

---

## 4. Page: Linux (Docker) Install — https://geniex.aihub.qualcomm.com/en/run/linux/install

- Tagline: "Run GenieX via Docker on Linux ARM64 with NPU access." "The Linux Docker path runs through a container image built for Linux ARM64 with NPU access (Dragonwing QCS9075 and similar IoT platforms)."
- Note: "This is the containerized path. If you'd rather install `geniex` directly on the host without Docker, see CLI Install → Linux ARM64 (Native) (/en/run/cli/install)."
- **Prerequisites:** "Linux ARM64 host with Docker installed" (Docker's Ubuntu install guide); "Dragonwing IoT chipset — see Supported platforms"; "Credentials with read access to one of the registries below."
- **Install host dependencies:** "The container reaches the NPU through the host's Qualcomm driver libraries, mounted in via `-v /usr/lib:/opt/qcom-lib:ro`. Install them **on the host** before `docker run` — follow CLI Install → Install host dependencies (/en/run/cli/install#install-host-dependencies)."
- **Pull the image** ("published to two registries"):
  ```bash
  # Option A — Docker Hub (public, no login required):
  IMAGE=docker.io/qualcomm/geniex:latest

  # Option B — Qualcomm Container Registry:
  docker login docker-registry.qualcomm.com -u '$app' -p GB2S6KXMJXTPV8VHNFNS7Q6LVH75LOOBTLT8D723WUX6PSFZMTX95GIQG4EFWH5C021ONZ5763VI9IDHU96Q7VAZJ2830CLX3NPI6STQOJWRYXLLA2ZYTL1S
  IMAGE=docker-registry.qualcomm.com/qcom-ai-hub/geniex-cli:latest

  docker pull "$IMAGE"
  ```
  (the Option-B token is a public read credential printed verbatim in the docs)
  Note: "If `docker login` fails or `docker pull` returns `permission denied ... /var/run/docker.sock`, see Troubleshooting → Linux (/en/resources/troubleshooting#linux) for the credential and `docker` group fixes."
- **Run interactively:**
  ```bash
  docker run -it --rm --privileged \
    -v "$PWD/data:/data" \
    -v /usr/lib:/opt/qcom-lib:ro \
    "$IMAGE"
  ```
- **Verify:** `geniex --help` from the container shell. Note: "The `--privileged` flag is required for NPU access." "For server mode, see Local server (/en/run/cli/local-server)."
- **CLI:** "For the full CLI Docker install guide, see CLI Install — Linux ARM64 (Docker)."
- **Python:** "For the full Python install guide on native Linux ARM64, see Python Install — Linux ARM64. The Python SDK can be installed inside the Docker container or directly on the Linux ARM64 host."
- Cross-ref (Audio tutorial): "**Running in Docker?** Local paths are resolved **inside the container**. The install command mounts `$PWD/data` to `/data` — drop your files there and pass `/data/jfk.wav`, or use an HTTP URL / base64 data URL to skip the filesystem entirely." FAQ: Docker image is for "Reproducible IoT deployment … on Linux ARM64 EVKs, pinned to a release tag."
- **[INFERENCE] Not applicable to the user's Windows 11 / X Elite laptop**: NPU passthrough relies on a Linux host's `/usr/lib` Qualcomm driver libs + `--privileged`; Docker Desktop on Windows ARM64 (WSL2/Hyper-V Linux VM) would have no Hexagon access. Use the native Windows CLI/Python SDK there.

---

## 5. Cross-linked facts pulled in (Audio tutorial / FAQ / Platforms)
- Audio (tutorial): "Audio is the **`llama_cpp`** path only. QAIRT bundles report `audio: false` and a QAIRT model given audio fails with `GenieXError(-201201): Multimodal generation failed`. Audio runs on `--compute npu` / `gpu` / `cpu`; the NPU is the default and fast path on Snapdragon." Model `google/gemma-4-E2B-it-qat-q4_0-gguf` (Q4_0 ≈3.1 GiB + conformer mmproj ≈0.9 GiB ≈ 4.0 GiB). Formats: CLI auto-detect `.wav`/`.mp3` only; server `input_audio.data` decoded by content; decoder recognizes WAV/MP3/FLAC by magic bytes; always down-mixed to mono and resampled (typically 16 kHz); no max duration (chunked). Failure modes: audio → QAIRT model = `-201201`; audio → vision-only VLM = silently skipped with warning `model does not support audio input; skipping N audio file(s)`; unreadable file dropped (may cause `-201201` later). Python-SDK audio input format = `{"type": "audio", "audio": "<abs path>"}` part + `generate(audios=[...])`.
- FAQ Python: "GenieX requires **ARM64** Python. x86_64 / AMD64 builds are not supported, even under emulation." Linux: Miniconda aarch64 recipe (`CONDA_OVERRIDE_GLIBC=2.39 bash Miniconda3-latest-Linux-aarch64.sh -b -p $HOME/miniconda`, `conda tos accept ...`, `conda create -n geniex python=3.13 -y`) or `apt install python3 python3-pip python3-venv` (Ubuntu ARM64 only; Yocto has no apt). "Is Miniconda supported on Windows ARM64? No. There is currently no native Windows ARM64 Miniconda installer. On Windows ARM64, download the official Python 3.13.3 ARM64 installer … Do not install the x86 / AMD64 build: GenieX wheels only target ARM64." FAQ Server: "Is the local server OpenAI-compatible? Yes … point the official `openai` Python client at `http://127.0.0.1:18181/v1`." "Does geniex serve auto-download models? No. Pull models with `geniex pull` before starting the server." FAQ "Building an app — Local server (OpenAI-compatible HTTP) or Python SDK."
- Platforms: "GenieX runs exclusively on Qualcomm Snapdragon — no x86 or non-Snapdragon ARM build." X Elite = `X1E*` → AI Hub chipset id `qualcomm-snapdragon-x-elite`; X2 Elite → `qualcomm-snapdragon-x2-elite`; "all X Elite SKUs map to the same AI Hub asset — including the X Plus and X2 Plus parts." Runtimes: `llama_cpp` = "any GGUF model on Hugging Face, running on Hexagon NPU, Adreno GPU, or CPU through Qualcomm's GGML Hexagon backend"; `qairt` = "pre-compiled bundles from Qualcomm AI Hub, compiled and quantized per chipset and pinned to the Hexagon NPU. The fastest path when your model is on Qualcomm AI Hub." Official name is "Qualcomm AI Engine Direct" (historically QAIRT).

---

## 6. Explicitly NOT supported / limitations (from this section)
- x86_64/AMD64 Python — not supported (even under emulation). Non-Snapdragon hosts — pip install aborts.
- `apply_chat_template(tokenize=True)` — not supported ("standalone tokenization is not supported").
- Audio on `qairt` — not supported (`-201201`); `capabilities()` returns both False on QAIRT ("Plugins without modality probes").
- `.gguf` files on `qairt` — rejected (`ValueError`); qairt is NPU-only (cpu/gpu/hybrid aliases coerced to NPU with warning); `n_ctx`/`n_gpu_layers` ignored/forced 0 on qairt; QAIRT bundle precision/context/KV are baked in.
- Python SDK model types are only `llm` / `vlm` (enum LLM=0, VLM=1). **No image/video/audio *generation*, no embeddings, no ASR-only model API in the Python SDK** — the only "audio" capability is audio *input* to a VLM.
- Python SDK has **no HTTP server / OpenAI endpoints** of its own — this section documents zero HTTP endpoints; the OpenAI-compatible server is `geniex serve` (CLI section, port 18181).
- VLM inputs are **file paths only** in the Python SDK (no URL / base64 as in the server's `image_url`/`input_audio`).
- `save_kv_cache/load_kv_cache`, `forward_logits`, `sliding_window` — LLM handle only, not VLM.
- Docs mention `enable_thinking` but the SDK yields raw `<think>` text while streaming; splitting only happens in the final `GenerateOutput`.
- Docker path: Linux ARM64 + Dragonwing IoT only; `--privileged` + host `/usr/lib` mount required for NPU.
- Do not co-install `llama-cpp-python`. Do not use conda / x86 Python on Windows ARM64.
- Docs mismatches to be aware of: `ProfileData` times documented as ms but code treats as µs; `generate()` sampler defaults documented as 0.7/0.9/40/1.1/-1 but code passes 0 (= plugin default); `from_pretrained(max_tokens=)` documented but ignored; `ModelPaths.compute_unit` documented but absent (real field `model_type`); `pull(hub=)` documented as `auto|hf|localfs` but code also accepts `aihub|docker|dockerhub|local|huggingface`.

## 7. Implications for the UI / agent app on Windows ARM64 (X Elite) [INFERENCE unless quoted]
- Two integration options from this section: (a) in-process **Python SDK** (ctypes → `geniex.dll` + `lib/llama_cpp` (ggml-hexagon) + `lib/qairt`) giving streaming, cancel, grammar (GBNF string), stop sequences, thinking split, KV-cache save/load, speculative decoding kwargs, sliding window (qairt), raw logits, model manager with progress callbacks + cancel, hub browsing (`list_hub_models`, `query` for precision candidates, `detect_chipset`); (b) `geniex serve` OpenAI HTTP (covered in the CLI section). A Python sidecar (e.g. FastAPI/uvicorn wrapping the SDK) is feasible: model load is blocking; `generate(stream=True)` runs on a background thread and ctypes releases the GIL, so an asyncio loop can bridge the queue-based `TextIteratorStreamer` to SSE/WebSocket.
- Concurrency: nothing in the docs claims thread-safety; each `GenieXLLM`/`GenieXVLM` handle carries its own conversation/KV state (`reset()` clears). Plan on **one in-flight `generate` per handle**, and one handle per concurrent session (or serialize with a lock). `n_seq_max` exists in the C config but no Python API uses multiple sequences.
- Multi-turn: the SDK re-templates the full `messages` history each turn (as `geniex-py chat` does) — the plugin manages prefix reuse internally; media from prior turns must NOT be re-supplied.
- Tool calling for agents: pass `tools=[...]` to `apply_chat_template`; parse the model's tool-call text yourself; can constrain output with `grammar=` (GBNF) for reliable JSON.
- Model naming: HF `org/repo[:PRECISION]` (e.g. `unsloth/Qwen3-4B-GGUF:Q4_K_M`), short aliases (`qwen3`, `granite4`), AI Hub ids like `ai-hub-models/Qwen3-4B`, `qualcomm/Qwen3-4B`, `qai-hub-models/...`, `aihub/...`, Docker `docker.io/...` refs, local `.gguf` or bundle dir. Cache dir `~/.cache/geniex` (override `GENIEX_DATADIR`), manifest `geniex.json` per model dir.
- Python 3.14: docs target 3.10+/3.13.3; sdist is pure Python + ctypes so 3.14 ARM64 is likely fine but unverified; installing needs internet (SDK zip ~84 MB via Range/full download from S3/GitHub) and setuptools>=77 in an isolated build env.

## KEY FACTS
- Reliable raw-text fetch of any GenieX docs page = append `.md` to the URL (Mintlify); index at https://geniex.aihub.qualcomm.com/llms.txt — WebFetch only returns lossy summaries.
- Python SDK: `pip install -U geniex` (also `geniex-llama-cpp` ~15MB / `geniex-qairt` ~210MB, mutually exclusive); requires ARM64 Python 3.10+ on Snapdragon X Elite/X2 Elite (or Linux ARM64); x86_64/AMD64 Python not supported even under emulation; do not co-install llama-cpp-python; do not use conda/x86 Python on Windows ARM64.
- PyPI geniex 0.4.0 is a 58KB pure-Python sdist; pip install downloads native SDK zip `geniex-sdk-windows-arm64-v0.4.0.zip` (~84MB, S3 then GitHub, HTTP-Range partial fetch + sha256) into site-packages/geniex/lib (geniex.dll + lib/llama_cpp + lib/qairt); everything is ctypes (no compiled extension) so Python 3.14 ARM64 is plausibly OK (untested by docs).
- API is transformers-style: `AutoModelForCausalLM.from_pretrained(name, device_map='auto'|'cpu'|'gpu'|'npu'|'hybrid'|'<runtime>'|'<runtime>:<cu>', precision=, mmproj_path=, hf_token=, model_name=, n_ctx=, n_gpu_layers=, progress=, spec_type=, spec_draft_model=, spec_n_max/min=, spec_p_min=, n_threads=, ...)`; returns GenieXLLM or GenieXVLM (auto-detect); `AutoModelForVision2Seq` forces VLM.
- device_map semantics: auto→npu for both runtimes; llama_cpp: cpu(ngl=0) / gpu(GPUOpenCL Adreno) / npu(HTP0 pinned, deterministic, ~30% slower TTFT than hybrid) / hybrid(HTP+CPU per-tensor scheduler, 'the fast path on Snapdragon'); qairt is NPU-only and coerces other aliases with a warning; `.gguf` on qairt raises ValueError; qairt ignores n_ctx/n_gpu_layers (bundle bakes precision/context/KV); explicit form `llama_cpp:HTP0,HTP1,HTP2,HTP3`.
- `model.tokenizer.apply_chat_template(messages, tokenize=False (True not supported), add_generation_prompt=True, enable_thinking=None|True|False, tools=list[dict]|json str)` -> prompt str; `model.supports_thinking` auto-detected from chat template; tools are template-level only — no tool-call parsing in the Python SDK.
- `generate(prompt, max_new_tokens=512, temperature, top_p, top_k, min_p, repetition_penalty, presence_penalty, frequency_penalty, seed, stop=[...], grammar=<GBNF string>, stream=False, [LLM only: sliding_window=, sliding_window_n_keep= (qairt)], [VLM: images=[paths], audios=[paths]])` -> GenerateOutput(text, thinking, profile) or TextIteratorStreamer (yields str chunks incl. raw <think> tags, `.output` after iteration, `.cancel()`); code sampler defaults are 0 (=plugin default) even though docs list 0.7/0.9/40/1.1/-1.
- ProfileData: ttft, prompt_time, decode_time (docs say ms; code treats as microseconds), prompt_tokens, generated_tokens, prefill_speed, decode_speed (tok/s), stop_reason ('eos','limit'/'length','context_length' synthesized on ctx overflow instead of raising,'cancelled'), draft_n_total/draft_n_accepted, backend, device, quant, model_path.
- VLM input format in Python SDK: content parts `{'type':'image','image':'<abs path>'}` / `{'type':'audio','audio':'<abs path>'}` / `{'type':'text','text':...}` AND the same paths passed to generate(images=[...], audios=[...]); file paths only (no URL/base64); only last user turn's media is supplied; `model.capabilities()` -> {'vision','audio'}; audio only on llama_cpp (QAIRT -> GenieXError(-201201)); vision-only VLM silently skips audio.
- Extra LLM-only methods: reset() (clear KV/conversation), save_kv_cache(path)/load_kv_cache(path), forward_logits(input_ids, all_positions, top_n) for eval; close() / context manager; geniex.init()/deinit()/version()/get_runtime_list()/get_compute_unit_list(runtime)/get_plugin_version()/set_log_level(); GenieXError has .code.
- geniex.model_manager: pull(name, precision, hub='auto'|'hf'|'aihub'|'docker'|'localfs'(+aliases), local_path, hf_token (fallback GENIEX_HFTOKEN), chipset, display_name, model_type, on_progress(files)->bool cancelable), list_models(), list_detailed(), get_paths()->ModelPaths(model_path, model_dir, model_name, runtime, model_type, mmproj_path, tokenizer_path), get_type()/set_type(), resolve_alias(), remove(), clean(), query() (precision candidates w/o download), ensure_cached(), list_hub_models(chipset), list_chipsets(), detect_chipset(), resolve_effective_hub(), last_error_message(); cache dir GENIEX_DATADIR (default ~/.cache/geniex), manifest geniex.json.
- Env vars: GENIEX_DATADIR, GENIEX_HFTOKEN, GENIEX_LIB_PATH, GENIEX_LOG (trace|debug|info|warn|error|none), GENIEX_PLUGIN_PATH (auto), build-time GENIEX_SDK_DOWNLOAD_URL / GENIEX_SKIP_SDK_DOWNLOAD; logs go to Python logger 'geniex'.
- `geniex-py` console script: chat (--quant --system -p --max-tokens --temperature --n-ctx --device --hub --display-name --chipset --local-path; /reset /exit; auto-detects .jpg/.jpeg/.png/.webp/.mp3/.wav paths in prompt), pull, ls [model], rm [--all], devices, version; -v/-vv/-vvv, --log-level.
- This section defines NO HTTP endpoints: the Python SDK is in-process only; OpenAI-compatible HTTP is `geniex serve` (127.0.0.1:18181/v1, no auto-download of models) documented in the CLI section.
- Linux (Docker) page targets Dragonwing QCS9075 IoT boards: image docker.io/qualcomm/geniex:latest (or docker-registry.qualcomm.com/qcom-ai-hub/geniex-cli:latest with the public login printed in the docs); `docker run -it --rm --privileged -v "$PWD/data:/data" -v /usr/lib:/opt/qcom-lib:ro $IMAGE`; --privileged required for NPU; host Qualcomm driver libs must be installed; container paths (/data) for media; irrelevant/no NPU for a Windows X Elite laptop.
- Model types are only llm|vlm; nothing in the Python SDK or this section supports image/video generation, embeddings, or standalone ASR — audio is input-only via VLM mmproj with conformer encoder (e.g. google/gemma-4-E2B-it-qat-q4_0-gguf on llama_cpp).

## OPEN QUESTIONS
- Does `pip install geniex` actually succeed on Python 3.14 ARM64 (docs pin 3.13.3; PyPI requires_python is empty; sdist is pure Python + ctypes so it likely works, but untested).
- Thread-safety / concurrency of a single GenieXLLM handle and of multiple handles sharing the NPU is undocumented; docs give no guidance on concurrent generate() calls or per-session handles (n_seq_max exists in the C config but is unused by the Python API).
- Exact stop_reason vocabulary: docs say e.g. 'eos'/'limit'; source references 'length', 'context_length' (synthesized), 'cancelled' — needs runtime confirmation.
- ProfileData timing units: docs say ms, code formats as microseconds — verify against a real run.
- Whether the Python SDK exposes any tool-call parsing / structured tool_calls (appears NOT — only template injection via `tools=`); how `geniex serve` handles tool calls is in the CLI/local-server section, not here.
- Whether `from_pretrained` kwargs `spec_type`/`spec_draft_model` (speculative decoding) and `sliding_window` are officially supported on Windows X Elite via Python (present in source; undocumented on the API page).
- The docs' `ModelPaths.compute_unit` and `from_pretrained(max_tokens=)` don't exist in source — docs may lag or lead the 0.4.0 release; confirm against the installed version (`geniex.__version__`, `geniex.version()`).
- Which precisions/quants of GGUF models actually run on the Hexagon NPU (llama_cpp npu/hybrid) is covered on the Models page (/en/models/supported), not in this section.
