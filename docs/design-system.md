# GenieX / Qualcomm AI Hub — Design System

Extracted from `https://aihub.qualcomm.com/geniex` (Aug 2026). Two layers are in play:

1. **Qualcomm base DS** — a token library exposed as CSS custom properties prefixed `--q-*`, plus component classes prefixed `.q-*`. This is the durable foundation.
2. **GenieX page layer** — a Tailwind-based marketing skin with hard-coded hexes and a display typeface (Alfabet) that the base DS doesn't ship. Documented separately below as *page tokens* so you don't mistake them for platform tokens.

When building new work: **prefer `--q-*` tokens.** Use page tokens only for GenieX-branded marketing surfaces.

---

## 1. Foundations

### 1.1 Typography — families

| Role | Family | Token |
|---|---|---|
| UI / body / product | `"Roboto Flex", sans-serif` | `--q-font-family` |
| Brand headings | `"Qualcomm Next", sans-serif` | `--q-font-family-brand` |
| Code | `"Roboto Mono", Consolas, "Courier New", monospace` | `--q-font-mono` |
| Display (GenieX only) | `alfabet` | *page token* — hero H1 and section H2 |

Note: nav items render in `qualcommNext`; body defaults to `Roboto Flex 16px/24px`.

### 1.2 Weights & width

Roboto Flex is variable — these are non-standard numeric weights, don't round them.

```
--q-font-weight-regular:        400
--q-font-weight-medium:         500
--q-font-weight-semi-bold:      560
--q-font-weight-bold:           660
--q-font-weight-extra-bold:     680
--q-font-weight-heading-subtle: 520

--q-font-stretch-normal: 110%   /* body */
--q-font-stretch-wide:   114%   /* metadata */
```

### 1.3 Type scale

**Headings** (`--q-font-heading-*`, `-subtle` variant swaps to weight 520 / 400)

| Step | Size | Line | Weight | Family |
|---|---|---|---|---|
| xxxl | 60px | 72px | 500 | brand |
| xxl | 44px | 52px | 500 | brand |
| xl | 36px | 44px | 660 | UI |
| lg | 28px | 36px | 660 | UI |
| md | 24px | 32px | 660 | UI |
| sm | 20px | 24px | 660 | UI |
| xs | 17px | 20px | 660 | UI |
| xxs | 14px | 16px | 660 | UI |

Heading letter-spacing: `--q-letter-spacing-heading: .01em`.

**Body** (`--q-font-body-*`, `-strong` = weight 560)

| Step | Size | Line |
|---|---|---|
| xxl | 21px | 32px |
| xl | 19px | 28px |
| lg | 17px | 26px |
| md | 16px | 24px |
| sm | 14px | 20px |
| xs | 12px | 16px |
| xxs | 11px | 14px |

**Metadata** — labels, chips, table headers. Weight 560 (`-strong` = 680), wide stretch, positive tracking. Also has `-mono` variants.

| Step | Size | Line | Tracking |
|---|---|---|---|
| xl | 16px | 20px | .48px |
| lg | 14px | 18px | .42px |
| md | 12px | 16px | .36px |
| sm | 11px | 14px | .33px |

**Eyebrow** — all-caps kickers above headings.

| Step | Size | Line | Tracking |
|---|---|---|---|
| l | 16px | 24px | .08em |
| m | 14px | 20px | .04em |
| s | 12px | 16px | .06em |

**Code** (`--q-font-code-*`, `-strong` = weight 500)

| Step | Size | Line |
|---|---|---|
| xl | 19px | 28px |
| md | 16px | 24px |
| sm | 14px | 20px |
| xs | 12px | 16px |

### 1.4 Color — core ramps

Every ramp runs `50 → 950`. Neutral additionally has half-steps (`00, 50, 100, 150, 200, 250, …, 950, 1000`).

**Neutral**
```
00 #ffffff   50 #fafbfc   100 #f5f6f7  150 #edf0f2  200 #e4e7eb
250 #dadce0  300 #cacdd1  350 #b7b9bd  400 #9ea0a3  450 #8b8c8f
500 #7c7d80  550 #6f7073  600 #636366  650 #59595c  700 #4f4f52
750 #434345  800 #343436  850 #2a2a2b  900 #202021  950 #151516
1000 #000000
```

**Brand (indigo — the primary accent)**
```
50 #eef3ff  100 #dee7ff  200 #acc3ff  300 #7ba0ff  400 #4076ff
500 #3253dc  600 #1e3bae  700 #162c83  800 #10216b  900 #0f1c52  950 #070f2c
```

**Blue**
```
50 #e9f2fc  100 #d2e5f9  200 #a5ccf3  300 #79b2ec  400 #4c99e6
500 #1c72c9  600 #1660ad  700 #134c86  800 #0f3b67  900 #0a2a4a  950 #06192d
```

**Red** `50 #fde7e9 · 100 #fbd0d3 · 200 #f7a1a8 · 300 #f3727c · 400 #ef4351 · 500 #e01b32 · 600 #bc101e · 700 #8d0c16 · 800 #5e080f · 900 #44050a · 950 #2f0407`

**Orange** `50 #fff3e6 · 100 #ffe6cc · 200 #ffce99 · 300 #feb567 · 400 #ffa444 · 500 #fe8a0e · 600 #db7305 · 700 #984f01 · 800 #663500 · 900 #442403 · 950 #331a00`

**Yellow** `50 #fef7e7 · 100 #ffeec6 · 200 #ffe29e · 300 #ffd86d · 400 #fac633 · 500 #eeb204 · 600 #cc9300 · 700 #996e00 · 800 #664900 · 900 #443301 · 950 #332600`

**Green** `50 #e4ffe4 · 100 #c6f0c7 · 200 #9bdd9d · 300 #6cc86f · 400 #55ab4d · 500 #368637 · 600 #306731 · 700 #224a23 · 800 #1d3f1e · 900 #163117 · 950 #102310`

**Teal** `50 #e0fffb · 100 #b9fbf3 · 200 #81e4de · 300 #55cccc · 400 #0eabab · 500 #247f85 · 600 #1a6b71 · 700 #145357 · 800 #0f3f47 · 900 #0c3137 · 950 #09252a`

**Purple** `50 #edebfa · 100 #dbd6f5 · 200 #b7aeea · 300 #a294ef · 400 #7764e2 · 500 #5e4bd1 · 600 #3c2aa2 · 700 #2d1f7a · 800 #1e1551 · 900 #181041 · 950 #0f0a29`

**Magenta** `50 #fbeaf1 · 100 #f7d4e3 · 200 #eeaac6 · 300 #e67faa · 400 #de548e · 500 #d2296f · 600 #ab215b · 700 #801944 · 800 #55112d · 900 #3a0b20 · 950 #2b0817`

### 1.5 Color — semantic

```
--q-semantic-primary:      #3253dc   (brand-500)
--q-semantic-secondary:    #7ba0ff   (brand-300)
--q-semantic-informative:  #3253dc
--q-semantic-positive:     #368637   (green-500)
--q-semantic-negative:     #e01b32   (red-500)
--q-semantic-warning:      #eeb204   (yellow-500)
--q-semantic-neutral:      #626b85
--q-semantic-pending:      #f68000
--q-semantic-running:      #dc4f81
--q-semantic-initializing: #b55fce
```

`pending / running / initializing` are job-state colors — reserve them for compile/inference job status, not generic UI.

### 1.6 Surface, text & border tokens

The system is **dual-mode by suffix**, not by media query. `-1` = light surface set, `-2` = dark surface set; `light`/`dark` names describe the *surface* the color sits on.

```
/* Surfaces */
--q-background-light-1..4:  #fafbfc  #f5f6f7  #edf0f2  #e4e7eb
--q-background-dark-1..4:   #151516  #202021  #2a2a2b  #343436

/* Text (on surface) */
--q-text-light-primary   #000000f2   --q-text-dark-primary   #fffffff2
--q-text-light-secondary #0000008c   --q-text-dark-secondary #ffffff8c
--q-text-light-disabled  #00000066   --q-text-dark-disabled  #ffffff66

/* Foreground — icons, dividers, non-text marks */
--q-foreground-light-primary   #000000   --q-foreground-dark-primary   #ffffff
--q-foreground-light-secondary #00000080 --q-foreground-dark-secondary #ffffff66
--q-foreground-light-disabled  #00000040 --q-foreground-dark-disabled  #ffffff40

/* Borders */
--q-border-light-subtle  #00000014   --q-border-dark-subtle  #ffffff14
--q-border-light-default #00000026   --q-border-dark-default #ffffff26
--q-border-light-strong  #0000004d   --q-border-dark-strong  #ffffff4d
```

Rule of thumb: **text** tokens cap at 0.95 alpha (`f2`) so copy never renders pure black/white; **foreground** tokens go fully opaque. Use text tokens for copy, foreground for icons and rules. The two ladders also step differently at the secondary/disabled tiers (text `8c`/`66` vs. foreground `80`/`40`) — swapping them will visibly shift icon weight.

There is also a surface-agnostic alias layer — `--q-background-1/2`, `--q-text-1-*`, `--q-foreground-1/2-*`, `--q-border-1/2-*` — that maps `1 → light` and `2 → dark`. Prefer the aliases in themable components so a theme switch is a single remap.

### 1.7 Elevation

```
--q-elevation-light-1: 0 1px 2px  #0003
--q-elevation-light-2: 0 3px 5px  #0003
--q-elevation-light-3: 0 5px 10px 1px  #0003
--q-elevation-light-4: 0 7px 20px 5px  #0003
--q-elevation-light-5: 0 20px 30px 15px #0003
/* dark variants identical geometry, #0006 alpha */
```

Levels 1–2 for resting cards and inputs; 3 for dropdowns/popovers; 4 for modals; 5 sparingly.

### 1.8 Radius

The base DS has no radius token scale — values are literal. Observed, in order of frequency:

| Value | Use |
|---|---|
| `4px` | buttons, badges, chips, inputs |
| `8px` | cards, media containers |
| `12px` | large feature panels |
| `9999px` | pills, segmented controls, avatars |

Recommend formalizing as `--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 9999px`.

### 1.9 Spacing & layout

4px base grid. Observed gap steps: `4, 6, 8, 12, 16, 20, 24, 32, 36, 40, 48, 60, 112`.

```
Section vertical rhythm:  60px (mobile)  →  96px (md+)
Prose max width:          800px
Card min width:           220px
Segmented control width:  480px max
Header height:            66px
Icon-row / list row:      31px
```

Icon sizes: `--q-icon-size-xs 12 · s 14 · m 16 · l 20 · xl 22`.

### 1.10 Breakpoints

```
--q-breakpoint-xxs:  360px
--q-breakpoint-xs:   640px
--q-breakpoint-s:    950px
--q-breakpoint-m:   1200px
--q-breakpoint-l:   1440px
--q-breakpoint-xl:  1920px
```

### 1.11 Motion

```
--q-transition-duration-fast:   .161s   /* default for all interactive states */
--q-transition-duration-normal: .3s
--q-ease-in-out: cubic-bezier(.23, 1, .32, 1)   /* decelerating, default */
--q-ease-quick:  cubic-bezier(.6, 0, .61, 1)    /* snappier, for toggles */
--q-default-ease: .161s var(--q-ease-in-out)

Property groups:
--q-transition-colors: background-color, border-color, color, fill, stroke, outline-color
--q-transition-shadow | --q-transition-opacity | --q-transition-transform
```

⚠️ `--q-transition-duration-slow` is declared as `600s` in the shipped CSS — almost certainly a typo for `.6s`. Don't use it; hard-code `.6s` if you need a slow tier.

### 1.12 Z-index

```
dropdown-arrow   999
modal-backdrop   990
dropdown        1000
sticky          1020
modal           1055
popover         1070
tooltip         1080
toast           1090
alert-banner    1100
```

---

## 2. Components

### 2.1 Button

Shared: `height 40px`, `radius 4px`, `font 14px/20px weight 500 (Roboto Flex)`, `gap 8–12px`, `transition var(--q-default-ease)`.

| Variant | Background | Text | Border | Padding |
|---|---|---|---|---|
| **Primary** | `#2d3ee0` | `#ffffff` | none | `0 20px` |
| **Secondary (on dark)** | transparent | `rgba(255,255,255,.85)` | `0.8px solid rgba(255,255,255,.3)` | `0 16px` |
| **Secondary (on light)** | transparent | `#303031` | `0.8px solid rgba(0,0,0,.2)` | `0 16px` |
| **Text link** | none | `rgba(0,0,0,.55)` | none | none, `hover:underline` |

Compound buttons (e.g. *Star on GitHub · 8.3K*) split with a `1px` divider at `rgba(255,255,255,.25)`, full 24px height, and carry a leading 20px icon.

Note the `0.8px` border width — it's deliberate and consistent across outline controls. Don't normalize it to 1px.

### 2.2 Badge / tag

```
height: 20px · radius: 4px · padding: 0 4px · gap: 4px
font: 12px, weight 500
```

Variants use a dark-tinted fill + light-tinted text from the same ramp:

| Variant | Background | Text |
|---|---|---|
| Info / "Hardware Optimized" | `#283c97` | `#b8ccff` |
| Neutral / "Community GGUF" | `rgba(255,255,255,.1)` | `rgba(255,255,255,.85)` |
| Highlight / "New" | `#f5f032` | `#0a0a0a` |
| Overline / "Developer Preview" | `rgba(255,255,255,.08)` | `#b8ccff` |

### 2.3 Card (model card)

```
min-width: 220px (renders ~270px)
height: 234px
radius: 8px
border: 0.8px solid rgba(255,255,255,.1)
background: rgba(255,255,255,.08)
overflow: hidden
```

Structure: 16:9 media block flush to the top edge → title (`16px/24`, weight 400, white) → badge row. Laid out in a `gap: 12px` scroll-snap rail (`snap-x snap-mandatory`) that becomes a grid at `lg`.

### 2.4 Segmented control (platform switcher)

```
Track:  max-width 480px · height 48px · radius 9999px · bg #efeff0 · padding 4px
Item:   flex-1 · height 40px · radius 9999px · padding 0 16px · 14px/20 weight 500 · gap 8px
Active: bg #ffffff · color #2a2aea · elevation-light-1
Rest:   transparent · color rgba(0,0,0,.55)
```

Each item takes a 16px leading platform glyph.

### 2.5 Pill / capsule label (hero diagram)

```
height: 48px · max-width 285px · radius 9999px
padding: 12px 16px · gap 8px
background: rgba(255,255,255,.02)
backdrop-filter: blur(7.5px)
border: 0.8px solid <accent>
```

Accent encodes source: `#7697ff` for first-party AI Hub models, `#fabb00` for community models. Connector lines use `#7697ff` at reduced opacity.

### 2.6 Header / nav

```
height: 66px · background #ffffff · border-bottom 1px var(--q-border-light-default)
Nav items: 24px tall, font Qualcomm Next 16px/24, color rgba(0,0,0,.95), 4px gap to caret
```

Product name pairs with a `New` badge inline. Account icon sits flush right. Collapses to a hamburger below `md`.

### 2.7 List row (feature index)

```
height: 31px · border-bottom 1px #e0e0e0
Left:  16px icon + 14px/20 label (#0a0a0a) + chevron
Right: 14px/20 description, color rgba(0,0,0,.55)
```

### 2.8 Section header

```
Eyebrow  — optional, uppercase, eyebrow scale
H2       — Alfabet 30px/34 weight 400, color #0a0a0a, centered   (page token)
Subhead  — Roboto Flex 20px/24 weight 500, color #636364, max-width 800px, centered
Gap      — 8px H2→subhead; 48–60px header→content
```

### 2.9 Hero

```
Background: #020b3f + starfield raster, responsive art direction per breakpoint
H1:  Alfabet weight 400, tracking -0.04em
     64px/1 (base) → 72px (sm) → 96px/110px (lg)
Sub: 30px, mixed weight — emphasized terms at full white, connectives at rgba(255,255,255,.5)
CTA: primary button, 40px tall, centered, 60px below sub
Base: radial gradient horizon separating hero from the card rail
```

---

## 3. GenieX page tokens

Hard-coded on the marketing page; not part of `--q-*`. Reproduced here so they can be lifted into variables.

```css
--gx-hero-bg:        #020b3f;  /* deep navy hero canvas */
--gx-cta:            #2d3ee0;  /* primary button fill */
--gx-accent-active:  #2a2aea;  /* active segmented-control text */
--gx-accent-line:    #7697ff;  /* diagram strokes, first-party accent */
--gx-badge-bg:       #283c97;
--gx-badge-fg:       #b8ccff;
--gx-gold:           #fabb00;  /* community-model accent */
--gx-highlight:      #f5f032;  /* "New" badge */

--gx-ink:            #0a0a0a;  /* headings on light */
--gx-ink-muted:      #636364;  /* subheads, secondary copy */
--gx-ink-soft:       #303031;

--gx-surface:        #ffffff;
--gx-surface-alt:    #fafafa;
--gx-surface-alt-2:  #f7f7f8;
--gx-surface-track:  #efeff0;  /* segmented control track */
--gx-surface-info:   #f0f4ff;  /* tinted diagram node */
--gx-surface-warm:   #fff8f0;  /* llama.cpp plugin node */
--gx-warm-accent:    #f5a623;

--gx-border:         #e0e0e0;
--gx-border-soft:    #dfdfe0;
--gx-border-faint:   #0000001a;
```

Diagram nodes follow a consistent tint pairing: `#f0f4ff` fill + brand-300 border for Qualcomm paths, `#fff8f0` fill + `#f5a623` border for community/llama.cpp paths. Keep that mapping — it's load-bearing for the architecture diagrams.

---

## 4. Usage guidance

**Do**

- Reach for `--q-*` tokens first; the ramps are complete and the semantic layer is well-factored.
- Pick text vs. foreground tokens by content type (copy vs. icons/rules), not by convenience.
- Keep `0.8px` borders and `.161s` transitions — they're the system's signature and reading as consistent matters more than round numbers.
- Use `metadata` type styles for badges, labels, and column headers; the wider stretch and positive tracking are what make small text legible here.
- Constrain prose to 800px and center it; the page never runs body copy full-bleed.

**Don't**

- Don't invent new accent hues. The ten ramps plus the semantic layer cover everything; the GenieX page's extra hexes exist for brand reasons, not gaps.
- Don't use `--q-transition-duration-slow` (declared `600s`).
- Don't apply job-state colors (`pending`, `running`, `initializing`) to general UI.
- Don't mix Alfabet into product UI. It's a marketing display face only — product headings use Qualcomm Next or Roboto Flex.
- Don't set text in pure `#000` / `#fff` for body copy; the `f2`-alpha text tokens exist for this.

**Accessibility notes**

- `--q-text-*-secondary` at `8c` (~55% alpha) sits near the AA floor on tinted backgrounds — verify per surface rather than assuming.
- The `#f5f032` highlight badge only meets contrast against near-black text; never invert it.
- Outline buttons on dark rely on a `.3` alpha border — pair with a visible focus ring, as the resting affordance is subtle.
