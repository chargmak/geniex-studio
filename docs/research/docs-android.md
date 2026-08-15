# GenieX docs — "Android SDK" section: exhaustive notes

Source pages (all fetched in full as raw markdown via the `.md` suffix, which the Mintlify site serves; the WebFetch summarizer truncated the Install page, so the raw text was pulled with `Invoke-WebRequest`):

- Android Install — https://geniex.aihub.qualcomm.com/en/run/android/install (raw: `.../install.md`)
- Android Quickstart — https://geniex.aihub.qualcomm.com/en/run/android/quickstart (raw: `.../quickstart.md`)
- Android API reference — https://geniex.aihub.qualcomm.com/en/run/android/api-reference (raw: `.../api-reference.md`)

Docs index (`https://geniex.aihub.qualcomm.com/llms.txt`) confirms the Android section is exactly these three pages. Related pages referenced from this section but NOT part of it: `/en/get-started/platforms`, `/en/models/supported` (anchors `#run-a-local-qualcomm-ai-engine-direct-bundle`, `#run-a-local-gguf-model`), `/en/resources/faq#how-do-i-test-the-android-demo-without-a-physical-device`.

**Framing for the UI/agent-app engineer:** this section is a *Kotlin/JNI in-process SDK*, not an HTTP server. It contains NO HTTP endpoints, NO OpenAI-compatibility details, NO tool/function calling, NO grammar/structured output, NO speculative decoding, NO sliding window, NO keepalive/unload semantics, NO env vars other than one mention of `GENIEX_HFTOKEN`, and NO CLI flags. What it does give you is the *canonical vocabulary and semantics* of the underlying native SDK (runtime ids, compute-unit aliases, hub sources, precision strings, chipset codes, chat-template contract, VLM image contract, error names) which the Windows CLI / local server share. It is also the only place in the docs describing on-device Android; it is not applicable to running on the user's Windows-on-Snapdragon machine except as a reference for semantics.

---

## 1. Android Install page

**Page description:** "Add the GenieX Android SDK to your Gradle project from Maven Central."

Intro sentence (exact): "Add the GenieX SDK to an Android Studio project so your app can pull weights from Hugging Face / Qualcomm AI Hub and run them on the Hexagon NPU, Adreno GPU, or CPU compute units — all in Kotlin."

### "Try the sample app first"
- Reference chat app lives in `qualcomm/ai-hub-apps`, path `geniex_chat_android`: https://github.com/qualcomm/ai-hub-apps/blob/release/geniex_chat_android/README.md
- Features called out: "model picker, resumable downloads, and VLM support". "Pick a model from the dropdown and choose NPU, GPU, or CPU on load. Tap the image button for VLMs. Stay on Wi-Fi for the first download."
- No phone? Link: "Testing without a physical device" → `/en/resources/faq#how-do-i-test-the-android-demo-without-a-physical-device`.

### Prerequisites (exact)
- **Android Studio** Hedgehog (2023.1.1) or newer (link: https://developer.android.com/studio/releases/past-releases/as-hedgehog-release-notes).
- **`minSdk = 27`** (Android 8.1) in your app module.
- A phone running **Snapdragon 8 Elite** (`SM8750`) or **Snapdragon 8 Elite Gen 5** (`SM8850`) — see Supported platforms `/en/get-started/platforms`.

### Add the SDK to your app (4 steps)
Step 1 — "Enable Maven Central" — in `settings.gradle.kts` (or top-level `build.gradle.kts` for older projects):
```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
```
Step 2 — "Add the dependency" — in the **app module**'s `build.gradle.kts`:
```kotlin
dependencies {
    implementation("com.qualcomm.qti:geniex-android:0.3.1")
}
```
"The artifact ships native `arm64-v8a` libraries — no NDK or CMake on your side."
(Note: Android SDK artifact version is **0.3.1**, whereas the installed Windows CLI is v0.4.0 — versions are not in lockstep.)

Step 3 — "Declare permissions" — "The SDK pulls weights at runtime." In `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```
"For VLMs that load images from the gallery, also declare `READ_EXTERNAL_STORAGE` (or scoped media permissions on Android 13+)."

Step 4 — "Sync Gradle" — Click **Sync Now** in Android Studio.

Next → Quickstart `/en/run/android/quickstart`.

---

## 2. Android Quickstart page

**Page description:** "Run your first model from the GenieX Android SDK in Kotlin."

### Prerequisites
- SDK added to Gradle (Install page).
- Phone running Snapdragon 8 Elite or Snapdragon 8 Elite Gen 5.
- `INTERNET` permission ("the SDK pulls weights from Hugging Face / Qualcomm AI Hub on first use").

### "Run your first model" — canonical flow
"The flow is the same regardless of model: **init the SDK → pull weights → load → generate**." Example model: `unsloth/Qwen3-0.6B-GGUF` — "a small Qwen3 0.6B chat model that runs on any supported chipset."

**Step 1: Init the SDK** — "Call once on app startup (idempotent — safe inside `Activity.onCreate`)":
```kotlin
GenieXSdk.getInstance().init(context)
```

**Step 2: Pull the model** — "`pullFlow` streams progress events. Run inside a coroutine on `Dispatchers.IO`":
```kotlin
ModelManagerWrapper.pullFlow(
    ModelPullInput(
        model_name = "unsloth/Qwen3-0.6B-GGUF",
        precision  = "Q4_0",
        hub        = HubSource.HUGGINGFACE,
    )
).collect { event ->
    when (event) {
        is ModelManagerWrapper.PullEvent.Progress  -> /* update UI */
        ModelManagerWrapper.PullEvent.Completed    -> /* done */
        is ModelManagerWrapper.PullEvent.Error     -> /* show error */
    }
}
```
"Downloads are resumable — killing the app mid-pull and re-running picks up where it left off."

**Step 3: Load the model** — "Resolve the on-disk paths and build an `LlmWrapper`":
```kotlin
val paths = ModelManagerWrapper.getPaths("unsloth/Qwen3-0.6B-GGUF")
    ?: error("Model not downloaded")

val llm = LlmWrapper.builder()
    .llmCreateInput(
        LlmCreateInput(
            model_path = paths.model_path,
            config     = ModelConfig(nCtx = 4096),
            runtime_id  = "llama_cpp",
            compute_unit  = null,   // null → NPU on Snapdragon (recommended)
        )
    )
    .build()
    .getOrThrow()
```

**Step 4: Generate** — "Apply the chat template, then collect tokens from the streaming flow":
```kotlin
val chat = arrayListOf(ChatMessage("user", "What is AI?"))
val templated = llm.applyChatTemplate(chat.toTypedArray(), null, false).getOrThrow()

llm.generateStreamFlow(
    templated.formattedText,
    GenerationConfig(maxTokens = 2048),
).collect { result ->
    when (result) {
        is LlmStreamResult.Token     -> print(result.text)
        is LlmStreamResult.Completed -> println("\nDone")
        is LlmStreamResult.Error     -> println("Error: ${result.throwable}")
    }
}
```
**Warning (exact):** "Always pass `templated.formattedText` (the chat-templated prompt) into `generateStreamFlow`, **not** the raw user text. The native pipeline expects an already-templated prompt."

### "Switching models"
"Swapping models is mostly a matter of changing the `model_name` and the `runtime_id`. There are two runtimes:"
- **`llama_cpp`** — "runs any GGUF model. Supports NPU / GPU / CPU compute units via `compute_unit`."
- **`qairt`** (Qualcomm AI Engine Direct) — "runs Qualcomm AI Hub Models. NPU-only, requires an explicit `chipset` on Android."

**Another GGUF model (llama.cpp)** — "Just change the `model_name` (and `precision` if you want a different one) — the rest of the flow is identical":
```kotlin
ModelPullInput(
    model_name = "unsloth/Qwen3-VL-2B-Instruct-GGUF",
    precision  = "Q4_0",
    hub        = HubSource.HUGGINGFACE,
)
```
"For VLMs, also pass `paths.mmproj_path` into `VlmCreateInput` — see API reference → VLM."

**A Qualcomm AI Hub Model (NPU via Qualcomm AI Engine Direct)** — "Qualcomm AI Hub Models are pre-compiled per chipset and only run on the NPU. You **must** pass `chipset` on Android":
```kotlin
ModelManagerWrapper.pullFlow(
    ModelPullInput(
        model_name = "ai-hub-models/Qwen3-4B-Instruct-2507",
        hub        = HubSource.AUTO,   // routes ai-hub-models/* to Qualcomm AI Hub
        chipset    = "SM8750",         // SM8750 = 8 Elite, SM8850 = 8 Elite Gen 5
    )
).collect { /* … */ }
```
"Then switch `runtime_id = "qairt"` in `LlmCreateInput`."

**Switching compute unit (NPU / GPU / CPU)** — "For `llama_cpp` only — set `compute_unit` on `LlmCreateInput`":

| `compute_unit` | Compute unit |
| --- | --- |
| `null` or `"npu"` | Hexagon NPU (recommended on Snapdragon). |
| `"gpu"` | Adreno GPU via OpenCL. |
| `"cpu"` | Pure CPU. Works on any ARM64 chipset. |

"Qualcomm AI Engine Direct ignores this — `cpu`/`gpu` are coerced to NPU with a warning."

### "Using a local model"
"If the weights are already on the device — side-loaded via `adb push`, bundled in your app's files dir, or produced by another tool — point the model manager at that directory instead of a hub: set `hub = HubSource.LOCALFS` and `local_path` to the on-disk location. `pullFlow` imports it into the SDK cache (no network), after which `getPaths` / `LlmWrapper` work exactly as they do for a downloaded model."
Full Android snippets for local import live on the Models page:
- Run a local Qualcomm AI Engine Direct bundle → Android: `/en/models/supported#run-a-local-qualcomm-ai-engine-direct-bundle`
- Run a local GGUF model → Android: `/en/models/supported#run-a-local-gguf-model`

### "Using the sample app" — UI patterns worth borrowing (exact bullets)
- **Model picker UI** — "the dropdown is driven by `app/src/main/assets/model_list.json`. Each entry pins a `model_name`, `hub`, and (for Qualcomm AI Engine Direct) a `chipset`. Edit this file to add new models without touching code."
- **Resumable downloads with progress** — "the `Progress` events from `pullFlow` carry per-file byte counts; the sample wires them straight into a `LinearProgressIndicator`."
- **Runtime-aware compute-unit picker** — "when the selected model uses Qualcomm AI Engine Direct, the picker hides GPU/CPU options. See `LoadDialog.kt`."
- **VLM image picker** — "for VLMs, the sample passes the absolute file path into `VlmContent("image", path)`. Don't pass content URIs — the native side reads the file directly."

### Next steps cards
- API reference `/en/run/android/api-reference` — "Wrapper classes, runtime / compute-unit selection, and data structures."
- Platforms & runtimes `/en/get-started/platforms` — "Snapdragon platforms and when to pick llama.cpp vs Qualcomm AI Engine Direct."

---

## 3. Android API reference page

**Page description:** "GenieX Android SDK — runtime / compute-unit selection, model management, and inference APIs for LLM and VLM."

### 3.1 Runtime & compute unit selection

**Runtime** — "Choose the inference runtime via `runtime_id`":
```kotlin
val runtime_id: String?   // "llama_cpp" | "qairt" | null
```
| `runtime_id` | Runtime | Model format | Compute units |
| --- | --- | --- | --- |
| `"llama_cpp"` | llama.cpp + GGML Hexagon backend | GGUF | CPU / Adreno GPU / Hexagon NPU |
| `"qairt"` | Qualcomm® AI Engine Direct | Qualcomm AI Hub pre-compiled bins | Hexagon NPU only |
| `null` | SDK picks based on model paths | — | — |

"Constants are exposed as `RuntimeIdValue` (`LLAMA_CPP`, `QAIRT`)." Source link: https://github.com/qualcomm/GenieX/blob/main/bindings/android/app/src/main/java/com/geniex/sdk/bean/InputPluginBase.kt (→ the GenieX repo is public at `github.com/qualcomm/GenieX`; Android bindings live under `bindings/android/`).

**Compute unit** — "Friendly compute-unit aliases forwarded to `geniex_resolve_device` in the native SDK." (`geniex_resolve_device` = native C API symbol name.)
```kotlin
val compute_unit: String?   // "cpu" | "gpu" | "npu" | null
```
| Alias | Effect |
| --- | --- |
| `null` | Runtime default — `npu` for `llama_cpp`, `npu` for `qairt`. |
| `"npu"` | Hexagon NPU acceleration. Recommended on Snapdragon. |
| `"gpu"` | Adreno GPU via OpenCL (`llama_cpp` only). |
| `"cpu"` | Pure CPU. Forces `nGpuLayers = 0`. |

Note (exact): "Qualcomm AI Engine Direct only supports NPU. Passing `"cpu"` or `"gpu"` with a Qualcomm AI Hub Model logs a warning and falls back to NPU — it won't error."

Notable: a `hybrid` alias is mentioned once in the `nGpuLayers` note ("`gpu` / `npu` / `hybrid` pass the value through") but is NOT in the documented `compute_unit` alias list for Android — it exists in the native layer (matches CLI `--compute cpu|gpu|npu|hybrid`).

### 3.2 Model manager

"Models are pulled on-device through the bundled Rust model manager. Do **not** manually `adb push` weights — use `ModelManagerWrapper`." (→ the model manager is a Rust component; on Android it is bundled in the AAR.)

**`ModelManagerWrapper`** API surface (exact code block):
```kotlin
// Init (idempotent — safe to call on every Activity.onCreate).
GenieXSdk.getInstance().init(context)

// Pull with streaming progress.
ModelManagerWrapper.pullFlow(
    ModelPullInput(
        model_name = "unsloth/Qwen3-0.6B-GGUF",
        precision  = "Q4_0",
        hub        = HubSource.HUGGINGFACE,
    )
).collect { event ->
    when (event) {
        is ModelManagerWrapper.PullEvent.Progress  -> /* update UI */
        ModelManagerWrapper.PullEvent.Completed    -> /* done */
        is ModelManagerWrapper.PullEvent.Error     -> /* show error */
    }
}

// Resolve on-disk paths for a previously-pulled model.
val paths: ModelPaths? = ModelManagerWrapper.getPaths("unsloth/Qwen3-0.6B-GGUF")

// Inventory / cleanup.
ModelManagerWrapper.list()              // List<String>
ModelManagerWrapper.remove("org/repo") // 0 = success
ModelManagerWrapper.clean()            // wipe all cached models
```
Methods: `pullFlow(ModelPullInput): Flow<PullEvent>`; `getPaths(modelName): ModelPaths?`; `list(): List<String>`; `remove("org/repo"): Int` (0 = success); `clean()` (wipe all cached models). These mirror the CLI `pull` / `list` / `remove` / `clean` verbs.

`PullEvent` sealed variants: `PullEvent.Progress` (data class; carries `event.files` — per-file byte counts, see `updateProgressBar(event.files)` in the AI Hub sample), `PullEvent.Completed` (object), `PullEvent.Error` (data class with `event.code` and `event.message` — see `println("err ${event.code}: ${event.message}")`).

**`ModelPullInput`** (exact):
```kotlin
data class ModelPullInput(
    val model_name:   String,                     // "org/repo" or alias
    val precision:    String? = null,             // precision (quantization) e.g. "Q4_0", "Q4_K_M"
    val hub:          HubSource = HubSource.AUTO, // AUTO routes by model_name
    val local_path:   String? = null,             // only when hub == LOCALFS
    val hf_token:     String? = null,             // falls back to GENIEX_HFTOKEN env
    val chipset:      String? = null,             // required for Qualcomm AI Hub on Android (e.g. "SM8750")
    val display_name: String? = null,
)
```
- Model naming: `"org/repo"` (HF-style) or an alias.
- Precision strings are GGUF quant names, e.g. `"Q4_0"`, `"Q4_K_M"`. (Precision is omitted for AI Hub models in all examples.)
- Env var: **`GENIEX_HFTOKEN`** — Hugging Face token fallback when `hf_token` is null (needed for gated repos).
- `chipset` — required for AI Hub pulls on Android; e.g. `"SM8750"`.
- `display_name` — optional label (undocumented purpose beyond the field).

**`HubSource`** enum (exact):
```kotlin
enum class HubSource(val value: Int) {
    AUTO(0),          // routes by prefix (e.g. ai-hub-models/* → AIHUB)
    HUGGINGFACE(1),
    MODELSCOPE(2),
    AIHUB(3),
    VOLCES(4),
    LOCALFS(127),
}
```
- Note the Android SDK exposes hubs beyond the CLI's `aihub|hf|docker|localfs`: it has `MODELSCOPE` and `VOLCES` (Volcano Engine), and no `docker`. `AUTO` routes by model-name prefix: `ai-hub-models/*` → AIHUB.

**`ModelPaths`** — "Returned by `getPaths()`. Feed fields directly into `LlmCreateInput` / `VlmCreateInput`" (exact):
```kotlin
data class ModelPaths(
    val model_path:     String,
    val model_dir:      String,
    val model_name:     String,
    val runtime_id:      String,            // authoritative — prefer over UI selection
    val mmproj_path:    String? = null,    // VLM projection weights
    val tokenizer_path: String? = null,
    val compute_unit:      String? = null,
)
```
- `runtime_id` in `ModelPaths` is "authoritative — prefer over UI selection" → the model manager knows which runtime a cached model needs; a UI should read it rather than let the user pick.
- `mmproj_path` present for VLMs.

Note (exact): "Qualcomm AI Hub pulls on Android **require** an explicit `chipset`. The Rust side only auto-detects on Windows on Snapdragon. Use `"SM8750"` for Snapdragon 8 Elite or `"SM8850"` for Snapdragon 8 Elite Gen 5." (→ On Windows on Snapdragon, chipset auto-detection exists — relevant to the user's X1E80100 machine.)

### 3.3 Data structures

**`LlmCreateInput`**:
```kotlin
data class LlmCreateInput(
    val model_path:     String,
    val tokenizer_path: String? = null,
    val config:         ModelConfig,
    val runtime_id:      String? = null,
    val compute_unit:      String? = null,
)
```
**`VlmCreateInput`**:
```kotlin
data class VlmCreateInput(
    val model_path:  String,
    val mmproj_path: String? = null,     // vision projection weights (GGUF VLMs)
    val config:      ModelConfig,
    val runtime_id:   String? = null,
    val compute_unit:   String? = null,
)
```
**`ModelConfig`** (defaults are load-bearing):
```kotlin
data class ModelConfig(
    var nCtx:                  Int     = 2048,     // context size; 0 = model default
    var nThreads:              Int     = 8,
    var nThreadsBatch:         Int     = 8,
    var nBatch:                Int     = 2048,
    var nUBatch:               Int     = 512,
    var nSeqMax:               Int     = 1,
    var nGpuLayers:            Int     = -1,    // -1 = all layers
    val chat_template_path:    String  = "",
    val chat_template_content: String  = "",
)
```
- Note (exact): "`nGpuLayers` is rewritten by the JNI based on `compute_unit`: `cpu` forces 0; `gpu` / `npu` / `hybrid` pass the value through (`-1` = all layers)."
- `nSeqMax = 1` default → single sequence; no documented multi-sequence/concurrency support in the Android SDK.
- Custom chat templates can be supplied via `chat_template_path` or `chat_template_content` (llama.cpp-style Jinja presumably; docs don't elaborate).
- These map to CLI equivalents `--nctx` (nCtx) and `--ngl` (nGpuLayers).

**`ChatMessage`**:
```kotlin
data class ChatMessage(
    var role:    String,   // "system" | "user" | "assistant"
    var content: String,
)
```
Roles documented: `"system" | "user" | "assistant"` only — no `"tool"` role, i.e. no tool-calling message shape in this SDK.

**`VlmChatMessage` / `VlmContent`**:
```kotlin
data class VlmChatMessage(
    val role:     String?,                 // "system" | "user" | "assistant"
    val contents: List<VlmContent>,
)

data class VlmContent(
    val type: String?,                     // "text" | "image"
    val text: String?,                     // text content, or absolute file path for image
)
```
VLM image input format on Android = **absolute file path on device** placed in the `text` field with `type = "image"` (e.g. `/storage/emulated/0/Pictures/example.jpg`). Not a URL, not base64, not a content URI. Content types: `"text" | "image"` only (no `"audio"` content type despite `audioPaths` in `GenerationConfig`).

**`GenerationConfig`**:
```kotlin
data class GenerationConfig(
    var maxTokens:     Int              = 32,
    var stopWords:     Array<String>?   = null,
    var stopCount:     Int              = 0,
    var samplerConfig: SamplerConfig?   = null,
    var imagePaths:    Array<String>?   = null,
    var imageCount:    Int              = 0,
    var audioPaths:    Array<String>?   = null,
    var audioCount:    Int              = 0,
)
```
- Note (exact): "The default `maxTokens` is **32**. Most use cases should set a higher value (e.g. `maxTokens = 2048`)."
- `stopWords` + `stopCount` = stop sequences (mirrors CLI `--stop`).
- `samplerConfig: SamplerConfig?` exists but `SamplerConfig` is NOT documented on this page (no fields listed) — presumably temperature/top-p/top-k/min-p/penalties/seed like the CLI `run` flags; you'd have to read the Kotlin source in `bindings/android`.
- `imagePaths`/`imageCount` and `audioPaths`/`audioCount` — media inputs are attached to generation via arrays of absolute paths; `VlmWrapper.injectMediaPathsToConfig(chat, GenerationConfig)` fills these from the `VlmChatMessage` contents. `audioPaths` hints at audio-input support in the native layer (see the separate "Audio input" tutorial for CLI/server/Python), but no Android audio example is given.

**`LlmStreamResult`** (streaming shape — the SDK's equivalent of SSE):
```kotlin
sealed class LlmStreamResult {
    data class Token(val text: String)              : LlmStreamResult()
    data class Completed(val profile: ProfilingData) : LlmStreamResult()
    data class Error(val throwable: Throwable)      : LlmStreamResult()
}
```
- `Completed` carries `ProfilingData` (fields not documented here — presumably prompt/decode token counts and timings for a tokens/sec readout).
- Streaming is a Kotlin `Flow`; the same `LlmStreamResult` type is used by both `LlmWrapper` and `VlmWrapper`.

### 3.4 llama.cpp (GGUF models)
"Runs any GGUF model on CPU, Adreno GPU, or Hexagon NPU. Compute-unit selection is controlled by `compute_unit`."

**LLM** (exact):
```kotlin
val paths = ModelManagerWrapper.getPaths("unsloth/Qwen3-0.6B-GGUF")
    ?: error("Model not downloaded")

LlmWrapper.builder()
    .llmCreateInput(
        LlmCreateInput(
            model_path = paths.model_path,
            config     = ModelConfig(nCtx = 4096),
            runtime_id  = "llama_cpp",
            compute_unit  = null,       // null → npu (recommended on Snapdragon)
        )
    )
    .build()
    .onSuccess { llmWrapper = it }
    .onFailure { println("Error: ${it.message}") }

val chat = arrayListOf(ChatMessage("user", "What is AI?"))

llmWrapper.applyChatTemplate(chat.toTypedArray(), null, false).onSuccess { t ->
    llmWrapper.generateStreamFlow(t.formattedText, GenerationConfig(maxTokens = 2048)).collect { result ->
        when (result) {
            is LlmStreamResult.Token     -> print(result.text)
            is LlmStreamResult.Completed -> println("\nDone")
            is LlmStreamResult.Error     -> println("Error: ${result.throwable}")
        }
    }
}
```
API observations: `LlmWrapper.builder().llmCreateInput(...).build()` returns a Kotlin `Result<LlmWrapper>` (`.getOrThrow()`, `.onSuccess`, `.onFailure`). `applyChatTemplate(messages: Array<ChatMessage>, <second arg: null>, <third arg: false>)` returns `Result<...>` with a `.formattedText` field. The 2nd and 3rd args are undocumented on this page (plausibly a template override and an add-generation-prompt / enable-thinking style boolean — the qairt note mentions `enable_thinking`). `generateStreamFlow(prompt: String, GenerationConfig): Flow<LlmStreamResult>`.

**Compute-unit variants** table:
| Goal | `compute_unit` | Notes |
| --- | --- | --- |
| Snapdragon NPU (recommended) | `"npu"` or `null` | Hexagon NPU acceleration. |
| Adreno GPU (OpenCL) | `"gpu"` | Defaults to `nGpuLayers = -1` (all layers). |
| Pure CPU | `"cpu"` | Works on any ARM64 chipset. |

**VLM** — "GGUF VLMs need two artifacts: the LLM weights (`model_path`) and the vision projection (`mmproj_path`). Both come from `getPaths()`" (exact):
```kotlin
val paths = ModelManagerWrapper.getPaths("unsloth/Qwen3-VL-2B-Instruct-GGUF")
    ?: error("Model not downloaded")

VlmWrapper.builder()
    .vlmCreateInput(
        VlmCreateInput(
            model_path  = paths.model_path,
            mmproj_path = paths.mmproj_path,
            config      = ModelConfig(nCtx = 4096),
            runtime_id   = "llama_cpp",
            compute_unit   = null,
        )
    )
    .build()
    .onSuccess { vlmWrapper = it }

val msg = VlmChatMessage(
    role     = "user",
    contents = listOf(
        VlmContent("image", "/storage/emulated/0/Pictures/example.jpg"),
        VlmContent("text",  "Describe this image."),
    ),
)
val chat = arrayListOf(msg)

vlmWrapper.applyChatTemplate(chat.toTypedArray(), null, false).onSuccess { t ->
    val gen = vlmWrapper.injectMediaPathsToConfig(chat.toTypedArray(), GenerationConfig(maxTokens = 2048))
    vlmWrapper.generateStreamFlow(t.formattedText, gen).collect { result ->
        when (result) {
            is LlmStreamResult.Token     -> print(result.text)
            is LlmStreamResult.Completed -> println("\nDone")
            is LlmStreamResult.Error     -> println("Error: ${result.throwable}")
        }
    }
}
```
Note (exact): "Always pass `t.formattedText` (the chat-templated prompt) into `generateStreamFlow`, **not** the raw user text. The native pipeline treats the prompt as already-templated."
VLM flow = `applyChatTemplate` (produces text with image placeholders) + `injectMediaPathsToConfig` (copies image paths into `GenerationConfig.imagePaths/imageCount`) + `generateStreamFlow`.

### 3.5 Qualcomm® AI Hub Models (NPU via Qualcomm AI Engine Direct)
"Pre-compiled models from Qualcomm AI Hub. NPU-only, pinned to a specific chipset (`SM8750` = Snapdragon 8 Elite, `SM8850` = Snapdragon 8 Elite Gen 5)."

**Downloading** (exact):
```kotlin
ModelManagerWrapper.pullFlow(
    ModelPullInput(
        model_name = "ai-hub-models/Qwen2.5-VL-7B-Instruct",
        hub        = HubSource.AUTO,     // AUTO routes `ai-hub-models/*` to Qualcomm AI Hub
        chipset    = "SM8750",           // REQUIRED on Android
    )
).collect { event ->
    when (event) {
        is ModelManagerWrapper.PullEvent.Progress  -> updateProgressBar(event.files)
        ModelManagerWrapper.PullEvent.Completed    -> println("done")
        is ModelManagerWrapper.PullEvent.Error     -> println("err ${event.code}: ${event.message}")
    }
}
```

**Supported models** (the ONLY two AI Hub repos listed for Android):
| Modality | Hub repo |
| --- | --- |
| LLM | `ai-hub-models/Qwen3-4B-Instruct-2507` |
| VLM | `ai-hub-models/Qwen2.5-VL-7B-Instruct` |

**LLM** (exact):
```kotlin
val paths = ModelManagerWrapper.getPaths("ai-hub-models/Qwen3-4B-Instruct-2507")
    ?: error("Model not downloaded")

LlmWrapper.builder()
    .llmCreateInput(
        LlmCreateInput(
            model_path = paths.model_path,
            config     = ModelConfig(),
            runtime_id  = "qairt",
            compute_unit  = null,           // null → NPU (only option for Qualcomm AI Engine Direct)
        )
    )
    .build()
    .onSuccess { llmWrapper = it }
    .onFailure { println("Error: ${it.message}") }

val chat = arrayListOf(ChatMessage("user", "What is AI?"))

llmWrapper.applyChatTemplate(chat.toTypedArray(), null, false).onSuccess { t ->
    llmWrapper.generateStreamFlow(t.formattedText, GenerationConfig()).collect { result ->
        when (result) {
            is LlmStreamResult.Token     -> print(result.text)
            is LlmStreamResult.Completed -> println("\nDone")
            is LlmStreamResult.Error     -> println("Error: ${result.throwable}")
        }
    }
}
```
**Critical note (exact):** "Qualcomm AI Engine Direct rejects `nGpuLayers != 0` and `nCtx != 0` with `PARAM_NOT_SUPPORTED` — the KV cache and context length are fixed at compile time by the Qualcomm AI Hub bundle. Leave both at defaults and use `max_tokens` / `enable_thinking` only."
→ Implications: with `qairt`, context length is baked into the bundle (no `nCtx` override, no sliding window control); `nGpuLayers` must be 0 (the JNI/compute-unit coercion handles this when `compute_unit = null`); only `max_tokens` and `enable_thinking` are tunable — this is the sole mention of **thinking mode** (`enable_thinking`) in the Android section, and it names an error code `PARAM_NOT_SUPPORTED`. (Slight inconsistency: `ModelConfig()` default has `nCtx = 2048` and `nGpuLayers = -1`, yet the qairt example uses `ModelConfig()` — so the JNI/native must treat defaults specially for qairt; the doc says "leave both at defaults".)

**VLM** (exact):
```kotlin
val paths = ModelManagerWrapper.getPaths("ai-hub-models/Qwen2.5-VL-7B-Instruct")
    ?: error("Model not downloaded")

VlmWrapper.builder()
    .vlmCreateInput(
        VlmCreateInput(
            model_path  = paths.model_path,
            mmproj_path = paths.mmproj_path,
            config      = ModelConfig(),
            runtime_id   = "qairt",
            compute_unit   = null,
        )
    )
    .build()
    .onSuccess { vlmWrapper = it }

val msg = VlmChatMessage(
    role     = "user",
    contents = listOf(
        VlmContent("image", "/storage/emulated/0/Pictures/cat.jpg"),
        VlmContent("text",  "What's in this image?"),
    ),
)
val chat = arrayListOf(msg)

vlmWrapper.applyChatTemplate(chat.toTypedArray(), null, false).onSuccess { t ->
    val gen = vlmWrapper.injectMediaPathsToConfig(chat.toTypedArray(), GenerationConfig(maxTokens = 2048))
    vlmWrapper.generateStreamFlow(t.formattedText, gen).collect { result ->
        when (result) {
            is LlmStreamResult.Token     -> print(result.text)
            is LlmStreamResult.Completed -> println("\nDone")
            is LlmStreamResult.Error     -> println("Error: ${result.throwable}")
        }
    }
}
```
Note (exact): "Pass the **chat-templated** prompt (`t.formattedText`) to `generateStreamFlow`, never raw user text. Qualcomm AI Engine Direct VLM treats its prompt as already-templated — raw text produces degenerate output."

### 3.6 Need help?
- GitHub Issues: https://github.com/qualcomm/GenieX/issues — "File a bug, request a feature, or browse open issues."
- Slack: https://aihub.qualcomm.com/community/slack — "Developer collaboration and resources."

---

## 4. Cross-cutting takeaways for the UI/agent-app engineer

**Vocabulary shared with the native SDK / CLI (use these exact strings in your UI/model registry):**
- Runtime ids: `"llama_cpp"`, `"qairt"` (constants `RuntimeIdValue.LLAMA_CPP` / `RuntimeIdValue.QAIRT`).
- Compute-unit aliases: `"cpu" | "gpu" | "npu" | null` (+ `hybrid` in native layer). Default = NPU for both runtimes. `cpu` forces `nGpuLayers = 0`; qairt coerces cpu/gpu → npu with warning (no error).
- Chipset codes: `SM8750` (Snapdragon 8 Elite), `SM8850` (Snapdragon 8 Elite Gen 5). AI Hub bundles are pinned per chipset; on Windows on Snapdragon the Rust model manager auto-detects the chipset, on Android you must pass it.
- Hub sources: `AUTO(0)`, `HUGGINGFACE(1)`, `MODELSCOPE(2)`, `AIHUB(3)`, `VOLCES(4)`, `LOCALFS(127)`; AUTO routes `ai-hub-models/*` → AIHUB.
- Model names: `"org/repo"` (e.g. `unsloth/Qwen3-0.6B-GGUF`, `unsloth/Qwen3-VL-2B-Instruct-GGUF`, `ai-hub-models/Qwen3-4B-Instruct-2507`, `ai-hub-models/Qwen2.5-VL-7B-Instruct`) or alias; GGUF precision as `"Q4_0"`, `"Q4_K_M"`.
- Env var: `GENIEX_HFTOKEN` (HF token fallback).
- Native symbol: `geniex_resolve_device`. Error code: `PARAM_NOT_SUPPORTED`.

**Design patterns to replicate in a desktop UI (from the sample app):** JSON-driven model list (`model_name`, `hub`, `chipset`); per-file byte-count download progress with resume; runtime-aware compute-unit picker (hide GPU/CPU when runtime is qairt); pass absolute file paths for VLM images; treat `ModelPaths.runtime_id` as authoritative; always chat-template before generation; default `maxTokens` is tiny (32) — always set explicitly.

**Explicitly NOT present / NOT supported in the Android SDK docs:**
- No HTTP server / OpenAI-compatible API on Android (in-process only).
- No tool/function calling, no `"tool"` role, no grammar/JSON-schema output, no speculative decoding, no draft models, no sliding window, no keepalive/unload, no concurrency (`nSeqMax = 1`), no LoRA, no embeddings, no image/video *generation* (only VLM image *understanding* via `type = "image"` absolute path).
- Only chipsets: Snapdragon 8 Elite (SM8750) and 8 Elite Gen 5 (SM8850); `minSdk 27`; `arm64-v8a` only.
- qairt (AI Hub) runtime: NPU only; `nCtx`/`nGpuLayers` not adjustable (`PARAM_NOT_SUPPORTED`); only two supported AI Hub repos on Android; must specify chipset.
- `SamplerConfig` and `ProfilingData` fields, and `applyChatTemplate`'s 2nd/3rd parameters, are undocumented on the page.
- Audio: `audioPaths` exists in `GenerationConfig` but there is no Android audio example and no `"audio"` `VlmContent` type documented.
- Sample app requires a physical phone (FAQ has a section on testing without one).

**Version note:** Android artifact is `com.qualcomm.qti:geniex-android:0.3.1` (Maven Central) vs. CLI v0.4.0 installed on the user's machine.

## KEY FACTS
- Android SDK section = exactly 3 pages (Install, Quickstart, API reference); it is an in-process Kotlin/JNI SDK with NO HTTP endpoints, NO OpenAI-compat, NO tool calling, NO grammar, NO speculative decoding, NO keepalive/unload semantics documented.
- Gradle dependency: implementation("com.qualcomm.qti:geniex-android:0.3.1") from mavenCentral(); ships arm64-v8a native libs (no NDK/CMake); minSdk = 27; Android Studio Hedgehog 2023.1.1+; needs android.permission.INTERNET (+ READ_EXTERNAL_STORAGE / scoped media perms for VLM gallery images).
- Supported phones: only Snapdragon 8 Elite (SM8750) and Snapdragon 8 Elite Gen 5 (SM8850). AI Hub (qairt) pulls on Android REQUIRE an explicit chipset string; the Rust model manager only auto-detects chipset on Windows on Snapdragon.
- Canonical flow: GenieXSdk.getInstance().init(context) -> ModelManagerWrapper.pullFlow(ModelPullInput) [Flow of PullEvent.Progress(files)/Completed/Error(code,message), resumable] -> ModelManagerWrapper.getPaths(name): ModelPaths? -> LlmWrapper.builder().llmCreateInput(LlmCreateInput).build(): Result -> applyChatTemplate(msgs, null, false).formattedText -> generateStreamFlow(prompt, GenerationConfig): Flow<LlmStreamResult.Token|Completed(ProfilingData)|Error>.
- runtime_id: "llama_cpp" (llama.cpp + GGML Hexagon backend, GGUF, CPU/Adreno GPU/Hexagon NPU) | "qairt" (Qualcomm AI Engine Direct, AI Hub pre-compiled bins, NPU only) | null (SDK picks from model paths). Constants RuntimeIdValue.LLAMA_CPP / QAIRT.
- compute_unit aliases: null (default -> npu for both runtimes), "npu", "gpu" (Adreno via OpenCL, llama_cpp only), "cpu" (forces nGpuLayers=0). qairt coerces cpu/gpu to NPU with a warning, never errors. 'hybrid' is mentioned as passing nGpuLayers through in the JNI but is not in the documented alias list.
- HubSource enum: AUTO(0) routes by prefix (ai-hub-models/* -> AIHUB), HUGGINGFACE(1), MODELSCOPE(2), AIHUB(3), VOLCES(4), LOCALFS(127). ModelPullInput fields: model_name ("org/repo" or alias), precision (e.g. "Q4_0", "Q4_K_M"), hub, local_path (LOCALFS only), hf_token (falls back to env GENIEX_HFTOKEN), chipset, display_name.
- ModelPaths { model_path, model_dir, model_name, runtime_id (authoritative - prefer over UI selection), mmproj_path (VLM), tokenizer_path, compute_unit }. ModelManagerWrapper also has list(): List<String>, remove("org/repo"): 0=success, clean() wipes cache. Do NOT adb push weights manually.
- ModelConfig defaults: nCtx=2048 (0 = model default), nThreads=8, nThreadsBatch=8, nBatch=2048, nUBatch=512, nSeqMax=1, nGpuLayers=-1 (all layers), chat_template_path="", chat_template_content="". GenerationConfig defaults: maxTokens=32 (docs warn to raise, e.g. 2048), stopWords/stopCount, samplerConfig: SamplerConfig? (fields undocumented), imagePaths/imageCount, audioPaths/audioCount.
- qairt limitation: rejects nGpuLayers != 0 and nCtx != 0 with PARAM_NOT_SUPPORTED because KV cache and context length are fixed at compile time in the AI Hub bundle; only max_tokens / enable_thinking are tunable (the only mention of thinking mode in this section). Only two AI Hub repos listed for Android: ai-hub-models/Qwen3-4B-Instruct-2507 (LLM) and ai-hub-models/Qwen2.5-VL-7B-Instruct (VLM).
- VLM contract: VlmChatMessage(role, contents: List<VlmContent(type="text"|"image", text)>) where image = ABSOLUTE on-device file path (not content URI, not URL/base64); VlmCreateInput needs model_path + mmproj_path; call vlmWrapper.injectMediaPathsToConfig(chat, GenerationConfig) after applyChatTemplate. Always pass the chat-templated formattedText to generateStreamFlow - raw text produces degenerate output.
- Sample app (qualcomm/ai-hub-apps release/geniex_chat_android): JSON-driven model picker (app/src/main/assets/model_list.json with model_name/hub/chipset), resumable per-file progress via LinearProgressIndicator, runtime-aware compute picker that hides GPU/CPU for qairt (LoadDialog.kt), absolute-path VLM image picker.
- Roles for ChatMessage are only "system"|"user"|"assistant" (no tool role). No image/video generation anywhere in the Android docs - only VLM image understanding. Local models: hub=HubSource.LOCALFS + local_path imports into SDK cache with no network; snippets live on /en/models/supported.
- Android artifact version 0.3.1 vs installed Windows CLI v0.4.0 - versions are independent. Public source for bindings: https://github.com/qualcomm/GenieX/blob/main/bindings/android/... (e.g. bean/InputPluginBase.kt); native device resolver symbol is geniex_resolve_device.

## OPEN QUESTIONS
- What are the fields of SamplerConfig and ProfilingData on Android (temperature/top-p/top-k/min-p/penalties/seed; prompt/decode tokens & timings)? Not documented on these pages - would need to read github.com/qualcomm/GenieX bindings/android source.
- What do the 2nd and 3rd parameters of applyChatTemplate(messages, null, false) mean (template override? add_generation_prompt / enable_thinking?) and how is enable_thinking actually toggled on Android?
- Does the Android SDK expose any tool/function-calling, grammar/JSON-schema, speculative decoding, or sliding-window controls that simply aren't documented, or are they truly absent from the Kotlin surface?
- Is 'hybrid' a valid compute_unit alias on Android (it is mentioned only in the nGpuLayers JNI note), and what does it mean concretely for llama.cpp + ggml-hexagon (NPU+GPU/CPU split)?
- How does audio input work on Android given GenerationConfig.audioPaths/audioCount exist but no 'audio' VlmContent type or example is documented?
- Exact GGUF precisions that land on the Hexagon NPU via ggml-hexagon (docs point to /en/models/supported for this) - not covered in the Android section.
- Whether the qairt VLM (Qwen2.5-VL-7B) mmproj_path is actually non-null for AI Hub bundles or whether the field is simply passed through; and whether more AI Hub repos beyond the two listed work on Android.
