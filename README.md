# GenieX Studio

A local-first desktop studio for **Qualcomm GenieX** on Snapdragon — chat, vision and agents running on the **Hexagon NPU**, with a Qualcomm-design-system UI. Nothing leaves the device unless you enable the agent's web tools.

![Electron 43 · win-arm64](https://img.shields.io/badge/Electron-43%20%C2%B7%20arm64-3253dc) ![React 19](https://img.shields.io/badge/React-19-4076ff) ![Tailwind 4](https://img.shields.io/badge/Tailwind-4-7ba0ff) ![GenieX 0.4.0](https://img.shields.io/badge/GenieX-v0.4.0-55cccc)

## What it does

- **Chat** — streaming replies with a collapsible *thought process* (Qwen3 thinking), Markdown/GFM, syntax-highlighted code, Mermaid, live HTML/SVG artifact preview, image attachments for Vision models, edit-and-resend, regenerate, per-chat model + sampler + compute settings, `/`-commands, context meter with tok/s and TTFT.
- **Agent mode** — a tool loop on GenieX's OpenAI-style tool calling: `read_file · list_dir · search_files · write_file · edit_file` (sandboxed to a workspace, rollback snapshots), `run_command` (PowerShell), `web_search · web_fetch`, `analyze_image` (Vision model), and any **MCP** server's tools. Every risky call stops for **Allow / Always allow / Deny**; runs are persisted with a timeline.
- **Models** — installed table, Qualcomm AI Hub catalogue for your chipset, Hugging Face GGUF pulls with quantisation discovery (Q4_0 = NPU), Docker Hub and local imports, live download progress, default chat/agent/vision picks.
- **System** — supervises `geniex serve` (auto-start, restart, crash attribution), resident model, memory/CPU/GPU tiles, per-model tok/s, one-click benchmark across compute units, live server log.
- **Settings** — server flags (host, keepalive, context, compute, log level), model defaults, workspace, theme, close-to-tray; onboarding checklist; **Ctrl+K** command palette; system tray.

## Requirements

- Windows 11 on Snapdragon X (Elite/Plus) — Windows on ARM. Tested on X1E80100, 16 GB.
- [GenieX CLI](https://geniex.aihub.qualcomm.com) v0.4.0 installed (default path `%LOCALAPPDATA%\GenieX CLI\geniex.exe`; configurable in Settings). Studio drives the CLI for model management and supervises `geniex serve` for inference.
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
npm test             # Vitest (parsers, prompt budgeting, tool-arg repair, sandbox)
npm run typecheck    # tsc for main + renderer
npm run package      # NSIS installer for arm64 → release/
```

First launch shows an onboarding checklist: CLI detected → server running → pull a starter model (**unsloth/Qwen3-4B-GGUF:Q4_0** ≈2.4 GB, runs on the NPU). Then chat.

## Architecture

```
Electron main (Node 24 arm64)                          Renderer (React 19 SPA, same-origin /api)
├─ GenieXSupervisor  spawn/attach geniex serve,        ├─ AppShell · Sidebar · TopBar · CommandPalette · Onboarding
│   health poll, log ring, auto-restart, crash attrib  ├─ Chat: ConversationList · MessageList · Composer · ModelPicker
├─ GenieXClient      serialized gate, warm-up load,    │        ThinkingFold · Markdown/CodeBlock/Mermaid · ArtifactPanel
│   SSE + body sniffing, reasoning/tool-call deltas,   ├─ Agent: ToolCallCard · ApprovalCard · Agents page (runs/tools/MCP)
│   TTFT/tok-s, telemetry recorder                     ├─ Models · System · Settings pages
├─ ModelManager (geniex list/model list/remove)        └─ zustand stores: chat · models · server · ui · artifact
├─ PullManager (geniex pull, progress parsing)
├─ TurnRunner (chat) · AgentRunner (tool loop) · ApprovalCenter · McpManager
├─ Hono API server (also serves the built renderer) — /api/genie /models /conversations /attachments /agent /system /settings
├─ SQLite (better-sqlite3): conversations, messages, attachments, runs, run_events, telemetry, mcp_servers, approvals_rules
└─ Tray · close-to-tray · single instance
```

- The renderer never talks to GenieX directly; the Studio server proxies `/v1/chat/completions` so it can inject `GenieX-KeepCache`, sniff SSE bodies, measure TTFT/tok/s, translate runtime crashes, and serialise requests (GenieX holds one global mutex and keeps one model resident).
- Prompt assembly budgets history against the model's context (QAIRT ≈4 k baked, GGUF = `--nctx`), sends media only on the last message (GenieX encodes only that), and never sends images to text-only models.
- Design: Qualcomm `--q-*` tokens (`src/renderer/src/styles/tokens.css`), dark-first with a light remap, Roboto Flex/Mono bundled, 0.8 px hairlines, `.161s` motion. React Bits Pro App-UI blocks (`ai-chat`, `prompt-input`, `tool-calls`) are installed under `components/blocks/` as pattern references; the neutral ramp is remapped so blocks land on Qualcomm tokens.

## GenieX v0.4.0 behaviours the app is built around

Source-verified (docs, `qualcomm/GenieX` source, issues) — see `docs/research/`:

| Behaviour | Studio response |
|---|---|
| Server has no model-management endpoints | shells out to `geniex list --format json`, `pull`, `remove`, `model list/set-type` |
| One model resident; all `/v1` requests serialised | serialised client gate, warm-up load with `messages: []`, "loading model" state, resident/busy status |
| Reads `max_completion_tokens` (docs say `max_tokens`) | sends both |
| Only the last message's media is encoded; images to an LLM → 400 | last-message-only media, VLM guard + notice |
| One tool call per assistant turn; tool turns are buffered | sequential loop, one call/turn, no token streaming during tool turns |
| Omits `Content-Type` on SSE when `reasoning_format:'auto'` + thinking | body sniffing instead of header trust |
| Mid-stream errors end without `[DONE]` | tolerant SSE parser, error frames surfaced |
| No embeddings / image / audio / video generation | out of scope for now (see Roadmap) |

### Runtime findings on this machine (X1E80100, NPU driver 30.0.220.3000)

- **AI Hub QAIRT bundles (`qualcomm/*`) crash the runtime on load** (`0xC0000005` after `DSP_INFO UNSUPPORTED_KEY`) — matches open GenieX issue [#1154](https://github.com/qualcomm/GenieX/issues/1154). Studio attributes the crash, restarts the server, and points at GGUF Q4_0 instead. If a future driver / GenieX release fixes it, the catalogue works unchanged.
- **GGUF Q4_0 on `compute: npu` is reliable**: Qwen3-0.6B ≈70 tok/s decode / 73 ms TTFT; Qwen3-4B ≈14 tok/s / 0.38 s TTFT / 7 s load.
- **`hybrid` is faster per docs but crashed with Qwen3-4B here** → the default GGUF compute is `npu`; hybrid stays selectable (marked experimental).
- No Windows performance counter set exists for the NPU on this machine, so the System page reports it honestly and leans on measured tok/s.

## Roadmap

- **Phase 2 — NPU media sidecar (optional):** a Python-arm64 FastAPI sidecar wrapping Qualcomm AI Hub / QAI AppBuilder models for Stable Diffusion image generation (SD 1.5/2.1 ≈4 s per 512² image, SD3.5-Medium), Whisper speech-to-text, Piper TTS and NPU embeddings for RAG — exposed OpenAI-style so the app treats them uniformly. Local **video generation is not realistic** on this hardware today.
- Auto-updater, `/v1/completions` FIM playground, GBNF grammar runs via the CLI, Windows AI Foundry integration.

## Project layout

```
src/main/        Electron main: server/ (Hono routes) · geniex/ (supervisor, client, cli, models, pulls) · chat/ (prompt, turns)
                 agent/ (loop, tools/, approvals, registry) · mcp/ · db/ · telemetry/ · tray.ts · ipc.ts · bootstrap.ts
src/preload/     minimal contextBridge (dialogs, openExternal, window controls)
src/renderer/    React app: app/ (pages) · components/{shell,chat,agent,ui,blocks} · stores/ · hooks/ · styles/
src/shared/      API/chat/agent/settings types shared by main + renderer
docs/            design-system.md · research/ (GenieX capability research)
resources/       icons (generated by scripts/make-icons.py)
```

Data lives in the app's user-data folder (`%APPDATA%\GenieX Studio` in dev): `settings.json`, `studio.db`, `attachments/`, `checkpoints/`. GenieX's own model cache is `%USERPROFILE%\.cache\geniex\models`.

## License

MIT for this app. GenieX, QAIRT and models carry their own licenses.
