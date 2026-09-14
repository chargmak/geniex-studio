# [serve] After a QAIRT bundle has been loaded, every llama_cpp load fails: `ggml-hex: HTP0 failed to open session : error 0x80000406`

**Component:** `geniex serve`, model switching between the qairt and llama_cpp plugins
**Version:** GenieX CLI v0.6.1 (QAIRT 2.45, llama.cpp `0eadefe`), Windows 11 ARM64, Snapdragon X Elite X1E80100, NPU driver 30.0.220.3000
**Models:** `qualcomm/Qwen3-0.6B:W4A16` (QAIRT), `unsloth/Qwen3-0.6B-GGUF:Q4_0` / `unsloth/Qwen3-4B-GGUF:Q4_0` (llama_cpp)

## Summary

In one `geniex serve` process, once a QAIRT bundle has been loaded, no llama_cpp model can be loaded any more — the Hexagon session cannot be (re)opened. This happens even with `compute: "cpu"` for the GGUF request, so it is not just "the NPU is busy". The only recovery is restarting `geniex serve`. The opposite order (GGUF first, then QAIRT) works, and QAIRT → QAIRT works.

The `keepAlive` service destroys the previous model before loading the next one (`cli/server/service/keepalive.go`), so I assume the qairt plugin's HTP session outlives the model and the llama_cpp plugin's `ggml-hex` cannot acquire it. `geniex-bench` shows the plugins *can* hand the HTP over ("Releasing HTP sessions for foreign-plugin handoff"), so the serve path seems to skip that step.

## Reproduction

```powershell
geniex serve --log info
```

Send these chat completions in order (`max_tokens: 4`, `messages: [{role:"user", content:"Reply OK."}]`):

| # | model | compute | result |
|---|-------|---------|--------|
| 1 | `unsloth/Qwen3-0.6B-GGUF:Q4_0` | npu | 200 (2.1 s) |
| 2 | `qualcomm/Qwen3-0.6B:W4A16` | — | 200 (6.4 s) |
| 3 | `unsloth/Qwen3-0.6B-GGUF:Q4_0` | npu | **500 `{"code":-100201,"error":"SDKError(Model loading failed)"}`** |
| 4 | `unsloth/Qwen3-0.6B-GGUF:Q4_0` | cpu | **500, same error** |
| 5 | `qualcomm/Qwen3-0.6B:W4A16` | — | 200 |

Restart `geniex serve` → step 3 succeeds again. Reproduced 3/3 (also with `unsloth/Qwen3-4B-GGUF:Q4_0` and `google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0` as the GGUF model).

## Log (`--log info`, step 3)

```
ChatCompletions param="{... Model:unsloth/Qwen3-0.6B-GGUF:Q4_0 ...}"
ggml-hex: HTP0 failed to open session : error 0x80000406
ggml-hex: failed to reacquire session 0
[plugins/llama_cpp/src/params.cpp:233:resolve_devices] Found device: HTP0
[plugins/llama_cpp/src/params.cpp:241:resolve_devices] Using 1 device(s): HTP0
load: control-looking token: 128247 '</s>' was not control-type; this is probably a bug in the model. its type will be overridden
ggml-hex: HTP0 failed to open session : error 0x80000406
llama_model_load: error loading model: ggml-hex: failed to open session (see log for details)
llama_model_load_from_file_impl: failed to load model
```

Step 4 (`compute: cpu`) ends with `llama_init_from_model: failed to initialize the context: ggml-hex: failed to open session (see log for details)` — the hex backend is still initialised for a CPU request.

## Expected

Loading a GGUF model after a QAIRT bundle works in the same server process, as it does in the other order — or, failing that, the qairt plugin releases the HTP session when its model is destroyed so `ggml-hex` can open it.

## Workaround

Restart `geniex serve` before the first llama_cpp request that follows a QAIRT load (our client does this automatically now).

## Related

Not #1390: there the Hexagon session fails to open from the very first request on a specific HND driver. Here the session opens fine in a fresh process (step 1, and again after a restart) and only stops working once the qairt plugin has been used in the same process.
