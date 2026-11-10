# Midnight

The house design system, extracted from Flux LP. It carries the midnight canvas, the frost hairlines, the violet action colour and the data-first type. It is dark only, by design.

Use it for the Agent Gallery and for the updated Agent Souk interface. Do not add a second palette beside it.

## Files

```text
src/tokens.css      colour, type, space, radius, motion and elevation tokens
src/base.css        reset, body, links, focus, layout utilities and type helpers
src/components.css  buttons, panels, cards, chips, fields, facts, metrics, tables,
                    notices, steps, tabs, hero, empty, skeleton and dialog
src/index.css       imports the three above
src/tailwind.css    maps the tokens into Tailwind v4 names
src/recipes.ts      typed class recipes: button(), card(), cx()
build.mjs           writes dist/midnight.css and apps/agents/system.css
check.mjs           contrast floor and generated-copy sync check
preview.html        every component on one page
```

## Use

In a bundler (Vite, Next):

```css
@import "@agora/design-system/index.css";
```

With Tailwind v4, import the bridge after the system:

```css
@import "@agora/design-system/index.css";
@import "@agora/design-system/tailwind.css";
```

Then use `bg-ds-canvas`, `text-ds-ink`, `border-ds-line` and the rest.

The package is not installed in the workspace yet. Add `"@agora/design-system": "*"` to the consumer package and run `npm install`.

The static gallery is deployed from `apps/agents`, so it carries a generated copy of the CSS:

```bash
node packages/design-system/build.mjs
```

Edit the source, run the build, and commit both. `check.mjs` fails when the copy is stale.

## Fonts

Load Inter, Space Grotesk and JetBrains Mono. The system uses:

```text
Inter 400/500/600          body and UI
Space Grotesk 500          display, titles, wordmark
JetBrains Mono 400/600     labels, data, status, actions
```

The gallery already self-hosts Inter. Add Space Grotesk and JetBrains Mono there.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ds-canvas` | `#05060f` | page |
| `--ds-surface` | frost 3% | panels and cards |
| `--ds-surface-raised` | frost 6% | hover and overlays |
| `--ds-line` | frost 8% | hairlines |
| `--ds-line-strong` | frost 14% | control borders |
| `--ds-ink` | `#d1e4fa` | primary text |
| `--ds-ink-dim` | `#c7d3ea` | secondary text |
| `--ds-ink-faint` | `#9da7ba` | labels and quiet text |
| `--ds-accent` | `#4f5cff` | the one action colour |
| `--ds-accent-text` | `#9aa6ff` | accent text on midnight |
| `--ds-on-accent` | `#ffffff` | labels on the accent fill |
| `--ds-good` | `#269684` | live and hold |
| `--ds-warn` | `#027dea` | widen and caution |
| `--ds-bad` | `#e46d4c` | error and exit |
| `--ds-focus` | `#b6d9fc` | focus ring |

Type, space, radius, motion and elevation are in `src/tokens.css`. Use them. A new colour or size is added to the tokens first, never to a page.

## Shape

The radius scale is the Flux card language, not a pill system.

```text
cards and panels      16px
marks and media       12px
buttons, fields, chips 6px
wallet and status pills 999px
```

Use `--ds-radius-lg` for a card, `--ds-radius-md` for a mark,
`--ds-radius-control` for a button or field, and `--ds-radius-pill` only for a
status or wallet pill.

## Rules

- **One primary action per decision.** The violet filled button is the action the page is about. Everything else is secondary, quiet or caution.
- **Dark only.** There is no light register. Do not add a theme toggle that flips these values.
- **44px targets.** Buttons, inputs and links that act like controls are at least 44px high. Small buttons keep a 40px minimum.
- **Visible focus.** Use the system focus ring. If a card is a link, the card carries the ring through `:focus-within`.
- **No overlap.** Cards are a single column of stacked blocks. Footers sit on their own row. Never position text over text.
- **Data in mono.** Addresses, amounts, token ids, tick ranges and statuses use JetBrains Mono with tabular numbers.
- **Say what is true.** No invented scores, no projected earnings, no state the surface cannot prove.
- **Respect reduced motion.** The base layer removes transitions and animations when the reader asks.
- **Contrast is checked.** `node packages/design-system/check.mjs` fails under 4.5:1 for text and 3:1 for the focus ring.

## Components

```html
<button class="ds-btn ds-btn--primary" type="button">Assess a position</button>
<a class="ds-btn" href="/pools">Open pools</a>

<div class="ds-panel">
  <header class="ds-panel__head">
    <h2 class="ds-panel__title">Position</h2>
    <span class="ds-panel__note">BNB chain</span>
  </header>
  <div class="ds-panel__body">...</div>
  <p class="ds-panel__foot">Read only.</p>
</div>

<article class="ds-card">
  <div class="ds-card__body">
    <div class="ds-card__mark"><img src="/mark.svg" alt="" /></div>
    <p class="ds-card__category">Rebalancing</p>
    <h3 class="ds-card__title">Flux LP</h3>
    <p class="ds-card__line">LP agent for tokenized stocks.</p>
    <p class="ds-card__status"><span class="ds-dot ds-dot--live"></span> live</p>
  </div>
  <div class="ds-card__foot">
    <a class="ds-card__link ds-card__link--primary" href="...">Open</a>
    <a class="ds-card__link ds-card__link--secondary" href="...">Hire on Agent Souk</a>
  </div>
</article>
```

`button()` and `card()` in `src/recipes.ts` return the same class strings for React consumers.

## Agent Gallery

- Four cards per row at 1200px and wider, two at 640px to 1199px, one below.
- Cards are equal height and share the same slot order: mark, category, title, line, status, foot.
- The primary link covers the card through `::after`. The secondary link sits above it and stays clickable.
- The page hero uses `ds-hero`, `ds-eyebrow`, `ds-display` and `ds-lede`.

## Updated Agent Souk UI

Adopt the tokens first, then the components. Keep the marketplace's data and routing; replace the green recipes with `ds-*` classes and the `button()` and `card()` recipes. The Tailwind bridge lets page layout keep using Tailwind while the colour, type and controls come from the system.

## Deliberately absent

Data fetching, icons, charts, routing, wallet UI and copy voice. Those stay with the product. The system carries the surface, the type, the controls and the states.

