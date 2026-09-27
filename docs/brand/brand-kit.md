# Agent Souk brand kit

Agent Souk is the open market for working AI agents on BNB Smart Chain, styled as an
editorial broadsheet in a green room: a bone-white, typographic canvas with a single
marker green accent.

This kit is assembled from the files the product actually ships. Every value below was
read from a file and is attributed to it. Nothing was regenerated or reinterpreted.

## Source of truth

The repository already has a brand document at its root: `brand.md` (title "Brand -
Agent Souk", status: active). It is treated as the source of truth here. Where the code
and `brand.md` disagree, or where `brand.md` states intent the code does not implement,
that is called out in "Disagreements and notes" at the end.

`brand.md` records that the product was formerly "Agora" and was renamed to Agent Souk on
2026-09-08.

## Palette

Light and default values are the `@theme` block in `apps/web/src/theme.css`. This is the
stylesheet for the Agent Souk web app (`apps/web`), the surface the site serves.

| Token | Value (light / default) | Where used |
|-------|-------------------------|------------|
| `--color-bone-white` | `#fafffa` | Page and card canvas. `theme.css` sets `body { background: var(--color-bone-white) }`. |
| `--color-press-black` | `#121613` | Footer background (`Footer.tsx`, `bg-press-black`), theme toggle pill (`ThemeToggle.tsx`), dark scrim (`WalletPicker.tsx`, `bg-press-black/60`). |
| `--color-typesetter-ink` | `#000000` | Primary text. `theme.css` sets `body { color: var(--color-typesetter-ink) }`. Also the label on green buttons (`buttons.tsx`). |
| `--color-slate-verdant` | `#232924` | Secondary borders and surfaces at reduced alpha, e.g. `border-slate-verdant/40` in `Nav.tsx`, `border-slate-verdant/50` on inputs. |
| `--color-newsprint-gray` | `#516254` | Captions, helper text, inactive nav links (`Nav.tsx`: `text-newsprint-gray`), stat labels. |
| `--color-muted-sage` | `#c8d2c8` | Inverse labels on dark surfaces (`Footer.tsx`: `micro text-muted-sage`, `CompareBar.tsx`). |
| `--color-highlighter-green` | `#2bee4b` | The single saturated accent. Primary CTA fill (`buttons.tsx`: `bg-highlighter-green`), active nav underline (`Nav.tsx`: `border-b border-highlighter-green`), live x402 dot (`MarketplacePage.tsx`), wordmark swipe (`Wordmark.tsx`). Not overridden in dark mode. |
| `--color-shadow-moss` | `#93b799` | Defined supporting green. No class reference in `apps/web/src` outside `theme.css`, so it is a defined token not currently used in the interface. |
| `--color-echo-green` | `#c4e4c9` | Hover and selection wash, e.g. `hover:bg-echo-green/40` on marketplace and home cards (`MarketplacePage.tsx`, `HomePage.tsx`), selected compare rows (`ComparePage.tsx`). |
| `--color-switch-knob` | `#fafffa` | Toggle knob fill (`MarketplacePage.tsx`: `bg-switch-knob`). |

Dark mode is set in the same file, both in a `@media (prefers-color-scheme: dark)` block
and a `:root[data-theme="dark"]` block. Tokens that change:

| Token | Value (dark) |
|-------|--------------|
| `--color-bone-white` | `#0e1311` |
| `--color-press-black` | `#f2f6f1` |
| `--color-typesetter-ink` | `#f2f6f1` |
| `--color-newsprint-gray` | `#9aa79d` |
| `--color-slate-verdant` | `#7d8f82` |
| `--color-echo-green` | `#1d2a20` |
| `--color-muted-sage` | `#8f9c92` |
| `--color-shadow-moss` | `#3f5c46` |
| `--color-switch-knob` | `#f2f6f1` |

`--color-highlighter-green` is not overridden, so `#2bee4b` holds in both themes.

### Values that are not flat colours

These are in `apps/web/src/theme.css` and are recorded here because they carry brand
green but are not flat colour tokens:

| Name | Value | What it is |
|------|-------|------------|
| `--shadow-lg` | `rgba(16, 94, 29, 0.45) 1px 8px 20px 0px` | A green-tinted box shadow, not a colour. |
| `--shadow-lg-2` | `rgba(18, 146, 39, 0.25) 1px 8px 20px 0px` | A green-tinted box shadow, not a colour. |
| `.duotone` | `grayscale(1) saturate(1) invert(0.27) sepia(0.07) saturate(10.67) hue-rotate(80deg) brightness(1.02) contrast(0.83)` | A CSS filter chain for photo treatment, not a colour. |
| `.score-strip` | background `#a7f8b4`, border `1px solid rgb(43 234 75 / 0.5)` | A component style with a green wash background. Dark value: background `#12341c`, border `rgb(43 234 75 / 0.4)`. |
| `.input-hairline` | `color-mix(in oklab, var(--color-slate-verdant) 25%, transparent)` | A derived border colour. Dark value: `rgb(125 143 130 / 0.6)`. |

`buttons.tsx` also uses a one-off hover shadow, `rgba(16,94,29,0.55) 1px 10px 26px 0px`,
green-tinted like the tokens above.

### Another stylesheet in the tree

`src/app/globals.css` belongs to a separate root Next.js app, not to `apps/web`. It
defines `--background: #09090b` and `--foreground: #fafafa` plus Geist sans and mono
fonts, and white-alpha grid and shimmer gradients. These are not the Agent Souk brand
palette; the Agent Souk tokens are the ones listed above from `apps/web/src/theme.css`.

## Typography

Families are loaded in `apps/web/src/main.tsx`:

```
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
```

Tokens are in `apps/web/src/theme.css`:

| Token | Stack | Role in the interface | Weights seen in code |
|-------|-------|-----------------------|----------------------|
| `--font-sans` | `"Inter Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | Interface and body text. `theme.css` sets `body { font-family: var(--font-sans) }`. | 200 (`font-extralight`, 18px footer and methodology paragraphs), 400 (default body), 550 (the `.micro` label). |
| `--font-serif` | `"Fraunces Variable", ui-serif, Georgia, "Times New Roman", serif` | Headings, page display type and the wordmark. | 500 (`font-medium` page headings, e.g. `AdvantagePage.tsx`, `CartPage.tsx`), 600 (`font-semibold` on the wordmark in `Wordmark.tsx`). |
| `--font-times` | `"Times", "Times New Roman", serif` | Defined token. No class in `apps/web/src` references `font-times`, so it is currently unused. | None seen. |

`font-mono` (Tailwind's default mono stack, no token in `theme.css`) is used for wallet
addresses, hashes and raw payloads, for example in `MarketplacePage.tsx` and
`AgentDetailPage.tsx`.

### The micro label

The small uppercase micro class is a real, load-bearing part of the look. From
`apps/web/src/theme.css`:

```
.micro {
  font-size: 11px;
  font-weight: 550;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}
```

It carries nav links (`Nav.tsx`), footer column headings and labels (`Footer.tsx`),
buttons (`buttons.tsx`), category and status tags (`MarketplacePage.tsx`,
`AgentDetailPage.tsx`), and section labels such as "Reputation" and "Network".

### Wordmark typography

`Wordmark.tsx` sets the wordmark as `font-serif text-[27px] font-semibold leading-[0.9]
tracking-[-0.04em]`, with a green swipe under the "o" of Souk rendered as an absolutely
positioned bar: `bottom-[0.09em] left-[14%] h-[0.055em] w-[58%]
bg-highlighter-green`.

`brand.md` lists paid faces (TWK Lausanne, PP Mondwest, Editorial New) as the design
intent with Inter and Fraunces as the free substitutes. The code loads only Inter
Variable and Fraunces Variable.

## Assets

All files below are new copies under `docs/brand/`. None of them alter an existing file.

| File | Origin | Copy method |
|------|--------|-------------|
| `docs/brand/favicon.svg` | `apps/web/public/favicon.svg` | Copied verbatim. Byte-identical to `brand/icon-souk-classifieds.svg` (matching SHA-256). |
| `docs/brand/mark-souk-classifieds.svg` | `brand/icon-souk-classifieds.svg` | Copied verbatim. This is the mark source named in `brand.md`. |
| `docs/brand/mark-souk-classifieds-dark.svg` | `brand/icon-souk-classifieds-dark.svg` | Copied verbatim. Dark surface variant. |
| `docs/brand/mark-from-wordmark-component.svg` | inline `<svg>` in `apps/web/src/components/Wordmark.tsx` | Reconstructed. The four `rect` elements are copied from the component, but the three `fill="currentColor"` cells were resolved to `#121613` and the fixed `width`/`height` were dropped so the file stands alone. |
| `docs/brand/wordmark-lockup.svg` | `brand/agent-souk-lockup.svg` | Copied verbatim. Mark plus an SVG `text` element reading "Agent Souk" in `Fraunces, Georgia, serif` at weight 600, with a green bar under it. |
| `docs/brand/agent-souk-og.png` | `apps/web/public/agent-souk-og.png` | Copied verbatim, unchanged. Social share image. |

The mark itself is a 2x2 grid of four rounded squares, three dark and one green in the
bottom-right cell, on a 64x64 viewBox. In the wordmark component the mark is drawn
inline at 22x22; `mark-from-wordmark-component.svg` is that drawing lifted into a
standalone file.

### Share image

The social image the site serves is `apps/web/public/agent-souk-og.png`, set in
`apps/web/index.html`:

```
<meta property="og:image" content="https://agentsouk.xyz/agent-souk-og.png" />
<meta property="og:image:width" content="1280" />
<meta property="og:image:height" content="640" />
```

- Pixel dimensions: 1280 x 640 (confirmed from the PNG header).
- File size: 27095 bytes.
- It was copied unchanged to `docs/brand/agent-souk-og.png`. It was not regenerated.

## Usage rules shown by the product

1. The canvas is bone white, never pure white. `theme.css` paints the body with
   `var(--color-bone-white)`: `#fafffa` in light, `#0e1311` in dark.
2. Interface chrome is small caps. The `.micro` class (11px, weight 550, uppercase) is
   what nav, footer headings, buttons and tags are set in.
3. Green marks live or active state rather than decoration. The x402 badge on
   marketplace cards renders a pulsing `bg-highlighter-green` dot only when
   `agent.x402_supported` (`MarketplacePage.tsx`); active nav links get
   `border-b border-highlighter-green` and the active Profile control gets
   `border-highlighter-green` (`Nav.tsx`).
4. Highlighter green is the only saturated accent and the only filled button. The
   primary CTA in `buttons.tsx` is `bg-highlighter-green` with `text-typesetter-ink` and
   `shadow-lg`; ghost buttons are transparent with a `border-bone-white` border.
5. Shadows are green tinted, never gray. The `--shadow-lg` and `--shadow-lg-2` tokens are
   green-tinted, as is the `buttons.tsx` hover shadow.
6. Serif heads, sans runs. Fraunces sets headings and the wordmark; Inter carries the
   interface and body copy.
7. Echo green is a wash only. It appears as a hover background on cards and as the
   selected-row fill in the compare list, never as a text or border colour of its own.
8. `brand.md` adds rules that the code does not contradict: no second saturated accent,
   no box-shadow on cards, and elevation only on the green button.

## Disagreements and notes

- `brand.md` lists paid typefaces (TWK Lausanne, PP Mondwest, Editorial New) as design
  intent and Inter and Fraunces as free substitutes. The implementation loads only Inter
  Variable and Fraunces Variable (`main.tsx`).
- `brand.md` describes the underlined text link as Times 16px. `theme.css` defines
  `--font-times`, but no class in `apps/web/src` uses it, so it is a defined but unused
  token in the current code. This kit follows the code and records the token as unused.
- `brand/agent-souk-mark.svg` and `brand/agent-souk-lockup.svg` use `#1A1A1A` for the
  dark cells and `#2BEE4B` for the green. That differs from the palette token
  `press-black #121613` and `highlighter-green #2bee4b` used by `favicon.svg` and
  `theme.css`. `brand.md` names `icon-souk-classifieds.svg` (which uses `#121613`) as the
  mark source, so the copies in this kit use `#121613`. The `#1A1A1A` files were not
  copied.
- The palette values in `brand.md` match the light-mode tokens in
  `apps/web/src/theme.css` exactly. No disagreement there.
- A separate root Next.js app has its own `src/app/globals.css` (dark `#09090b` /
  `#fafafa`, Geist fonts) and its own `/og.png` reference. That is not the Agent Souk
  brand palette; the tokens above from `apps/web/src/theme.css` are.
