# [serve/llama_cpp] Context overflow on the Hexagon backend aborts the whole server (`cannot run the operation (ROPE)`)

**Component:** `geniex serve`, llama_cpp plugin, `--compute npu` (also `hybrid`)
**Version:** GenieX CLI v0.6.1 (QAIRT 2.45, llama.cpp `0eadefe`), Windows 11 ARM64, Snapdragon X Elite X1E80100, NPU driver 30.0.220.3000, 16 GB RAM
**Model:** `unsloth/Qwen3-4B-GGUF:Q4_0` (any Q4_0 GGUF on `npu`)

## Summary

When a llama_cpp model runs on the NPU and the context fills up — either because the prompt is longer than `nctx`, or because generation reaches `nctx` — llama.cpp attempts its usual *context shift*, the ROPE it needs cannot execute on the HTP buffer, and `ggml-backend` aborts. The `geniex serve` process exits with code 3 and every client is disconnected. On `--compute cpu` the same requests succeed (silent context shift), so this is specific to the Hexagon backend.

Neither documented overflow behaviour applies: there is no 400 `context_length_exceeded` (#1349) and no `finish_reason: "length"` — just a dead server. A client cannot avoid it without counting tokens itself.

## Reproduction

```powershell
geniex serve --log info      # default --nctx 4096
```

**A. Prompt longer than the window (fails during prefill):**

```powershell
$filler = ('The quick brown fox jumps over the lazy dog. ' * 700)   # ≈7 000 tokens
$body = @{ model='unsloth/Qwen3-4B-GGUF:Q4_0'; compute='npu'; nctx=4096; max_tokens=32; enable_think=$false
           messages=@(@{ role='user'; content="$filler`nSummarise the above in one word." }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:18181/v1/chat/completions -Method Post -ContentType application/json -Body $body
```

**B. Generation reaching the window (fails mid-decode):** a ≈3 000-token prompt with `max_tokens: 2048` and "write a very long story" — the abort happens at the 4096th position.

Both abort every time (5/5). Same request with `compute: "cpu"` returns 200 (llama.cpp shifts the context and keeps going).

## Log (`--log info`)

```
decode: failed to find a memory slot for batch of size 2048
[plugins/llama_cpp/src/llm.cpp:336:operator()] Context shifting - discarding 2049 tokens, n_keep: 4, this->n_past before: 4096, this->n_past after: 2047
C:/a/GenieX/GenieX/third-party/llama.cpp/ggml/src/ggml-backend.cpp:941: pre-allocated tensor (cache_k_l0 (view) (view)) in a buffer (HTP0) that cannot run the operation (ROPE)
fatal: backend aborted (SIGABRT)
goroutine 91 [running, locked to thread]:
github.com/qualcomm/GenieX/bindings/go.go_dump_current()
	bindings/go/ml.go:222 +0x40
github.com/qualcomm/GenieX/bindings/go._Cfunc_geniex_llm_generate(...)
	_cgo_gotypes.go:779 +0x30
github.com/qualcomm/GenieX/bindings/go.(*LLM).Generate(...)
	bindings/go/llm.go:493 +0x268
github.com/qualcomm/GenieX/cli/server/handler.prepareLLM.func1(...)
	cli/server/handler/chat.go:179 +0xb4
```

Case B is identical except `failed to find a memory slot for batch of size 1` / `discarding 2044 tokens … n_past after: 2052`.

## Expected

Any of these would be fine, in order of preference:

1. The shift runs (ROPE on the KV cache implemented or delegated to the CPU for the HTP backend), matching `--compute cpu`.
2. The overflow is reported instead of attempted: 400 `context_length_exceeded` for a prompt that does not fit, `finish_reason: "length"` when generation reaches `nctx` — i.e. the behaviour #1349 documents for QAIRT.
3. At minimum, the abort is caught so the process survives and the request fails.

## Notes

- With `nctx` fixed on the NPU, overflow is easy to hit in normal chat use (long history + default `max_tokens: 2048`).
- Reproduced with a fresh server each time; unrelated to #1154 / #1266.
