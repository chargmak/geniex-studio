# React Bits Pro catalogue research (SKILL.md v3.0, 1406 lines, fully read)

Source: `C:\Users\stama\Documents\Projects\Blinc\.claude\skills\react-bits-pro\SKILL.md`

## 1. Install rules (summary)

**Registries (merge into `components.json` -> `registries` only; never touch other fields):**
- `@reactbits-starter` -> `https://pro.reactbits.dev/api/r/starter/{name}.json` (Bearer `${REACTBITS_LICENSE_KEY}`)
- `@reactbits-pro` -> `https://pro.reactbits.dev/api/r/pro/{name}.json` (same header). Configure both even if only using blocks. Optional `?agent=claude|codex|cursor|none` or `?skillsDir=` on the pro URL controls where Agent Kit skills land.
- Key lives in `.env.local` as `REACTBITS_LICENSE_KEY=...`; prefix reveals tier: `rbps-` Starter, `rbpp-` Pro, `rbpu-` Ultimate. Alt auth: `X-License-Key` header or `?license_key=`.
- Prereqs: `components.json` (`npx shadcn@latest init`), `lib/utils.ts` `cn()` (clsx + tailwind-merge), Tailwind **v4** strongly recommended (blocks use v4 names like `bg-linear-to-br`), Node 18+, React 18/19.
- Inspect before install (read-only): `npx shadcn@latest view @reactbits-pro/<slug>`. Install this SKILL locally: `npx shadcn@latest add @reactbits-starter/skill`.

**Five product types and naming:**
| Type | Registry id | Suffix/prefix | Tier | Installs to | Export |
|---|---|---|---|---|---|
| Component (135) | `@reactbits-starter/<slug>-tw` or `-css` | `-tw`/`-css` REQUIRED (bare slug = 404) | Starter+ | `components/react-bits/<slug>.tsx` (+`.css` for -css) | always `export default` |
| Marketing block (238, 21 cats) | `@reactbits-pro/<slug>` e.g. `hero-1` | none (suffix = 404) | Pro+ | `components/blocks/<slug>.tsx` | MIXED default/named; identifier does not follow slug (`404-3` -> `NotFound3`, `cta-4` -> `Cta4`); always `grep -E "^export (default )?function "` |
| App UI block (300, 38 cats) | `@reactbits-pro/<slug>` e.g. `ai-chat-1` | none | Pro+ | `components/blocks/<slug>.tsx` | ALL `export default` |
| Agent Kit item (19) | `@reactbits-pro/skill-<slug>` / `prompt-<slug>` / `recipe-<slug>` | prefix | Pro+ (`skill-terminal-dark` free, no key) | `.claude/skills/<slug>/SKILL.md` / `prompts/<slug>/PROMPT.md` / `recipes/<slug>/RECIPE.md`+`plan.json` | markdown for the agent, not React |
| Template (11) | none: `.zip` download from website | n/a | Ultimate (`portfolio-template` free) | unzip | n/a |

- `-tw` = Tailwind variant (default); `-css` = vanilla CSS variant (non-Tailwind only). Pick one project-wide. Blocks have no variants (Tailwind-only, single file, take no props; customize by editing source).
- Marketing vs App UI: same registry, same dir, same Pro entitlement. Marketing = `min-h-screen`, big type; App UI = `h-full min-h-[Npx]` root, dense `text-[13px]`, five control heights, explicit pixel radii, shared surface/border tokens, composes without per-block overrides.
- Hard rules: check tier first (403 = entitlement, don't retry); never delete `"use client"`; WebGL components need a sized parent; **App UI blocks need a height-bounded parent** (`h-dvh`/`h-screen`/`h-[640px]`) or scroll regions collapse; most `app-shell-*` already include nav + content region so edit its content area rather than nesting a second shell; always harmonize (host codebase wins: swap `neutral-*` for tokens, match radius, container, type, motion budget); use `motion/react` (Motion v11), never `framer-motion`; no d3.
- Agent Kit item kinds: **Design skill (8)** = a complete *landing-page* design system (type scale, grid, colour, motion, anti-patterns, self-verify loop), autoloaded from `.claude/skills/`. **Page prompt (8)** = a brief for one website type (what the page must prove, section order, copy strategy). **Recipe (3)** = tested block arrangement for a whole page + `plan.json` with per-section `fallback` markup. Intended combo: one skill + one prompt (+ recipe for order).
- Available: skills `apple-minimal, corporate-trust, editorial, luxury-serif, neobrutalism, playful-motion, swiss-grid, terminal-dark(free)`; prompts `agency, consumer-hardware, developer-tool, ecommerce-brand, fintech, fitness, real-estate, saas`; recipes `saas-homepage, agency-homepage, product-launch`.
- Templates: `saas-landing, ai-saas-landing, minimal-landing, finance-landing, agency-site, shader-template, wireframe-template, 8-bit-template, ai-app-template, security-template` (Ultimate), `portfolio-template` (free). All are landing pages, not app shells.
- Note: `reactbits-bootstrap` skill is available in this environment for setting up license/registries in a new project.

**Important caveat:** the SKILL catalogue only lists App UI blocks as slug *ranges* with a one-line category description; it does not describe `ai-chat-1` vs `ai-chat-9` individually. Everything below is a category-level pick; the exact number must be chosen by `npx shadcn@latest view @reactbits-pro/<slug>` or https://pro.reactbits.dev/docs/app-ui. Everything relevant is **Pro tier** (`rbpp-`/`rbpu-` key needed) except the Starter components noted.

## 2. Shortlist for a restrained, product-grade GenieX chat + agent workspace

All App UI blocks below: `@reactbits-pro/<slug>`, `export default`, need a bounded-height parent. Their dense 13px scale, explicit pixel radii and neutral surfaces map cleanly onto Qualcomm's system after a token swap (surfaces #151516/#202021, accent #3253dc, Roboto Flex, radius 4/8px, borders 0.8px, strip mount animations).

**AI / agent App UIs**
- `@reactbits-pro/ai-chat-1 … ai-chat-9` — conversation surfaces with streaming, citations, message actions. Core chat pane; wire to `geniex serve` (127.0.0.1:18181) streaming. Pick the plainest (no gradient/glass) variant.
- `@reactbits-pro/prompt-input-1 … prompt-input-7` — composer with attachments, **model picker**, slash commands. Attachments -> VLM image input; model picker -> `geniex list`; slash commands -> `/system`, `/think`, `/compute npu`.
- `@reactbits-pro/tool-calls-1 … tool-calls-6` — tool invocation cards with arguments, results, errors. Tool-call timeline inside chat.
- `@reactbits-pro/agent-activity-1 … agent-activity-7` — live agent run logs, step timelines, status streams. Agent console / run inspector.
- `@reactbits-pro/agent-plan-1 … agent-plan-6` — multi-step plans with progress and revision. Agentic workflow view.
- `@reactbits-pro/agent-approval-1 … agent-approval-6` — human-in-the-loop approval gates. Confirm shell/file/MCP actions before execution.
- `@reactbits-pro/ai-usage-1 … ai-usage-8` — token, cost, quota reporting. Repurpose "cost" columns as tokens/s, TTFT, context fill (`--nctx`), NPU vs CPU compute.

**Sidebars / nav shells**
- `@reactbits-pro/app-shell-1 … app-shell-9` — full frame (sidebar + topbar + content). One shell only; put chat/agent/dashboard panes in its content region.
- `@reactbits-pro/app-sidebar-1 … app-sidebar-7` — standalone sidebars with nav trees, workspaces, collapse. Conversations list, projects/workspaces, pinned models.
- `@reactbits-pro/navbar-1 … navbar-14` — app top bar with search, actions, account menu. Model/compute selector and serve status in the top bar.
- `@reactbits-pro/command-menu-1 … command-menu-6` — Ctrl+K palette: switch model, set compute, new chat, run workflow.

**Settings**
- `@reactbits-pro/settings-form-1 … settings-form-6` — preference forms. Map to `geniex serve/run` flags: temperature/top-p/top-k/min-p/penalties/seed, `--nctx`, `--ngl`, `--compute cpu|gpu|npu|hybrid`, `--think`, `--system-prompt`, `--stop`, spec-decoding (`--spec-type`, `--draft-model`), `--sliding-window`, CORS origins, keepalive.
- `@reactbits-pro/forms-1 … forms-12` — general multi-field forms (model pull dialog: hub aihub|hf|docker|localfs, model type llm|vlm).
- `@reactbits-pro/integrations-1 … integrations-6` — connection directories, API keys, webhooks. MCP servers / tool registry for the agent side.
- `@reactbits-pro/editor-1 … editor-5` — text/document editing surface for system prompts and grammar files (`--grammar-path/--grammar-string`).

**Dashboards / telemetry**
- `@reactbits-pro/card-1 … card-11` — metric/summary cards: tok/s, TTFT, NPU utilisation, memory, active model.
- `@reactbits-pro/monitoring-1 … monitoring-10` — status boards, incidents, logs, health. Best fit for "is `geniex serve` up, which backend (llama.cpp+ggml-hexagon vs qairt), NPU status, server log tail".
- `@reactbits-pro/analytics-1 … analytics-16` — charts/reporting for tok/s over time, per-model comparisons.
- `@reactbits-pro/dashboard-1 … dashboard-14` — composed dashboard screens if a dedicated "System" page is wanted (pick a dense, chart-light one).
- `@reactbits-pro/data-table-1 … data-table-8` — installed-model table (name, hub, type llm/vlm, size, quant, status) with actions pull/remove/set-type.
- `@reactbits-pro/list-1 … list-12` — dense record lists/feeds for run history and logs.
- `@reactbits-pro/filtering-1 … filtering-9` — filter bars/saved views for a model hub browser.
- Starter component: `@reactbits-starter/simple-graph-tw` — animated, customisable line graph; a small tok/s sparkline without a chart lib.

**File / image drop zones**
- `@reactbits-pro/file-manager-1 … file-manager-4` — file browsers, uploads, asset grids. Drop zone for images (VLM), documents for RAG, localfs GGUF picking. Also `prompt-input-*` attachments cover inline chat drops.

**Overlays**
- `@reactbits-pro/notifications-1 … notifications-6` — toasts / notification centre (model download done, server restarted).
- `@reactbits-pro/app-dialog-1 … app-dialog-7` — modals, confirmations, sheets, drawers (delete model, pull confirmation, run details drawer).

**Empty states / onboarding**
- `@reactbits-pro/empty-state-1 … empty-state-5` — first-run, no-results, error placeholders (no models installed; server offline).
- `@reactbits-pro/onboarding-1 … onboarding-7` — welcome flows, checklists, tours (detect CLI -> pick compute -> pull first model).
- `@reactbits-pro/wizard-1 … wizard-7` — multi-step flows with progress/validation (model pull + config wizard).
- Starter component: `@reactbits-starter/preloader-tw` — animated loading screens (app boot / model load), keep to a quiet variant.
- Starter component (optional, tone down): `@reactbits-starter/animated-list-tw` — list entrance animations for conversation list; only if kept to a short opacity fade.

**Not in the catalogue (be honest):** no standalone tabs, code block, markdown renderer, progress bar, or streaming-cursor item exists. `ai-chat-*` blocks presumably render messages, but the file does not promise markdown/code rendering. Use shadcn/ui primitives (Tabs, Progress, Tooltip) plus react-markdown/shiki for those; the skill explicitly says not to use React Bits for generic shadcn primitives.

**Avoid for this brief (flashy/marketing/off-purpose):**
- All 77 shader/WebGL backgrounds (`silk-waves`, `aurora-*`, `ai-blob`, `agentic-ball`, `neural-float`, `neural-tunnel`, `black-hole`, `vortex`, `portal`, `lightspeed`, `thinking-dots`, `tech-wall`, etc.) — GPU cost, marketing feel, and they need sized parents; at most one very low-opacity ambient if ever.
- All 8 cursor effects, all 12 3D/tilt cards (`shader-card`, `depth-card`, `credit-card`, `rotating-cards`, `scroll-stack`, ...), all 15 galleries/carousels, all text effects (`glitch-text`, `particle-text`, `text-scatter`, `speeding-text`, `bending-marquee`), image reveals (`shader-reveal`, `liquid-swap`, `particle-image`), `globe`, `parallax-pills`, `device`.
- Every marketing block category (`hero-*`, `cta-*`, `pricing-*`, `social-proof-*`, `waitlist-*`, `stats-*` (marketing stats, not telemetry), `features-*`, `showcase-*`, `comparison-*`, `404-*`) — wrong density and `min-h-screen`.
- App UI categories that don't fit a local single-user app: `paywall-*`, `billing-*`, `authentication-*`, `chat-1..6` (non-AI team messaging; do not confuse with `ai-chat-*`), `mobile-*`, `scheduling-*`, `kanban-*` (unless a task board is wanted), `feedback-*`, `support-*`, `comments-*`.
- Templates (`ai-app-template`, `ai-saas-landing`) — Ultimate-only zip landing pages, not app shells.

## 3. Agent Kit relevance to "AI chat app", "agent", "dashboard"

- None of the 19 items targets an app UI, agent console, or dashboard. All 8 design skills are explicitly *landing-page* design systems; all 8 prompts are website/vertical briefs; all 3 recipes assemble marketing homepages.
- Closest in spirit: `@reactbits-pro/skill-terminal-dark` (free, no key; dark developer-tool aesthetic; its type/motion/anti-pattern rules can be borrowed for a restrained dark app), `@reactbits-pro/skill-swiss-grid` / `skill-apple-minimal` (restraint, grid discipline), and `@reactbits-pro/prompt-developer-tool` / `prompt-saas` / `prompt-consumer-hardware` — only useful if a public landing page for the GenieX UI is ever needed. `recipe-saas-homepage` / `recipe-product-launch` likewise landing-only.
- For the app itself the practical "design system" is the App UI blocks' shared system (13px scale, pixel radii, shared tokens) harmonized to Qualcomm tokens; there is no Agent Kit doc for that.
