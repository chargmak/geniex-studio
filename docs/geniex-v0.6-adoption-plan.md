# GenieX CLI v0.5 → v0.6.1: what changed and how Studio adopts it

Researched 2026-09-14; Phase 0 measurements added the same day (§3, §4 supersede §2 where they differ). Studio was built against **v0.4.0** (2026-08-13). This machine already runs **v0.6.1**
(2026-09-03), but the bundled QAIRT runtime is still **2.45** and the llama.cpp hash is `0eadefe`.

Sources: GitHub releases v0.5.0 / v0.6.0 / v0.6.1, PRs listed inline, docs at geniex.aihub.qualcomm.com (CLI reference,
local server, audio input, MTP, benchmarking, troubleshooting), the v0.6.1 server source (`cli/server/**`), and
`geniex --help` on this machine.

---

## 1. What's new

### Server / OpenAI API (these change Studio's behaviour)

| # | Change | PR | Studio impact |
|---|--------|----|---------------|
| S1 | **Tool calls stream as they are generated.** Several calls per turn, and `content` is returned *together with* `tool_calls`. `reasoning_format` now applies to tool requests too. | #1405 | Agent turns no longer arrive as one buffered chunk. The loop already accumulates calls by `index`. |
| S2 | **`role: tool` messages are passed through structurally.** Previously they were flattened, so templates such as Gemma 4, Mistral and GPT-OSS never saw tool results. | #1407 | Agent quality on those model families should jump. Studio already sends `tool_calls` and `tool_call_id`. |
| S3 | New tool-call parsers: **Gemma 4, Qwen3.5 / Qwen3-Coder, GPT-OSS, LFM2** (plus the existing Qwen3/JSON parsers). | #1345, #1417 | Many more models can now act as agents. |
| S4 | **`GenieX-KeepCache` header removed.** The server hashes the message list and resets the KV cache only when a request isn't a continuation (the same earlier turns plus new ones). | #1422 | Studio's header and setting do nothing now. Trimming old history breaks the continuation, so every turn gets a full re-prefill. |
| S5 | Prompt that can't fit → **400 `code: context_length_exceeded`**. A context window filling up mid-generation now returns **200 `finish_reason: length`**. | #1349 | New error and truncation paths to surface in the UI. |
| S6 | `max_tokens` honoured again (Studio also sends `max_completion_tokens`). | #1377 | Remove the workaround comment; sending both stays harmless. |
| S7 | Speculative-decoding stats in `usage.completion_tokens_details.accepted/rejected_prediction_tokens`. | #1336 | `client.ts` already parses them, but nothing stores or shows them. |
| S8 | `GET /v1/models/{model}` added. `/v1/models` lists `name:precision` ids, e.g. `qualcomm/Qwen3-0.6B:W4A16`. | #1396 | Check that the id matching in the picker, `select.ts` and `requestIds` accepts both forms. |
| S9 | The server now builds image/audio parts for **every** message, not only the last one (`buildVLMMessages`). | #1422 area | We may be able to lift the "last-message media only" rule in `prompt.ts`. Not yet known whether the SDK encodes them all; test first. |
| S10 | `serve` shuts down gracefully on SIGINT/SIGTERM and frees HTP memory. | #1385 | Studio hard-kills the process tree, so none of that cleanup runs. |

### Runtime

| # | Change | PR | Studio impact |
|---|--------|----|---------------|
| R1 | **Bundled QAIRT plus `--qairt-lib` / `GENIEX_QAIRT_LIB` override.** Verified on X Elite with QAIRT 2.45, 2.48 and 2.49. | #1389, #1427 | **Possible fix for our QAIRT crash (#1154, still open).** The sidecar already ships QAIRT **2.48.40** libraries (`…\sidecar\.venv\Lib\site-packages\qai_appbuilder\libs`). |
| R2 | Speculative types `draft-mtp`, `draft-eagle3`, `draft-simple`, `ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod`, `ngram-cache` (llama.cpp, text only). | #1348, #1376 | The `ngram-*` types need **no draft model**. MTP on Gemma-4-26B needs about 20 GB, which this 16 GB machine doesn't have. |
| R3 | GGUF VLM vision encoder (mtmd) pinned to the HTP for `npu` and `hybrid`. Media encode time is now measured separately. | #1420, #1354 | Faster image turns on GGUF VLMs. Worth re-benchmarking. |
| R4 | `--compute` accepts device lists such as `HTP0,HTP1` (llama.cpp only). | #1361 | Of little use here: X Elite has one HTP. |
| R5 | Microsoft-signed HTP catalog (no certificate import). llama.cpp bumped. Thread and `swa_full` defaults changed. | release notes | Re-measure speed and hybrid stability. |

### CLI / models / tooling

- **ModelScope hub** (`--model-hub modelscope`), disk-space preflight on `pull`, more robust chunked downloads (#1418, #1416, #1388).
- `geniex list --format json` now has a documented **stable schema**: `name, size, runtime, type, precisions`. Confirmed on this machine.
- Global `--data-dir` / `GENIEX_DATADIR` lets models live on another drive. There is also a new `geniex model set-type`.
- **`geniex-bench`**: a standalone benchmark (official Qualcomm S3 zip). It reports TTFT, prefill and decode as median/min/max/stdev in JSON.
- **Audio input** documented: GGUF VLMs with a conformer encoder (e.g. `google/gemma-4-E2B-it-qat-q4_0-gguf`). Accepts WAV, MP3 and FLAC; llama.cpp only.
- New model families: Gemma 4 (E2B / E4B / 26B-A4B), Qwen3.5, SmolVLM / SmolVLM2, LFM2, GPT-OSS-20B.

### Not changed

- **#1154** (QAIRT `DSP_INFO UNSUPPORTED_KEY 49/50` → crash) and **#1266** (the ~1.5 s/step degraded QAIRT state) are both still open.
- Still one resident model, still no pull/remove/unload HTTP endpoints, and there is no request field for QAIRT `--sliding-window`.

---

## 2. Plan

### Phase 0: verify on this machine (no code, ~half a day)

These results decide how far Phases 1–3 go. Record them in `docs/research/` and in memory.

1. **QAIRT crash re-test** with `qualcomm/Qwen3-0.6B` and `qualcomm/Gemma-4-E4B-it` (both cached):
   a) bundled 2.45; b) `--qairt-lib "%APPDATA%\GenieX Studio\sidecar\.venv\Lib\site-packages\qai_appbuilder\libs"` (2.48.40).
   A flat folder of QNN libraries is an accepted layout. Run it with the sidecar stopped so the two don't compete for the NPU.
2. **Streaming tool calls** on `unsloth/Qwen3-4B-GGUF:Q4_0`: does TTFT drop below total time, and do several calls arrive in one turn?
3. **KV reuse**: send three continuation turns and compare `prompt_tokens`/TTFT. Then drop the oldest turn and confirm it triggers a full re-prefill.
4. **Multi-image history** on a GGUF VLM: attach an image in turn 1 and ask about it in turn 3.
5. **Compute**: re-measure `npu` against `hybrid` on 4B (hybrid crashed on v0.4.0).
6. **Audio**: pull `google/gemma-4-E2B-it-qat-q4_0-gguf` (~4 GiB) and transcribe `jfk.wav` through `/v1/chat/completions`.

### Phase 1: compatibility (must-do, ~1 day)

1. **Capability detection.** Parse `cliVersion` in `supervisor.ts` into `capabilities`
   (`streamingTools, toolMessages, autoKvReuse, promptTooLong400, qairtLib, modelscope, multiMediaHistory`). Expose them in
   `GenieServerStatus` (`shared/api.ts`). Show an "Update GenieX CLI (≥ v0.6.0)" banner on older versions.
   *Recommendation:* require ≥ 0.6.0 instead of keeping two code paths. Keep only the cheap inline-tool-call fallback.
2. **Remove `GenieX-KeepCache`.** Take out the header in `client.ts`, `defaults.keepCache` in `shared/settings.ts` and
   `routes/settings.ts`, and the Settings toggle in `SettingsPage.tsx`. Add a settings migration that drops the key.
3. **Prefix-stable history trimming** (`chat/prompt.ts`). Once the context is full, drop a block of old turns at a time
   (e.g. down to 60 % of the budget) so the following turns remain continuations and reuse the KV cache, instead of
   dropping one turn per request and re-prefilling every time. Add unit tests.
4. **Error mapping.** In `client.ts` and `chat/turns.ts`, map 400 `context_length_exceeded` to "Prompt doesn't fit the
   context window" with a one-click retry on a tighter budget. Map `finish_reason: length` to a "Truncated: context full"
   badge on the message.
5. **Model-id forms.** Make the `requestIds` matching in `cli.ts`, `select.ts` and `ModelPicker` accept both `name` and `name:precision`
   (QAIRT currently uses the bare name, while `/v1/models` returns `:W4A16`).
6. **ModelScope.** Add `'modelscope'` to `ModelHub` (`shared/config.ts`) and to the pull route schema and the Models page.
   Surface disk-space preflight failures as a clear error.
7. Housekeeping: update the stale v0.4.0 comments in `client.ts`, `models.ts` and `config.ts`. Add a v0.6.1 `parseVersion`
   test case (QAIRT is printed as `2.45`, not `v2.45.0.x`).

### Phase 2: agent upgrades (high value, ~1–2 days)

1. **Several tool calls per turn.** When `capabilities.streamingTools` is set, remove "call ONE tool at a time" from `agentInstructions`.
   The loop in `agent/loop.ts` already iterates over calls. Add a batched-approval UX ("approve all 3").
2. **Live tool turns.** Stream prose deltas during tool turns and render each tool-call card as soon as it completes.
   Update the TTFT/tok-s metrics, which assumed buffering.
3. **Reasoning in agent mode.** Thinking now comes back in `reasoning_content` for tool requests, so show it collapsed
   like in chat.
4. **Recommended agent models.** Add Gemma-4-E4B-it QAT Q4_0 GGUF, a Qwen3.5 GGUF and LFM2 to the curated list and
   the auto-pick in `select.ts`, gated on the Phase 0 results. Keep Qwen3-4B Q4_0 as the known-good default.
5. Regression-test the agent loop against the Phase 0 findings (tool results visible, several calls per turn).

### Phase 3: new features (pick in order)

| Pri | Feature | Notes / files |
|-----|---------|---------------|
| **A** | **QAIRT runtime selector** (only if Phase 0 test 1b passes) | Settings → Runtime: *Bundled (2.45)* / *Sidecar AppBuilder (2.48.40)* / *Custom folder* → `--qairt-lib` in `supervisor.ts doStart()`. Show the active version. After a QAIRT crash, offer "Try QAIRT 2.48" and clear `runtime-crashes.json` when the runtime changes. Might unlock the whole AI Hub NPU catalogue. |
| **B** | **Speculative decoding UI** | Per-conversation spec options in the composer. Start with `ngram-cache` / `ngram-simple` (no draft; good for code and edits), then `draft-simple` with a same-tokenizer pair (Qwen3-0.6B → Qwen3-4B, verify first). Show the acceptance rate from S7 and store it in telemetry. Changing spec settings reloads the model; warn the user. `client.ts` already sends the `spec_*` fields. |
| **C** | **Native audio chat** | Attach or record audio for audio-capable GGUF VLMs (`prompt.ts` already emits `input_audio`). Tag audio-capable models from a curated list, since `list --format json` doesn't expose it. Keep Whisper in the sidecar as the fallback for QAIRT models and LLMs. |
| **D** | **Multi-image history** (if Phase 0 test 4 passes) | Behind `capabilities.multiMediaHistory`, stop stripping earlier media in `prompt.ts` and budget ~512 tokens per image. |
| **E** | **geniex-bench on the System page** | Optional download of the official zip (ask the user first). Run with `--output-json` and chart median ± stdev for TTFT, prefill and decode across npu/hybrid/gpu/cpu. This replaces the single-sample `/benchmark` route in `routes/system.ts`. |
| **F** | **Catalogue refresh** | Curated Add tab: Gemma 4 E2B/E4B QAT, Qwen3.5-2B/4B, SmolVLM2-2.2B, LFM2. Add a ModelScope source and use `GET /v1/models/{model}` for details. |
| **G** | **Models data directory** | Setting → `--data-dir` for every CLI call and for `serve`. `genieXModelsDir()` in `paths.ts` must follow it. Useful on a 16 GB / small-SSD machine. |
| **H** | **Graceful serve stop** (investigate) | Try a polite shutdown (console Ctrl-Break via a helper, or `keepalive` expiry) before `killTree`, so the S10 cleanup runs. Low priority on Windows, where process exit frees memory anyway. |

### Deliberately skipped

- Multi-HTP device lists: X Elite has a single HTP.
- MTP with Gemma-4-26B-A4B: needs ~20 GB RAM and disk.
- Docker, Linux, Android and Python SDK surfaces: out of scope for the Electron app.

---

## 3. Phase 0 results (2026-09-14)

Full table with numbers: `docs/research/phase0-v061/README.md`. Decision taken: **require GenieX ≥ v0.6.0**, no dual code paths.

What changed the plan:

1. **AI Hub QAIRT bundles work on v0.6.1** (same NPU driver as before): #1154 is fixed by GenieX itself. The crash-avoidance machinery must stop blacklisting them, and the QAIRT catalogue becomes usable. The `--qairt-lib` selector no longer fixes anything (it works; keep it as an optional advanced setting).
2. **GGUF on the NPU crashes the server on any context overflow** (prompt too long, or generation reaching `nctx`). No 400, no `finish_reason:"length"`: the process dies. Studio must make overflow impossible client-side.
3. **QAIRT → GGUF switching inside one `serve` process fails** (`HTP0 failed to open session`). Studio owns the process, so it must restart `serve` when the runtime family changes from QAIRT to llama.cpp.
4. **Images on earlier messages are used and cheap** (continuation holds), so multi-image conversations are a win. Image encoding costs ~7 s per image on every compute unit.
5. **Audio input works but Gemma-4-E2B's transcription is poor**: keep Whisper in the sidecar; "ask a question about this clip" is a nice-to-have at best.
6. `enable_think:false` is ignored by QAIRT Qwen3 models; the only way to keep thinking out of the answer is `enable_think:true` + `reasoning_format:"auto"` and hiding `reasoning_content`.
7. QAIRT overflow errors come as HTTP 400 `code:"context_length_exceeded"` (non-streaming) or an SSE `data:{"code":-200103,...}` frame (streaming).

## 4. Revised plan

### Phase 1: compatibility + safety (must-do)

1. **Version gate.** Parse `cliVersion`; below 0.6.0 show an "Update GenieX CLI" banner and disable chat. Remove the v0.4.0 workaround comments.
2. **Overflow guard for GGUF on npu/hybrid** (`chat/prompt.ts`, `client.ts`, `turns.ts`, `agent/loop.ts`):
   - Track the server-reported context usage per conversation: `usedTokens = Σ prompt_tokens (new tokens) + completion_tokens` since the last reset; reset when history is trimmed or the model reloads.
   - Before each request: `estimate(new content) + usedTokens + max_tokens ≤ nctx − margin`, with the char-based estimate padded ×1.3 for safety; clamp `max_tokens` to what remains; if even that fails, trim history (block trim, item 4) and continue.
   - Treat the `ggml-backend.cpp … (ROPE)` / `fatal: backend aborted` log signature as a *context overflow*, not a model crash: no entry in `runtime-crashes.json`, a clear error message, auto-restart, and a suggestion to raise `nctx`. Report the bug upstream.
3. **Runtime-switch restart.** In `GenieXClient`/supervisor: if a QAIRT model has been resident in this `serve` process and the next request is llama.cpp, restart `serve` first (a few seconds) and tell the UI ("Restarting runtime for GGUF model…").
4. **Continuation-friendly trimming.** When the context is full, drop a block of the oldest turns down to ~60 % of the budget so later turns stay continuations. Reset the `usedTokens` counter on trim.
5. **Un-blacklist QAIRT.** Record the CLI version in `runtime-crashes.json`; ignore/clear entries recorded under < 0.6.0. Remove the "#1154" copy from `ModelsPage`, `SystemPage`, `ModelPicker`, `select.ts`, `client.ts` (keep the generic crash-avoidance logic; it is still right for real crashes).
6. **QAIRT thinking.** For QAIRT models always send `enable_think:true` + `reasoning_format:"auto"`; when the user turned thinking off, hide `reasoning_content` instead. Show a hint in the picker.
7. **Error mapping.** 400 `context_length_exceeded` and SSE code −200103 → "Prompt doesn't fit the model's context" with retry-after-trim; `finish_reason:"length"` → truncated badge.
8. Remove the `GenieX-KeepCache` header, `defaults.keepCache`, the Settings toggle (+ migration). Accept both model-id forms (`name` and `name:precision`). Add ModelScope to `ModelHub`.

### Phase 2: agent (unchanged, now verified)

Several tool calls per turn with batched approval; live tool-turn streaming; reasoning shown in agent mode; Gemma-4 / Qwen3.5 / LFM2 in the recommended list. QAIRT models can be agents too (Qwen3-0.6B W4A16 produced correct tool calls at 80 tok/s).

### Phase 3: features, re-prioritised

| Pri | Feature | Status after Phase 0 |
|-----|---------|----------------------|
| **A** | **Multi-image conversations**: stop stripping earlier media in `prompt.ts` for GGUF VLMs; budget ~150 prompt tokens + ~7 s per image; show "encoding image…" progress; keep the strip for QAIRT VLMs until tested. | Verified working. |
| **B** | **QAIRT catalogue front and centre**: the NPU-native models are the point of the app; refresh the curated list (Qwen3, Gemma-4-E4B once RAM allows, others from `geniex model list`). | Unblocked. |
| **C** | **Speculative decoding**: `ngram-*` types first (no draft model), acceptance rate from `usage`. | Untested; cheap to try. |
| **D** | **geniex-bench** on the System page. | Unchanged. |
| **E** | Models data directory (`--data-dir`). | Unchanged. |
| **F** | Runtime selector (`--qairt-lib`) as an advanced setting. | Works; low value now. |
| **G** | Audio-in for GGUF audio VLMs. | Works technically; poor quality; parked. |
| **H** | Graceful serve stop. | Low. |

---

## 5. Implementation status (2026-09-14)

Everything below was verified end-to-end against the headless Studio server driving a managed `geniex serve` v0.6.1
(`docs/research/phase0-v061/` holds the Phase 0 script; the smoke test was `scratchpad/e2e.mjs`).

**Phase 1 — done.** Version gate (`MIN_GENIEX_VERSION` = 0.6.0, banner + 428 on turns); overflow guard
(`chat/context.ts`: calibrated token factor, `clampMaxTokens`, refusal at 413 when a single message cannot fit;
supervisor classifies the ROPE/context-shift abort as `context_overflow` and never blacklists the model); automatic
`serve` restart on QAIRT → GGUF (`GenieXClient.prepareRuntime`, `runtime-restart` stream event); block trimming to
60 % of the budget; crash records stamped with the CLI version and pruned on a CLI change; QAIRT thinking forced on
with hidden `reasoning_content` (falls back to the thoughts when the model stops without an answer); `GenieX-KeepCache`
removed (settings migration); `findInstalled` accepts `name` / `name:PREC` / server ids; ModelScope hub;
`--data-dir` and `--qairt-lib` settings.

**Phase 2 — done.** Several tool calls per turn: all calls of a turn are announced and their approvals raised at once,
with an *Allow all / Deny all* bar; calls run in emitted order. Agent instructions no longer say "one tool at a time".
Reasoning streams in agent mode as in chat. Recommended list now carries Gemma-4-E2B/E4B QAT and Qwen3.5-2B.

**Phase 3.** A multi-image history (llama.cpp VLMs keep media on every message; "Encoding N attachments…" note) — done.
B QAIRT catalogue copy refreshed — done. C speculative decoding: composer *Speed* menu (`ngram-cache` recommended,
measured 36/55 accepted and 10.0 s → 7.3 s on repetitive text), `/spec` command, `spec NN%` badge — done.
D geniex-bench: on-demand download (~85 MB, user-initiated), `POST /api/system/bench/run`, medians ± stdev table;
measured Qwen3-0.6B W4A16 at 81.6 tok/s decode / 30 ms TTFT and the GGUF Q4_0 at 61 tok/s — done.
E models directory and F QAIRT runtime override — done (Settings → GenieX server). G audio-in and H graceful stop — parked.

Upstream reports still worth filing at qualcomm/GenieX: (1) llama.cpp on the Hexagon backend aborts on context shift
(`ggml-backend.cpp:941 … cannot run the operation (ROPE)`), (2) `HTP0 failed to open session : error 0x80000406`
for any llama.cpp load after a QAIRT bundle in the same `serve` process, (3) `enable_think:false` ignored by QAIRT Qwen3.
