# GenieX Studio

A local-first desktop studio for **Qualcomm GenieX** on Snapdragon — chat, vision and agents running on the **Hexagon NPU**, with a Qualcomm-design-system UI. Nothing leaves the device unless you enable the agent's web tools.

![Electron 43 · win-arm64](https://img.shields.io/badge/Electron-43%20%C2%B7%20arm64-3253dc) ![React 19](https://img.shields.io/badge/React-19-4076ff) ![Tailwind 4](https://img.shields.io/badge/Tailwind-4-7ba0ff) ![GenieX ≥ 0.6.0](https://img.shields.io/badge/GenieX-%E2%89%A5%200.6.0-55cccc)

## What it does

- **Chat** — streaming replies with a collapsible *thought process* (Qwen3 thinking), Markdown/GFM, syntax-highlighted code, Mermaid, live HTML/SVG artifact preview, image attachments for Vision models, edit-and-resend, regenerate, per-chat model + sampler + compute settings, `/`-commands, context meter with tok/s and TTFT.
- **Agent mode** — a tool loop on GenieX's OpenAI-style tool calling: `read_file · list_dir · search_files · write_file · edit_file` (sandboxed to a workspace, rollback snapshots), `run_command` (PowerShell), `web_search · web_fetch`, `analyze_image` (Vision model), and any **MCP** server's tools. Every risky call stops for **Allow / Always allow / Deny**; runs are persisted with a timeline.
- **Models** — installed table, Qualcomm AI Hub catalogue for your chipset, Hugging Face GGUF pulls with quantisation discovery (Q4_0 = NPU), Docker Hub and local imports, live download progress, default chat/agent/vision picks.
- **System** — supervises `geniex serve` (auto-start, restart, crash attribution), resident model, memory/CPU/GPU tiles, per-model tok/s, Qualcomm's **geniex-bench** (downloaded on demand; median ± stdev TTFT / prefill / decode per model, compute unit and speculation mode) plus a quick in-chat benchmark, live server log.
- **Settings** — server flags (host, keepalive, context, compute, log level), model defaults, workspace, theme, close-to-tray; onboarding checklist; **Ctrl+K** command palette; system tray.
- **Studio (NPU media sidecar, optional)** — Stable Diffusion 1.5 / 2.1 text-to-image (≈5–7 s per 512² image on the NPU) with a gallery, **dictation** (Whisper on the NPU — mic button in the composer) and **read-aloud** (Piper TTS on the NPU) for any reply. One click installs a private Python 3.12 arm64 environment; models download on demand from Qualcomm AI Hub.
- **Knowledge (local RAG)** — index folders of notes/docs/code; chunks are embedded with nomic-embed-text on the NPU and the best excerpts are injected into chat/agent prompts with numbered `[n]` citations shown under the answer.

## Requirements

- Windows 11 on Snapdragon X (Elite/Plus) — Windows on ARM. Tested on X1E80100, 16 GB.
- [GenieX CLI](https://geniex.aihub.qualcomm.com) **v0.6.0 or newer** installed (default path `%LOCALAPPDATA%\GenieX CLI\geniex.exe`; configurable in Settings). Studio drives the CLI for model management and supervises `geniex serve` for inference. Older CLIs get an update banner and chat is refused (`geniex update` fixes it).
- Node 22.12+ (dev only). No Rust / Visual Studio build tools needed — all native modules ship win32-arm64 prebuilds.

## Run

```bash
npm install
npm run dev          # Electron + Vite HMR (renderer on :5173, Studio API on :18190)
```

Other scripts:

```bash
npm run build        # production bundle → out/
npm start            # electron-vite preview of the production bundle
npm run serve        # headless: Studio API (+ built UI) without Electron → open http://127.0.0.1:18190
npm test             # Vitest (parsers, prompt budgeting, tool-arg repair, sandbox, knowledge chunking)
npm run typecheck    # tsc for main + renderer
npm run package      # NSIS installer for arm64 → release/
npm run release      # same, then upload to a draft GitHub release (see docs/RELEASING.md)
```

## Install it as a desktop app

`npm run package` produces `release/GenieX Studio-<version>-win-arm64.exe` — a per-user NSIS installer (no
admin rights). It adds Start-menu and desktop shortcuts, an entry in Settings → Apps, and keeps everything
under `%LOCALAPPDATA%\Programs`. Once installed, Studio behaves like any other Windows app:

- remembers window size, position and maximized state between launches
- optional **Start with Windows** and **Start minimized to tray** (Settings → Appearance & startup)
- close-to-tray keeps the GenieX server, downloads and agent runs alive; the tray menu can start/stop the server
- single instance — launching again focuses the running window
- **updates itself** from GitHub Releases: checks on launch and every six hours, downloads only the changed
  blocks of the installer, and applies it on **Restart & install** (Settings → Updates, or the top-bar pill).
  Chats, settings and models live in `%APPDATA%\geniex-studio` and survive updates and uninstalls.

Publishing a new version is `npm run release` → review the draft → `npm run release:publish`. Full flow,
channels (stable/beta) and signing notes: [docs/RELEASING.md](docs/RELEASING.md).

First launch shows an onboarding checklist: CLI detected → server running → pull a starter model (**unsloth/Qwen3-4B-GGUF:Q4_0** ≈2.4 GB, runs on the NPU). Then chat.

## Architecture

```
Electron main (Node 24 arm64)                          Renderer (React 19 SPA, same-origin /api)
├─ GenieXSupervisor  spawn/attach geniex serve,        ├─ AppShell · Sidebar · TopBar · CommandPalette · Onboarding
│   health poll, log ring, auto-restart, crash attrib  ├─ Chat: ConversationList · MessageList · Composer · ModelPicker
├─ GenieXClient      serialized gate, warm-up load,    │        ThinkingFold · Markdown/CodeBlock/Mermaid · ArtifactPanel
│   SSE + body sniffing, reasoning/tool-call deltas,   ├─ Agent: ToolCallCard · ApprovalCard · Agents page (runs/tools/MCP)
│   TTFT/tok-s, telemetry recorder                     ├─ Models · System · Settings pages
├─ ModelManager (geniex list/model list/remove)        ├─ Studio (sidecar setup, image models, generate, gallery) · Knowledge page
│                                                       └─ zustand stores: chat · models · server · ui · artifact · sidecar · knowledge
├─ PullManager (geniex pull, progress parsing)
├─ TurnRunner (chat) · AgentRunner (tool loop) · ApprovalCenter · McpManager
├─ SidecarSupervisor (uv → Python 3.12 arm64 venv → uvicorn) · KnowledgeService (chunk → embed → cosine top-k)
├─ Hono API server (also serves the built renderer) — /api/genie /models /conversations /attachments /agent /system /settings /sidecar /knowledge
├─ SQLite (better-sqlite3): conversations, messages, attachments, runs, run_events, telemetry, mcp_servers, approvals_rules,
│   generations, knowledge_sources, knowledge_chunks
├─ UpdateService (electron-updater → GitHub Releases) · WindowStateKeeper · launch-at-login
└─ Tray · close-to-tray · single instance

sidecar/ (Python · FastAPI on 127.0.0.1:18195, spawned by the app · QAI AppBuilder + bundled QAIRT 2.48 HTP runtime)
├─ engines/qnn.py      NamedContext: name-ordered I/O, dtype-faithful feeds (integer ids stay integer in FLOAT mode)
├─ engines/sd.py       SD 1.5 (ε) / 2.1 (v-prediction): numpy CLIP BPE tokenizer, Euler scheduler, CFG, VAE — no torch/diffusers
├─ engines/whisper.py  log-mel in numpy, encoder + KV-cache decoder loop (HF-export semantics), 30 s chunks
├─ engines/tts.py      Piper VITS: CMUdict → espeak-style IPA → piper ids (interleaved PAD) → encoder → SDP → flow → HiFi-GAN windows
├─ engines/embed.py    nomic-embed-text DLC, 128-token windows → 512-d normalised vectors
└─ registry.py         model catalogue (public AI Hub S3 assets + HF tokenizer files), resumable downloads, NDJSON progress
```

- The renderer never talks to GenieX directly; the Studio server proxies `/v1/chat/completions` so it can keep requests inside the context window, restart the runtime when the model family changes, sniff SSE bodies, measure TTFT/tok/s, translate runtime crashes, and serialise requests (GenieX holds one global mutex and keeps one model resident).
- Prompt assembly budgets history against the model's context (QAIRT ≈4 k baked, GGUF = `--nctx`) with a per-conversation token factor calibrated from the server's own `prompt_tokens`, trims in blocks so later turns stay KV-cache continuations, keeps images on every message for llama.cpp vision models (the model can refer back to an earlier picture), and never sends images to text-only models.
- Design: Qualcomm `--q-*` tokens (`src/renderer/src/styles/tokens.css`), dark-first with a light remap, Roboto Flex/Mono bundled, 0.8 px hairlines, `.161s` motion. React Bits Pro App-UI blocks (`ai-chat`, `prompt-input`, `tool-calls`) are installed under `components/blocks/` as pattern references; the neutral ramp is remapped so blocks land on Qualcomm tokens.

## GenieX v0.6 behaviours the app is built around

Source-verified (docs, `qualcomm/GenieX` source, releases) and measured on this machine — see `docs/research/phase0-v061/` and `docs/geniex-v0.6-adoption-plan.md`:

| Behaviour | Studio response |
|---|---|
| Server has no model-management endpoints | shells out to `geniex list --format json`, `pull` (AI Hub, Hugging Face, ModelScope, Docker, local), `remove`, `model list/set-type` |
| One model resident; all `/v1` requests serialised | serialised client gate, warm-up load with `messages: []`, "loading model" state, resident/busy status |
| KV cache is reused only when a request *continues* the previous one (the old `GenieX-KeepCache` header is gone) | history is trimmed in blocks (down to 60 % of the budget) so the next turns keep the cache; `usage.prompt_tokens` counts only the newly prefilled tokens |
| Tool calls stream, several per turn; `role: tool` results reach the template | the agent announces every call of a turn, raises all approvals at once (*Allow all*), then runs them in order |
| **GGUF on the NPU aborts the whole server on any context overflow** (llama.cpp context shift → `cannot run the operation (ROPE)`) | a calibrated token estimate, `max_tokens` clamped to what is left of the window, and a 413 refusal when one message cannot fit; the crash signature is classified as *context overflow* and never blacklists the model |
| **QAIRT → GGUF inside one `serve` process fails** (`HTP0 failed to open session : error 0x80000406`) | Studio restarts `geniex serve` automatically before the GGUF request (`runtime-restart` event in the chat) |
| QAIRT Qwen3 bundles ignore `enable_think:false` | thinking is requested and routed to `reasoning_content`, which is hidden when the user turned thinking off |
| Overflow on QAIRT → 400 `context_length_exceeded` (SSE: SDK code −200103) | mapped to one message and a harder estimate pad for the rest of the conversation |
| Speculative decoding without a draft model (`ngram-*`) | composer *Speed* menu / `/spec`; acceptance shown as `spec NN%` on the reply |
| Omits `Content-Type` on SSE when `reasoning_format:'auto'` + thinking | body sniffing instead of header trust |
| Mid-stream errors end without `[DONE]` | tolerant SSE parser, error frames surfaced |
| No embeddings / image / audio / video generation | the optional **NPU sidecar** covers images (SD 1.5/2.1), STT (Whisper), TTS (Piper) and embeddings (nomic) on the NPU; video stays out of scope |

### Runtime findings on this machine (X1E80100, NPU driver 30.0.220.3000, GenieX v0.6.1)

- **AI Hub QAIRT bundles (`qualcomm/*`) run** — the v0.4 crash (GenieX issue [#1154](https://github.com/qualcomm/GenieX/issues/1154)) is gone with the same driver: Qwen3-0.6B W4A16 loads in ~6.5 s and decodes at ~80 tok/s with 30 ms TTFT (geniex-bench), and makes correct tool calls. Crash history in `runtime-crashes.json` is stamped with the CLI version and forgotten when the CLI changes; a model that does crash is still avoided by auto-selection (`pickAutoModel`) and marked in the picker.
- **GGUF Q4_0 on `compute: npu`**: Qwen3-0.6B ≈60 tok/s decode / 120 ms TTFT (bench); Qwen3-4B ≈10–16 tok/s depending on free RAM. `hybrid` loads slower (~20 s) and did not crash this time; `npu` stays the default.
- **Gemma-4-E2B QAT Q4_0 (GGUF vision + audio)** loads in ~6.5 s; every 512² image costs ~7 s to encode on cpu, hybrid and npu alike; earlier images stay usable across the conversation. Its audio transcription was poor, so dictation stays on the sidecar's Whisper.
- No Windows performance counter set exists for the NPU on this machine, so the System page reports it honestly and leans on measured tok/s.

## Phase 2 — NPU media sidecar

The sidecar is a small FastAPI server (`sidecar/`) that the app provisions and supervises. It runs Qualcomm AI Hub models on the Hexagon NPU through **QAI AppBuilder** (`qai-appbuilder` 2.48.40, which bundles the QAIRT HTP runtime — nothing system-wide) and exposes OpenAI-shaped endpoints the app proxies under `/api/sidecar/*`:

| Endpoint | Model (downloaded on demand) | Measured on X1E80100 |
|---|---|---|
| `POST /v1/images/generations` | Stable Diffusion 1.5 (w8a16, 681 MB) · 2.1 (836 MB) | 512² · 20 steps: **5.1 s** (1.5) / **6.7 s** (2.1) end-to-end |
| `POST /v1/audio/transcriptions` | Whisper tiny / base / small | an 11 s clip in **~150–260 ms** |
| `POST /v1/audio/speech` | Piper TTS (en, 22.05 kHz) | 17 s of speech in **~320 ms** |
| `POST /v1/embeddings` | nomic-embed-text v1.5 (512-d) | ≈13 ms per text; 299 chunks indexed in ~5 s |

Provisioning (Studio page → *Install*): download `uv` → `uv python install 3.12-aarch64` (a **native ARM64** CPython — `uv` picks x86_64 by default on Windows-on-ARM, so the arch is requested explicitly) → `uv venv` → `uv pip install -r sidecar/requirements.txt` (~35 packages; no torch/diffusers/transformers) → verify `import qai_appbuilder`. Everything lives under `%APPDATA%\GenieX Studio\sidecar\` (`.venv/`, `uv/`, `models/`). The sidecar starts on demand and the app works fully without it.

Sidecar findings worth knowing:

- **AppBuilder copies integer tensors byte-for-byte even in FLOAT mode** — casting phoneme/token ids to float32 feeds reinterpreted garbage; `NamedContext` keeps declared-integer inputs integer.
- **Piper voices expect piper-phonemize's id layout**: `BOS, PAD, phoneme, PAD, …, EOS` (a PAD between every phoneme) with punctuation attached to the preceding word. Without the interleaved PADs the speech has the right rhythm but is unintelligible. G2P is CMUdict → espeak-style IPA (`ɹ ɡ ɚ ɜː`, stress mark before the vowel) with letter-name spelling for acronyms/unknown words; `gruut`/`espeak-ng` are avoided because `python-crfsuite` has no win_arm64 wheel.
- **Whisper HF-export decoder**: additive attention mask initialised to −100 and opened one slot per step, right-aligned self-attention KV caches (length 199), decode from `<|startoftranscript|>` alone (the model emits language/task tokens itself).
- **SD 2.1 needs `v_prediction`** in the Euler scheduler (the AI Hub export is the 512-base v-model); SD 1.5 uses ε.
- The Voice-AI-SDK Piper bundle also ships an on-NPU charsiu ByT5 G2P (`charsiu_*.bin`) that could replace CMUdict later.

Verify from a shell (sidecar venv): `python -m unittest discover -s sidecar/tests -v` (G2P checks skip until the Piper voice is downloaded).

## Roadmap

- Sidecar: SD 3.5-Medium 1024² (needs ~32 GB RAM), more Piper voices / languages (DE, IT on AI Hub), streaming dictation, PDF/Office parsing for Knowledge, on-NPU charsiu G2P. Local **video generation is not realistic** on this hardware today.
- Auto-updater, `/v1/completions` FIM playground, GBNF grammar runs via the CLI, Windows AI Foundry integration.

## Project layout

```
src/main/        Electron main: server/ (Hono routes) · geniex/ (supervisor, client, cli, models, pulls) · chat/ (prompt, turns)
                 agent/ (loop, tools/, approvals, registry) · mcp/ · db/ · telemetry/ · sidecar/ (supervisor) · knowledge/ (service)
                 tray.ts · ipc.ts · bootstrap.ts
src/preload/     minimal contextBridge (dialogs, openExternal, window controls)
src/renderer/    React app: app/ (pages) · components/{shell,chat,agent,ui,blocks} · stores/ · hooks/ · styles/
src/shared/      API/chat/agent/settings/sidecar types shared by main + renderer
sidecar/         Python NPU sidecar: server.py · registry.py · util.py · engines/{qnn,sd,whisper,tts,embed}.py · tests/ · requirements.txt
docs/            design-system.md · research/ (GenieX capability research)
resources/       icons (generated by scripts/make-icons.py)
```

Data lives in the app's user-data folder (`%APPDATA%\GenieX Studio` in dev): `settings.json`, `studio.db`, `attachments/`, `checkpoints/`, `generated/` (images), `sidecar/` (venv + models). GenieX's own model cache is `%USERPROFILE%\.cache\geniex\models`.

## License

MIT for this app. GenieX, QAIRT and models carry their own licenses.
