# Design system

Colours, type and radii live as tokens in `src/theme.css`. Pages never introduce new ones: a colour or size that a page needs and the tokens lack is added to the tokens first.

Every button and card on the site is built from the recipes and parts in `src/components/ui`. A page changes its look only when a recipe changes, so a fix to one page cannot drift the others.

## Recipes

`button(variant, size)` returns the classes for a button or a link styled as one. The primary variant is the green filled button and is used once per decision, for the action the page is about. The secondary variant is the outlined button for every other action. The quiet variant is underlined text, for a low-stakes link inside a panel. Sizes run from `sm`, the compact size used inside cards, through `md` and `lg` to `xl`, the tall call to action. Every size is at least 40 pixels high, so it can be tapped.

`card(tone, pad)` returns the classes for a bordered panel. The plain tone is the default. The strong tone marks a panel that needs the buyer, such as a hire waiting on their approval. The accent tone, a green border on a green wash, is kept for an answer the buyer should read first. Padding runs from `sm` to `xl`.

`cx(...)` joins class names, and `LABEL` is the small uppercase label that heads panels and slots. Layout classes such as margins and widths stay on the element and are added with `cx`, never folded into a recipe.

## Parts

`Action` is a button in any recipe, rendered as a link when it has a destination. `TextSlot` is a line of text that always takes its full height, empty or not, so slots line up across cards. `ResultBox` shows the opening of an answer with the rest behind a button, and gives up height before anything leaves its card. `RatingBoxes` are the five numbered boxes a rating is picked from and later shown in. `Dialog` holds anything longer than its slot and closes on Escape.

## Finish

Panels and filled buttons carry a quiet metal finish, defined as `--metal-*` tokens and utility classes in `src/theme.css`, with values for each theme. `metal` gives a bordered panel a lit edge over its border and a faint sheen across its face. `gloss` puts a highlight across the top of a filled green button, and `glow` a soft halo around a live status dot. The body carries faint scan lines. The `card` and primary `button` recipes include the finish, so a bespoke panel or filled button adds the class itself. A panel that is sticky or absolute keeps its own position, because the finish sets `relative` at zero specificity. The finish stays subtle, and a change to its strength is a change to the tokens, not to a page.

## Cards in a grid

A grid of cards shows three per row at most, two on a tablet and one on a phone. Cards in a grid share one fixed height and one order of slots, and anything that would not fit opens in a `Dialog` rather than stretching its card.

## What stays bespoke

A few elements keep their own classes because they belong to one place: the home page buttons in `src/components/buttons.tsx`, the dark compare bar, the navigation, quick search and the test token dialog. The quest corner is built from the recipes but floats over the page, so it adds its own background and shadow. Anything new uses the recipes.
