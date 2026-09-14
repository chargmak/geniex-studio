# [qairt] `enable_think: false` is ignored for AI Hub Qwen3 bundles — the thinking is emitted as `content`

**Component:** `geniex serve` + `geniex infer`, qairt plugin chat templating
**Version:** GenieX CLI v0.6.1 (QAIRT 2.45), Windows 11 ARM64, Snapdragon X Elite X1E80100
**Model:** `qualcomm/Qwen3-0.6B:W4A16` (AI Hub bundle)

## Summary

With the llama_cpp plugin, `enable_think: false` (server) / `--think=false` (CLI) applies the Qwen3 template's `enable_thinking=false` and the model answers directly. With the QAIRT bundle of the same model the flag has no effect: the model still thinks, and because no `<think>` block is opened the thinking text is returned as the *answer* (`content`), not as `reasoning_content`. Qwen3's `/no_think` soft switch in the user turn does not help either.

## Reproduction

```powershell
geniex serve
```

```powershell
$req = @{ model='qualcomm/Qwen3-0.6B:W4A16'; stream=$false; max_tokens=80; temperature=0.2; reasoning_format='auto'
          enable_think=$false; messages=@(@{ role='user'; content='Say hello in five words.' }) } | ConvertTo-Json -Depth 5
(Invoke-RestMethod http://127.0.0.1:18181/v1/chat/completions -Method Post -ContentType application/json -Body $req).choices[0].message
```

Results (same prompt, three variants):

| `enable_think` | prompt | `content` | `reasoning_content` |
|---|---|---|---|
| false | `Say hello in five words.` | `Okay, the user wants me to say hello in five words. Let me think. First, I need …` | (empty) |
| false | `Say hello in five words. /no_think` | `</think>\n\nOkay, let's see. I'm here to help. Let's say hello in five words. So, …` | (empty) |
| true | `Say hello in five words.` | `\n\n"Hello! Hello!"` | 293 chars of thinking |

The CLI shows the same: `geniex infer qualcomm/Qwen3-0.6B -p "Say hello in five words." --think=false` prints `Okay, let's see. The user wants me to say hello in five words…`.

For comparison, `unsloth/Qwen3-0.6B-GGUF:Q4_0` with `enable_think: false` answers `Hello! How can I help you today?` with no thinking.

## Expected

`enable_think: false` renders the Qwen3 template with `enable_thinking=false` (empty `<think></think>` block) for QAIRT bundles too, so the reply contains only the answer. If the bundle's template cannot be switched, the flag should at least be reported as unsupported for the model instead of silently changing what `content` means.

## Workaround

Always request `enable_think: true` with `reasoning_format: "auto"` and hide `reasoning_content` client-side. It costs the thinking tokens, and small bundles sometimes stop right after the think block with an empty `content`.
