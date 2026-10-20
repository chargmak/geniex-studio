# GenieX CLI v0.9.3 — what changed since v0.6.1 and what Studio should do about it

Researched and measured 2026-10-20 on the X1E80100 / 16 GB / NPU driver 30.0.220.3000. Studio v0.3.0 targets
GenieX ≥ 0.6.0 and was last verified against **v0.6.1** (`docs/geniex-v0.6-adoption-plan.md`). The machine now runs
**v0.9.3** (released 2026-10-19; bundled QAIRT **2.50**, llama.cpp `e467e5b`). Releases in between: v0.7.0 (09-18),
v0.7.1 (09-28), v0.8.0 (10-02), v0.9.0 (10-16), v0.9.1 (10-17), v0.9.3 (10-19).

Sources: GitHub release notes and PR bodies (`qualcomm/GenieX`), the server's own Swagger (`/docs/swagger.yaml`),
the docs site (`run/cli/local-server`, `run/cli/reference`, tutorials), `geniex … --help`, and throwaway
`geniex serve` instances on ports 18191/18192 driven by hand.

## 1. On-device results (the part that decides everything else)

| Test | v0.6.1 (2026-09-14) | v0.9.3 (2026-10-20) |
|---|---|---|
| `qualcomm/Qwen3-0.6B` W4A16 (cached, pulled 08-15) | loads 6.5 s, 80 tok/s | **fails to load**: HTTP 500 `{"code":-100201,"error":"SDKError(Model loading failed)"}` after 13.5 s; log `Failed to create context from binary with err 0x3ef` / `Could not create context from binary for context index = 1 : err 1007` |
| `qualcomm/Qwen3-1.7B` W4A16 (**freshly pulled** 10-20, 1.6 GiB) | — | **same failure**. Its `metadata.json` says `tool_versions.qairt = 2.45.0.260326154327`: AI Hub still ships bundles compiled with QAIRT 2.45 |
| QAIRT with `--qairt-lib` = QAIRT 2.45 libs (bench v0.6.1 `lib/qairt/htp-files`) or 2.48.40 (sidecar) | 2.48 worked | fails: `Error from rpc transport res[0]:8003` then the same 1007 |
| `unsloth/Qwen3-0.6B-GGUF:Q4_0`, `compute: npu` | 61 tok/s (bench) | **OK**: 503 tok/s prefill, 68 tok/s decode, `/status` reports `device: HTP0` |
| `google/gemma-4-E2B-it-qat-q4_0-gguf` + image, `compute: npu` | OK, ~7 s/image | **OK**: 12.8 s incl. load, 318 tok/s prefill, 25 tok/s decode. The new "mmproj on its own HTP session" default falls back to HTP0 on the single-HTP X Elite without harm |
| GGUF on npu, prompt longer than `nctx` | serve dies (exit 3) | **still dies** (exit 3), identical signature `ggml-backend.cpp … (HTP0) cannot run the operation (ROPE)` / `fatal: backend aborted (SIGABRT)`. `supervisor.ts OVERFLOW_SIGNATURE` still matches |
| After a failed QAIRT load, next request on the same `serve` | — | hung > 120 s (one observation) |

**Conclusion:** the whole AI Hub (`qualcomm/*`) catalogue is unusable on this machine with v0.9.3, and it is a load
*failure* (HTTP 500), not a process crash, so none of the crash-avoidance machinery in Studio notices. llama.cpp/GGUF
is fully healthy and slightly faster. The overflow guard and the QAIRT thinking / QAIRT→GGUF logic must stay (the
latter cannot be re-verified while QAIRT is down).

Probable causes, in order: (a) the QAIRT 2.50 runtime cannot open context binaries compiled with 2.45 (the
`--qairt-lib` fallback used to work with the v0.6.1 plugin, so the plugin changed too); (b) the NPU driver (Aug 2026)
is too old for 2.50 — the install docs gained a mandatory "Update NPU and GPU drivers" step (Qualcomm Software Center
`Qualcomm_HND`), and v0.9.0 added a Windows driver update guide. No matching upstream issue exists as of 2026-10-20
(searched `Create From Binary`, `0x3ef`, `1007`, `Model loading failed qairt`).

**Next steps (user actions):** 1. install the latest Qualcomm NPU driver and retest with
`geniex infer qualcomm/Qwen3-0.6B --think=false -p hello`; 2. if it still fails, file an upstream issue with the
`--log info` excerpt above (both a 2.45-compiled bundle and the `--qairt-lib 2.45` attempt); 3. meanwhile Studio must
stop recommending `qualcomm/*`.

## 2. New server surface (verified against the v0.9.3 Swagger and live responses)

- **`timings` on every completion** (v0.7.1, #1477): blocking responses and the final `include_usage` chunk carry
  `{prompt_n, prompt_ms, prompt_per_second, predicted_n, predicted_ms, predicted_per_second}`. Studio today derives
  tok/s and TTFT from wall-clock deltas in `client.ts`; the server numbers are exact and add prefill speed.
- **`GET /status`** (v0.9.3, #1560): `{alive, models:[{id, type, runtime, device, state: loading|active|idle,
  loaded_at, last_activity, idle_seconds}]}`. Served outside the request lock, so it answers mid-generation. Empty
  list when nothing is loaded or after keep-alive eviction. Replaces the "model believed resident" bookkeeping
  (`residentModel`/`residentSince` in the supervisor, `residentKey` in the client).
- **`power_mode`** per request and `serve --power-mode` / `GENIEX_POWER_MODE` (v0.7.0, #1447): `low_power_saver,
  power_saver, high_power_saver, low_balanced, balanced, high_performance, sustained_high_performance, burst` (default
  burst). Shared by qairt and llama_cpp; part of the model cache key like `compute`/`spec_*`.
- **`reasoning_format` default is now `deepseek`** (v0.9.0, #1545): reasoning is separated into
  `reasoning_content` unless the client asks for `none`. Studio already sends `auto`; nothing to change, and the
  "QAIRT ignores `enable_think:false`" workaround is unaffected.
- **`POST /v1/decisions`** (v0.9.0, #1526/#1552) and `geniex decide`: OpenAI Decisions shape — `input` (text or
  messages) plus up to 64 ordered `predicate` / `choice` (2–255 values) / `score` (2–10 levels) questions; answers
  come from logits with probabilities and confidence and **zero generated tokens**. llama_cpp only. The docs say VLMs
  can take images/audio; the Swagger still says text only. The request shares `nctx/ngl/compute/power_mode`.
- **`grammar_path` / `grammar_string`** (GBNF) on chat completions for constrained output.
- `max_tokens` is now documented as a deprecated alias of `max_completion_tokens` (Studio sends both, equal — fine).
  Streams end with `data:[DONE]` (the Studio parser handles it).
- `stop` is still `/v1/completions`-only; on QAIRT it is now enforced host-side (#1342), so FIM on QAIRT works.
- Audio: raw base64 `input_audio` is decoded (#1458); still llama.cpp only.
- `serve` flags: `--vit-compute` (vision encoder device, e.g. `CPU`), `--power-mode`, `--https/--certfile/--keyfile`.
  `--qairt-lib` and `--data-dir` are unchanged.

## 3. New CLI / runtime behaviour worth knowing

- Speculative decoding gained `draft-mtp` and `draft-eagle3` plus `--draft-min` / `--draft-p-min`
  (`spec_n_min` / `spec_p_min` on the server). The MTP tutorial pairs Gemma-4-26B-A4B with an MTP draft — far beyond
  16 GB. `ngram-*` self-speculation, which Studio exposes, is unchanged.
- `--compute HTP0,HTP1,…` device lists for multi-DSP parts (X2 Elite); the X Elite has one HTP, so no Studio impact.
- `--sliding-window` (QAIRT only) evicts the oldest context instead of erroring — **CLI only**, no server field.
- mmproj defaults to its own HTP session (`GGML_HEXAGON_DEVICES=2`, #1501/#1548), the vision encoder defaults to
  FP16, the VLM context is rebuilt after a failed generation (#1442), and llama.cpp warms the context at load so HTP
  buffer mapping no longer lands in the first TTFT (#1529). Two KV-prefix-reuse bugs in the llama_cpp plugin were
  closed upstream on 2026-10-16 (#1550, #1554).
- QAIRT: HTP multicore from the bundle config (#1313), default system prompt read from `metadata.json` (#1443),
  tool calls for QAIRT VLMs (#1525). All moot on this machine until §1 is resolved.
- New tool-call parser: MiniCPM5 XML. New hubs/commands: Docker Hub `:tag` pulls (Studio has it), `remove -y` for
  several models at once, `geniex decide`.
- Microsoft-signed HTP catalogue since v0.7.0: no certificate import on Windows on Snapdragon.

## 4. Plan for Studio

### Phase 0 — unblock QAIRT (no code; user)
Update the NPU driver, retest; file the upstream issue if it persists. Record the result in `docs/research/`.

### Phase 1 — compatibility and safety (do now)
1. **Load-failure handling for `qualcomm/*`.** Map HTTP 500 `code:-100201` on a warm-up/first request to a clear
   message ("this AI Hub bundle was compiled for QAIRT 2.45 and GenieX 0.9.x ships 2.50 — update the NPU driver /
   wait for a GenieX fix / use a GGUF Q4_0 model"), record it like a crash (stamped with the CLI version, pruned on
   CLI change) so `pickAutoModel` and the picker avoid the model, and restart `serve` after such a failure (the
   process was observed to hang afterwards). Never retry the load in a loop.
2. **Hide/annotate the QAIRT catalogue** while the recorded failure stands: the AI Hub tab on the Models page and the
   recommended list must not steer a new user into models that cannot load.
3. **Adopt `/status`** (probe once; 404 → fall back to the current bookkeeping): resident model, device, state and
   idle time on the System page and ContextMeter; clear `residentKey` when the server reports eviction so the next
   turn is announced as a reload instead of surprising the user.
4. **Adopt `timings`**: decode tok/s and new prefill tok/s from the server; keep the wall-clock TTFT (the server has
   none) and keep the wall-clock tok/s only as a fallback for CLIs older than 0.7.1.
5. Keep `MIN_GENIEX_VERSION` at 0.6.0; gate the new fields on version/probe rather than bumping the floor (the 0.6
   protocol still works on 0.9.3 end to end, as the chat tests above show).
6. README: replace the QAIRT rows of the "v0.6 behaviours" table with the §1 state and add `/status` / `timings`.

### Phase 2 — features (pick in order)
| Pri | Feature | Notes |
|---|---|---|
| A | **Power mode** | Settings → GenieX server default (`--power-mode`) and a per-conversation override in the composer *Speed* menu (burst / balanced / power_saver for battery). Add to `optionsKey` and `GenieRequestOptions`. |
| B | **Decisions** | `/v1/decisions` as a Studio capability: an agent-side "classify / route / score" step (e.g. risk-score a tool call, route a request to chat vs vision vs agent) and a small playground tab. llama_cpp only; zero tokens, so cheap on the NPU. |
| C | **Grammar-constrained output** | `grammar_string` for tool-argument JSON in the agent loop and a "JSON only" toggle in chat. Test whether it coexists with tool-call parsing first. |
| D | Draft-model speculation UI (`draft-mtp`/`draft-eagle3`, draft picker) | Parked: needs a model pair that fits in 16 GB. |
| E | `--vit-compute CPU` advanced setting | Only useful if a VLM aborts on the NPU; it did not here. |
| F | Audio-in re-test | Server-side audio fixes landed; quality was the blocker, so re-measure before building UI. |
| G | Multi-select delete via `remove -y` | Minor. |

Out of scope for the Electron app: HTTPS serving, multi-HTP device lists, `--sliding-window` (CLI only), and the
Docker / Linux / Android / Python surfaces.

## 5. Implementation status

**Phase 1 landed 2026-10-20** (`npm run typecheck && npm test` green; `MIN_GENIEX_VERSION` stays 0.6.0, new fields
are probed, never required):

1. **Load-failure handling** — `src/main/geniex/protocol.ts` recognises HTTP 500 `-100201 SDKError(Model loading
   failed)` (also as an SSE error frame) and words the explanation (QAIRT 2.45 bundle vs the 2.50 runtime; update
   the NPU driver / wait for a fix / use GGUF Q4_0). `GenieXClient.rejectResponse` applies it on warm-up, chat and
   completions: the model is recorded in `runtime-crashes.json` with `kind: 'load_failure'` (CLI-stamped, pruned on
   CLI change), `lastCrash.kind = 'load_failure'`, `geniex serve` is restarted when Studio owns it, and nothing
   retries the load. `pickAutoModel` treats one QAIRT load failure as catalogue-wide: every `qualcomm/*` candidate is
   sidelined (after healthy GGUF, before models that actually crashed), including a saved preference.
2. **Models page** — the AI Hub tab carries a warning icon and a banner naming the failed bundle(s), each row says
   "won't load" / "not loading on this GenieX", the Pull button becomes "Pull anyway", the Installed tab and the
   picker mark affected models ("won't load" / "QAIRT not loading"), and the recommended list no longer points at
   the AI Hub tab while the failure stands. The System page explains the cause and keeps the "clear after driver
   update" flow.
3. **`GET /status`** — probed once per server start (`supervisor.refreshServerStatus`; 404 → `server.supported =
   false` and the old bookkeeping), re-read on the health poll and before a turn that would skip the warm-up.
   `GenieServerStatus.server` carries `{supported, checkedAt, models[]}`; the System page shows device / state /
   idle / loaded-ago, the ContextMeter shows "resident on HTP0 · idle …" or "not loaded — the next message reloads
   it". An empty list after a known resident model emits `'evicted'`, which clears the client's `residentKey`.
4. **`timings`** — parsed from blocking responses and the final `include_usage` chunk; `done` events and
   `MessageMetrics` gain `prefillTokensPerSecond` and `timingsSource`; decode tok/s is the server's
   `predicted_per_second` when present, wall-clock otherwise; TTFT stays wall-clock. Shown as "prefill N tok/s" next
   to decode tok/s under each reply and in the status strip.
5. README table and runtime findings updated to the §1 state; unit tests in `protocol.test.ts`, `crashLog.test.ts`,
   `select.test.ts` and `client.test.ts` cover the error mapping, `/status` and `timings` parsing, the
   catalogue-wide sideline, and the client's refused-load / stalled-load / user-cancel paths.

Verified live against the installed v0.9.3 on 2026-10-20 (throwaway `serve` on 18194/18195):
- `/status` timestamps are ISO strings with 7 fractional digits and a zone offset; while a model loads the entry
  has `device: "NPU"`, `state: "loading"` and **no** `loaded_at`/`last_activity`.
- `timings` on the final `include_usage` chunk matches the blocking shape. A request fully served from the KV
  cache (identical prompt repeated) streams `usage` and `timings` as **all zeros**; `parseTimings` treats zero
  counts/rates as "not measured" so wall-clock speed is used.
- The QAIRT failure is not always a 13 s 500: this run `qualcomm/Qwen3-0.6B` sat in `state: loading` for ~3 min
  (`openSessionForPriority failed … status=0x200`, `DspTransport call failed 0x7`, `err 1007`) and every other
  request hung. Studio now puts a **180 s deadline on the warm-up** (`WARMUP_TIMEOUT_MS`): on expiry it restarts
  the server; for `qualcomm/*` it is recorded like the 500 (code `timeout`), for GGUF nothing is recorded.

Also landed beyond the original list: the telemetry table stores `prefill_tokens_per_second` (migration 3) and the
System page shows it per model and on the last-speed tile.

Not done (Phase 0/2): the driver update and upstream issue (user actions), power mode, decisions, grammar.
