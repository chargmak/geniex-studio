# GenieX v0.4.0 — external research report (Windows ARM64 / Snapdragon X Elite focus)

## 1. Primary sources found

| Resource | URL | Notes |
|---|---|---|
| GitHub repo (official) | https://github.com/qualcomm/GenieX | BSD-3-Clause, ~8.3k stars. `github.com/quic/geniex` is not the repo; `qualcomm/geniex` redirects to this. |
| Releases | https://github.com/qualcomm/GenieX/releases (v0.4.0 tag: https://github.com/qualcomm/GenieX/releases/tag/v0.4.0) | v0.4.0 published 2026-08-13; v0.3.20 backport same day. |
| Docs site index | https://geniex.aihub.qualcomm.com/llms.txt | 19 pages; every page has a raw `.md` twin (append `.md`). |
| Local server doc | https://geniex.aihub.qualcomm.com/en/run/cli/local-server.md | Full API examples (below). |
| Server OpenAPI spec (source of truth) | https://raw.githubusercontent.com/qualcomm/GenieX/main/cli/server/docs/swagger.yaml | Served live at `http://127.0.0.1:18181/docs/swagger.yaml`; Swagger UI at `http://127.0.0.1:18181/docs/ui/` (root `/` redirects there). |
| Server source | https://github.com/qualcomm/GenieX/tree/main/cli/server (`route.go`, `handler/chat.go`, `handler/chat_stream.go`, `handler/chat_response.go`, `handler/model.go`, `middleware/gil.go`, `middleware/cors.go`, `service/keepalive.go`, `utils/toolcall.go`) | Go + gin + openai-go v3. |
| Internal notes | https://github.com/qualcomm/GenieX/blob/main/notes/run.md | Contains the only first-party hybrid-vs-npu numbers. |
| Blog (June 2026 dev preview) | https://www.qualcomm.com/developer/blog/2026/06/geniex-developer-preview | Nexa AI acquisition; no perf numbers. |
| Landing page | https://aihub.qualcomm.com/geniex | Mentions OpenClaw + LangChain as OpenAI-compatible consumers. |
| DeepWiki | https://deepwiki.com/qualcomm/GenieX (troubleshooting: https://deepwiki.com/qualcomm/GenieX/8.2-troubleshooting-and-faq) | |
| PyPI | https://pypi.org/project/geniex/ (0.4.0, sdist only, 0.1 MB; SDK fetched from S3 at install; ARM64 Python 3.10+; docs cite Python 3.13.3 ARM64) | |
| AI Hub apps | https://github.com/qualcomm/ai-hub-apps — `geniex_chat_android`, `stable_diffusion_windows_py`, `whisper_windows_py`, `sam3_segmentation_windows_py` | "GenieX Chat Windows" listed on aihub.qualcomm.com/apps is just the CLI ("via CLI"); no first-party Windows GUI. |
| HF org | https://huggingface.co/qualcomm | 43 text-generation repos incl. LLM/VLM bundles (list in §6). |
| Docker `ai/` namespace | https://hub.docker.com/u/ai (98 repos via `hub.docker.com/v2/namespaces/ai/repositories`) | GenieX pulls these since v0.3.16 (PR #1165). |

No Reddit/HN/Medium/YouTube coverage of GenieX found (searches returned nothing relevant). No third-party GenieX-specific UI exists yet; the only community-visible client integration in issues is AnythingLLM (#1243).

## 2. Confirmed server API surface (from `route.go` + `swagger.yaml`)

```
GET  /                     -> 302 /docs/ui/   (Swagger UI)
GET  /docs/swagger.yaml
GET  /v1/                  -> "GenieX-CLI is running"
POST /v1/chat/completions  (LLM + VLM, streaming, tools)
POST /v1/completions       (raw prompt, no chat template; FIM; LLM only)  [new in v0.4.0]
POST /v1/logits            (prefill-only raw logits, pre-tokenized input_ids; NOT logprobs)
GET  /v1/models            (lists CACHED models only; id = "org/repo[:PRECISION]", owned_by = org)
GET  /v1/models/*model
```
Not present: `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `response_format`/`json_schema`, `n>1`, `logprobs` (schema only), `tool_choice` enforcement (schema exists, ignored), `/health` (use `GET /v1/`).

Server flags (`geniex serve -h`, v0.4.0 on this machine):
```
--host 127.0.0.1:18181 (GENIEX_HOST)   --origins "*" (GENIEX_ORIGINS)   --keepalive 300 (GENIEX_KEEPALIVE)
--nctx 4096 (GENIEX_NCTX, llama_cpp)   --ngl -1 (GENIEX_NGL, llama_cpp)  --compute cpu|gpu|npu|hybrid (GENIEX_COMPUTE)
--https --certfile cert.pem --keyfile key.pem   global: --data-dir (GENIEX_DATADIR) --log none..trace --skip-update --verbose
```

Chat request extra (non-OpenAI) body fields (from `swagger.yaml` / `chat.go`): `enable_think` (default true), `reasoning_format` (`none|deepseek|deepseek-legacy|auto`), `nctx`, `ngl`, `compute` (`cpu|gpu|npu|hybrid`), `top_k`, `min_p`, `repetition_penalty`, `grammar_path`, `grammar_string` (GBNF), `spec_type` (`draft-mtp|draft-eagle3|draft-simple|ngram-simple|ngram-map-k|ngram-map-k4v|ngram-mod|ngram-cache`), `spec_draft_model`, `spec_n_max`, `spec_n_min`, `spec_p_min`, `max_completion_tokens` (default 2048), `stream_options.include_usage`. Header `GenieX-KeepCache: true` skips the model `Reset()` between requests (KV cache retained); default is reset per request. A request with zero messages or a single `system` message is treated as a warm-up (loads model, returns `200 null`) — useful for a "preload model" button.

Behavioural facts from source that matter for a UI:
- **Global interpreter lock**: `middleware/gil.go` — "GILock serializes all API requests" (blocks, does not 429). One request at a time; no concurrency.
- **One model resident**: `keepalive.go` — "Drop the current model so only one stays in memory"; switching model/params (`nctx`, `ngl`, `compute`, `spec_*` are part of the cache key) reloads. Model auto-freed after `--keepalive` seconds idle (sweep every 5 s; guarded not to free mid-generation since #1322).
- **Streaming shape** (`chat_stream.go`): chunks are `{"object":"chat.completion.chunk","choices":[{"index":0,"delta":{...},"finish_reason":null}]}` — no `id`/`created`/`model` fields; final chunk `finish_reason:"stop"|"length"|"tool_calls"`, optional usage chunk, then `[DONE]`. Errors mid-stream arrive as an SSE data object `{"error":..., "code":...}`.
- **Tools + stream = buffered**: `streamToolCall` "Buffers the whole stream, then emits one tool-call chunk (or a content chunk on parse failure)". So token-by-token streaming disappears whenever `tools` is present.
- **Tool parsing**: first balanced `{"name":..., "arguments":...}` JSON object anywhere in output (or Gemma-4 `<|tool_call>` syntax); "Only one tool call per assistant turn is parsed — parallel tool calls in a single response are not supported." `reasoning_format` is ignored on tool requests. `tool_call.id` is `call_<rand>`.
- **VLM**: only images/audio in the LAST message are fed to the vision encoder (`prepareVLM` iterates `messages[len-1].Contents`); each request re-encodes the image. Base64/HTTP images are spilled to temp files.
- **Context overflow** (non-stream): HTTP 400 `{"error":{"code":"context_length_exceeded",...},"choices":[partial text],"usage":...}`. llama_cpp `nctx` is auto-raised to `max_completion_tokens` if larger.
- **`usage`** includes `completion_tokens_details.accepted_prediction_tokens/rejected_prediction_tokens` for speculative decoding. No timing fields (tok/s must be measured client-side).
- CORS: `Access-Control-Allow-Origin: <--origins>` (default `*`), methods `OPTIONS, GET, POST`, headers `Authorization, Content-Type, GenieX-KeepCache`. Fixed in v0.3.17 (issue #1168 "OpenAI-Compatible API doesn't function through websites").
- Auth: none (`middleware/auth.go` is empty); any `api_key` accepted.

## 3. Exact official API examples (from local-server.md)

Start:
```bash
geniex pull ai-hub-models/Qwen3-4B-Instruct-2507
geniex serve
```
curl (README):
```bash
curl http://127.0.0.1:18181/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ai-hub-models/Qwen3-4B-Instruct-2507", "messages": [{"role": "user", "content": "Hello!"}]}'
```
Python OpenAI SDK:
```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18181/v1", api_key="geniex")  # any non-empty string; the server does not check it

stream = client.chat.completions.create(model="unsloth/Qwen3-4B-GGUF:Q4_0",
    messages=[{"role":"user","content":"Hello! Briefly introduce yourself."}], max_tokens=256, temperature=0.7, stream=True)
for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta: print(delta, end="", flush=True)

resp = client.chat.completions.create(model="unsloth/Qwen3-4B-GGUF:Q4_0", messages=[...], max_tokens=128,
    extra_body={"enable_think": False})            # or {"reasoning_format": "deepseek"} -> msg.model_extra["reasoning_content"]
```
VLM (image + audio in one turn):
```json
{"model":"google/gemma-4-E2B-it-qat-q4_0-gguf","messages":[{"role":"user","content":[
  {"type":"text","text":"Describe the image, then transcribe the audio."},
  {"type":"image_url","image_url":{"url":"/full/path/to/landmark.jpg"}},
  {"type":"input_audio","input_audio":{"data":"/full/path/to/jfk.wav"}}]}],"max_tokens":256}
```
`image_url.url` / `input_audio.data` accept: local path (`C:/Users/Username/Pictures/photo.jpg`, optional `file://`), `https://…` (fetched server-side), or `data:image/png;base64,…` / `data:audio/wav;base64,…`.
Tool calling (doc uses `qualcomm/Qwen3-VL-4B-Instruct`, `tools=[{"type":"function","function":{"name":"web_search",...}}]`, `tool_choice="auto"`, `extra_body={"enable_think": False}`; result `finish_reason == "tool_calls"`, then append `first.choices[0].message` and `{"role":"tool","tool_call_id":call.id,"content":json.dumps(result)}`). Doc advice for Qwen3-VL: prime with a system prompt spelling out `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`, and on the follow-up turn drop `tools=` and drop the image.
FIM (`/v1/completions`):
```json
{"model":"unsloth/Qwen2.5-Coder-3B-GGUF:Q4_0","prompt":"<|fim_prefix|>def fibonacci(n):\n    <|fim_suffix|>\n    return a<|fim_middle|>","max_tokens":64,"temperature":0.2,"stop":["<|endoftext|>"],"stream":false}
```
`suffix` unsupported. Known bug #1341 (open): `/v1/completions` fails on QAIRT models when `stop` is sent.
Speculative decoding on the server (per request; https://geniex.aihub.qualcomm.com/en/tutorials/speculative-decoding-mtp.md):
```json
{"model":"google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0","messages":[...],
 "spec_type":"draft-mtp","spec_draft_model":"RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf:Q4_0","spec_n_max":3,
 "nctx":8192,"max_completion_tokens":2048,"temperature":0.8,"top_p":0.95,"stream":false}
```
No official JS/Node example exists; there is no JS SDK. Any OpenAI-compatible JS client (`openai` npm with `baseURL:"http://127.0.0.1:18181/v1", apiKey:"geniex", dangerouslyAllowBrowser:true`, or Vercel AI SDK `createOpenAICompatible`) should work given the CORS defaults; be tolerant of missing `id`/`model` on chunks.

## 4. Known integrations
- Officially named consumers: OpenClaw, LangChain (local-server.md), "any OpenAI client". The Qualcomm OpenClaw/Hermes blog (Apr 2026) does not actually wire GenieX in.
- Community: AnythingLLM (issue #1243 — streaming `finish_reason` fix landed in v0.4.0 via PR #1246). No Open WebUI / Continue.dev / LM Studio / Jan write-ups found. Continue/Cline-style autocomplete is the stated motivation for the new `/v1/completions` FIM endpoint (PR #1317).
- First-party GUIs: Android only (`ai-hub-apps/geniex_chat_android`). Windows = CLI/`geniex run` (a CLI client that talks to the running server).

## 5. Known bugs / limitations relevant to v0.4.0 (GitHub issues)
- #1341 open: QAIRT + `/v1/completions` + `stop` fails.
- #1266 open: "qairt: intermittent fixed ~1.5s latency per graphExecute on X Elite" — decode flips between ~17 tok/s and ~0.64 tok/s across process launches; correlates with `DSP_INFO UNSUPPORTED_KEY: 49/50` logs (#1154 open). Workaround: restart the process. Your UI should surface tok/s so users notice.
- #1330 open: clock-keeper spin thread costs +13% system power for no NPU throughput gain; disable with env `GENIEX_CLOCK_KEEPER_THREADS=0` before model load.
- #1153 open: X Plus 10-core support request; #1183 open: v0.3.14 installer checksum mismatch; #1254 open: bare error 1008 on unknown dsp_arch; #1350 open: llama.cpp bump request; #1241 open: locateanything mmproj.
- Fixed in v0.4.0: streaming `finish_reason` (#1243), reasoning_content routing (#1294), tool-call matching by braces (#1298), keep-alive destroying model mid-generation (#1322), VLM memory leak/MTP HTP churn, VLM tokenize `text_len`, Microsoft-signed HTP catalog (no cert import on Windows), `/v1/models` precision-suffix confusion (#1242/#1084 closed — ids like `unsloth/Qwen3-4B-GGUF:Q4_0` are accepted by chat).
- Fixed earlier: nctx capped at 4096 (#1138 → `--nctx`/body `nctx`), CORS (#1168), GGML_ASSERT(device) signing crash on v0.3.16 (#1217/#1220), dspqueue_read crash on system message (#1186), plugin loading -100301 on X Elite (#1060).
- Design limits: QAIRT bundles are NPU-only with baked precision/context (4096 typ., `--sliding-window` to evict); Q4_0 is the only GGUF quant that lands cleanly on Hexagon (K-quants/Q8_0 fall back to GPU/CPU); audio input is llama.cpp-only (`GenieXError(-201201)` on QAIRT); speculative decoding llama_cpp + text-only; hybrid mode silently falls back to CPU if HTP driver fails (check `GGML_HEX_VERBOSE=1`); server never auto-downloads; Windows installer not code-signed (SmartScreen); installer does not add to PATH.

## 6. Model catalogue as GenieX names it
Namespaces: `ai-hub-models/<Name>` (docs) and `qualcomm/<Name>` (swagger examples, `geniex model list` output) both denote AI Hub QAIRT bundles; HF GGUF = `<org>/<repo>[:PRECISION]` (Q4_0 default); Docker = `docker.io/ai/<name>[:tag]` or `ai/<name> --model-hub docker` (tag replaces precision, default `latest`; only Docker v0.1/v0.2 GGUF artifacts, safetensors/DDUF/ModelPack rejected); local = `local/<name> --local-path <dir|zip>`.

`geniex model list --all` (v0.4.0, this machine; all X Elite-capable, chipset id `qualcomm-snapdragon-x-elite`, w4a16 unless noted): LLM — Falcon3-7B-Instruct, Llama-SEA-LION-v3.5-8B-R, Llama-v3-8B-Instruct, Llama-v3-ELYZA-JP-8B, Llama-v3.1-8B-Instruct, Llama-v3.2-1B-Instruct, Llama-v3.2-3B-Instruct, Llama-v3.2-3B-Instruct-SSD, Llama3-TAIDE-LX-8B-Chat-Alpha1, Phi-3.5-Mini-Instruct (x-elite/x2-elite only), Qwen3-0.6B, Qwen3-1.7B, Qwen3-4B, Qwen3-4B-Instruct-2507, Qwen3-8B; VLM — Gemma-4-E4B-it, Qwen2.5-VL-7B-Instruct, Qwen3-VL-4B-Instruct, Qwen3-VL-8B-Instruct. (HF `qualcomm/` also hosts Qwen3.5-0.8B/2B, Qwen3-VL-2B, Gemma-4-E2B-it, Phi-4-Mini, Granite-4.0-Micro, Ministral-3-3B, InternVL 3.5 support added in v0.4.0 SDK — not yet in the CLI catalogue for X Elite.) HF card assets are named `<model>-geniex_qairt-w4a16-qualcomm_snapdragon_x_elite.zip` (QAIRT 2.45), plus a `GENIEX_LLAMACPP q4_0 Universal` row pointing at unsloth GGUFs.

Docker `ai/` LLM/VLM GGUF repos GenieX can pull (98 total): qwen3, qwen3.5, qwen3.6, qwen3.8, qwen3-vl, qwen3-coder, qwen3-coder-next, qwen3-next, gemma3, gemma3n, gemma3-qat, gemma4, gpt-oss, gpt-oss-safeguard, llama3.1/3.2/3.3, phi4, mistral, mistral-nemo, mistral-small4, ministral3, ministral-3, magistral-small-3.2, devstral-2, devstral-small(-2), granite4/4.1/granite-4.0-*, granite3.3, deepseek-r1-distill-llama, deepseek-v4-pro, glm-4.7-flash, glm-5.2, kimi-k2/k2.6/k3, nemotron-3-*, smollm2/3, smolvlm, moondream2, medgemma, functiongemma, translategemma, laguna-*, seed-oss, qwq, deepcoder-preview, plus embeddings/rerankers (not usable — no embeddings endpoint) and `ai/stable-diffusion` (not runnable: GenieX model types are `llm|vlm` only). `*-vllm` and `*-safetensors` tags are rejected.

## 7. Performance on X Elite (X1E80100) — published numbers
First-party (`notes/run.md`, Qwen3-1.7B Q8_0, llama.cpp): hybrid "~90 tok/s prefill, ~27 tok/s decode, ~200 ms TTFT"; pinned `npu` "~60 tok/s prefill, ~22 tok/s decode, ~350 ms TTFT". Rule: "use `--device hybrid` … for fastest throughput" — but note the CLI/server default is `npu`, so a UI should default `compute:"hybrid"` for GGUF and `npu` for QAIRT.

HF model cards (Qualcomm AI Hub v0.59/0.60, decode tok/s @ 4096 ctx, TTFT range 128→4096-token prompt), Snapdragon X Elite:
- GENIEX_QAIRT w4a16: Qwen3-0.6B 88.8 (0.03–0.93 s); Qwen3-1.7B 40.8 (0.05–1.61); Qwen3-4B 21.2 (0.10–3.13); Qwen3-4B-Instruct-2507 23.1 (0.10–3.15); Qwen3-8B 12.9 (0.16–4.98); Qwen3-VL-4B 20.9 (0.10–3.2); Qwen3-VL-8B 12.5 (0.16–5.0); Qwen2.5-VL-7B 12.5 @2048 ctx; Llama-3.2-1B 43.8; Llama-3.2-3B 19.7; Llama-3.2-3B-SSD 33.7; Llama-3.1-8B 11.0; Llama-3-8B 11.4; Falcon3-7B 11.6; SEA-LION-8B 11.7.
- GENIEX_LLAMACPP q4_0 (three unlabelled compute rows per config; best @512 ctx / best @4096 ctx): Qwen3-0.6B 72.5 / 31.1; Qwen3-1.7B 47.8 / 25.6; Qwen3-4B 22.9 / 10.6; Qwen3-VL-4B 22.1 / 8.5; Qwen2.5-VL-7B 17.1 / 12.2; Gemma-4-E4B-it 20.5 / 11.8. TTFT at full 4096 ctx is 15–49 s on llama.cpp vs ~3 s on QAIRT — QAIRT wins decisively for long prompts.
- For comparison X2 Elite QAIRT roughly doubles (Qwen3-4B-Instruct-2507 43.3 tok/s).
- Third-party (`bpbonker/npurun`, `ara142/llama-cpp-hexagon-npu`): Qwen3-4B ~14.9 tok/s on X1E NPU; SEA-LION 8B ~10 tok/s — consistent with above.
- Blog/README publish no benchmarks. `geniex-bench-windows-arm64-v0.4.0.zip` (80 MB) is on the release page for local benchmarking.

## 8. Image / video generation — honest answer
- **Via GenieX: no.** Model types are `llm|vlm` only; there is no image/audio-generation endpoint and no roadmap statement about diffusion. `ai/stable-diffusion` on Docker Hub cannot be pulled/run by GenieX.
- **Locally on the X Elite NPU outside GenieX: yes for images (SD 1.5 / 2.1 / ControlNet), via ONNX Runtime QNN EP.** Qualcomm ships `ai-hub-apps/stable_diffusion_windows_py` (`pip install qai-hub-apps; qai-hub-apps fetch stable_diffusion_windows_py --model stable_diffusion_v2_1 --chipset qualcomm-snapdragon-x-elite`), requiring native ARM64 Python + `onnxruntime-qnn==2.3.0`, `onnxruntime==1.24.4`, `transformers==4.56.2`; assets `stable_diffusion_v2_1-precompiled_qnn_onnx-w8a16-qualcomm_snapdragon_x_elite.zip` (text_encoder/unet/vae `.onnx` + `_qairt_context.bin`). Published X Elite per-call latencies: text_encoder 7.6 ms, unet 157 ms/step, vae 258 ms → ~3.5–4 s per 512×512 image at 20 steps (TechRadar quotes 7.25 s for SD1.5). HF: https://huggingface.co/qualcomm/Stable-Diffusion-v2.1, https://huggingface.co/qualcomm/Stable-Diffusion-v1.5, https://huggingface.co/qualcomm/ControlNet, https://huggingface.co/qualcomm/ControlNet-Canny. No SDXL/FLUX NPU builds. Building this into the UI means a Python sidecar (ARM64) or ORT-QNN native module — not the GenieX server.
- **Video generation: no NPU-optimized option.** HF `qualcomm/` has no text-to-video; only `First-Order-Motion-Model` (image animation) and image-to-image (Real-ESRGAN, LaMa, DDColor, NAFNet…). Also available on NPU: Whisper (`whisper_windows_py`, `qualcomm/Whisper-*`) for STT, and GenieX itself does audio-in via Gemma-4-E2B mmproj (llama.cpp only) with `/mic` in the CLI (needs SoX).

## 9. Local machine facts confirmed
`geniex version`: CLI v0.4.0, QAIRT v2.45.0.260326, LlamaCPP hash 6ba5ef2; chipset auto-detected "Snapdragon X Elite CRD"; model cache `C:\Users\stama\.cache\geniex\models` (currently empty); `geniex run` = CLI client for the running server (same flags as infer incl. `--spec-type`, `--draft-model`, `--sliding-window`, `--think`).
