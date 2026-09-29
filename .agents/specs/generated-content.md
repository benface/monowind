# Spec: generated content

Status: **implemented, 2026-09-28** (plan
2026-09-28-generated-content.md).

`::before` and `::after` on the grid: the text a `content` generates —
strings, `attr()`, counters and quotes — as its element's first and
last inline content, and a pseudo-element that is a box of its own —
a block, an atomic inline box, a float, an absolutely positioned
decoration — laid out and painted as an element of its kind would be.
Tailwind's `before:` and `after:` variants write them
(`before:content-['→_'] before:mr-1`, `after:absolute after:inset-x-0
after:bottom-0 after:h-1 after:border-b`). Probed 2026-09-28 in
Chromium, Firefox and WebKit (Playwright on macOS, the CDN bundle's
hosts at d77097e, and plain pages).

## Why

The grid drew no generated content, and the light DOM's went wrong
(probed, three engines):

- **Inline text was missing, and moved the native text.** A span's
  `before:content-['→_']` drew nothing on the grid, while the
  browser laid the `→ ` out: the span's text sat two cells right of
  the grid's, so its hits, caret and selection landed off its glyphs.
- **A decorative box painted natively, on top of the grid.**
  `before:absolute before:inset-0 before:bg-red-500` filled its box in
  pixels over the grid's cells, hiding the text it should sit behind:
  the companion's background, border and shadow locks matched
  elements, never a pseudo-element.
- **Counters counted nothing on the grid**, so a
  `before:content-[counter(step)]` step number was missing.
- **A scroll container's `::after` was the engine's** scroll spacer
  (scrolling.md): an author's `::after` there lost its content and
  box natively.

## Tailwind's utilities (4.3.3)

Each `before:` and `after:` utility compiles to a flat rule on its
class's pseudo-element that also sets `content: var(--tw-content)`
(`.before\:mr-1::before { content: var(--tw-content); margin-right:
var(--spacing) }`), `--tw-content` registered with `""` as its
initial value: any `before:` utility makes the pseudo-element, an
empty one unless `before:content-[…]` sets it (`content-['→_']`,
`content-[attr(data-label)]`, `content-[counter(step)]`,
`content-none`). A variant before it (`md:before:`, `hover:after:`,
`@md:before:`) nests the rule under its `@media` or `@container`, or
adds its pseudo-class. Preflight's `*, ::before, ::after` rule zeroes
margins, padding and borders and sets no `content`.

## What the engine reads

- **Which elements**: for each pseudo-element, those a rule that sets
  its `content` can match — the selectors of such rules in the host's
  root's and document's sheets (Tailwind's among them, under any
  condition, nested rules composed with their parents', the engine's
  own left out), the
  pseudo-element stripped, matched once per layout over the host — and
  `q` elements, whose quotes are the UA's. Reading both
  pseudo-elements of every element cost the prose page 5–9 ms (about
  4%, probed): a page without generated content reads none, and an
  element reads only the pseudo-element a rule names, each once a
  layout. The sheets are walked once each, with the `@counter-style`
  scan (sheets.ts).
- **Where**: every element the tree builds, a `button`'s included, but
  a form control's or a replaced element's (`input`, `select`,
  `textarea`, `img`, `video`, `audio`, `iframe`, `canvas`, `embed`,
  `object`), which draw none natively — but an `appearance: none`
  checkbox (all three engines) and a broken `img` (Chromium, probed;
  deviation 6).
- **`content`** (`getComputedStyle(el, "::before")`): `none` where
  there is no pseudo-element; strings (an `attr()` and a `var()`
  resolved to theirs — Chromium joins adjacent strings, Firefox and
  WebKit keep them apart), `counter()` and `counters()` as written,
  `open-quote`, `close-quote`, `no-open-quote` and `no-close-quote`,
  `url()` images, and alternative text after `/` (all three alike).
  The lists' `content` parser reads it (counters.ts `contentParts`).
  An inline pseudo-element that takes no cell — an empty `content`,
  as every `before:` utility leaves it, with no horizontal padding or
  margin, and no image — builds nothing.
- **The box**: `display`, `position`, `float`, sizes, insets,
  margins, padding and borders, as an element's (style.ts
  `readCellStyle` with a pseudo-element). Typed OM reads no
  pseudo-element, so its sizes, insets and margins are read as
  computed values — with no box for the one read
  (`data-mw-before-declared`: `display: contents`, which keeps its
  animations running where `none` would end them) — where an
  element's inline style is read, and its
  element's `before:` or `after:` classes where an element's class
  list is. The element's own reads skip those classes: the class scan
  would take `before:w-4` for the element's width.
- **Paint**: `color`, the glyph properties, `text-transform`,
  `letter-spacing`, `text-decoration`, `background`, `opacity`,
  `visibility`, `pointer-events`, as an inline element's (tree.ts
  `inlineEntry`) or a box's; a box's transforms and filters as a
  layer's (layers.md).
- **Counters**: its `counter-reset`, `counter-increment` and
  `counter-set`.
- **`quotes`**, which the pseudo-element inherits from its element:
  `auto` in all three by default, and the content language (`lang`).

## Generated text

- **An inline pseudo-element's text is its element's first
  (`::before`) or last (`::after`) inline content**, in its element's
  run: a span's around the span's text, a block leaf's around its
  text, a container's in an anonymous run before its first block
  child or after its last (cell-model.md "Inline content"), after an
  inside list marker where there is one (css-lists-3).
- **It is text like any other**: it wraps, aligns, justifies and
  truncates with its line, in its clusters' widths
  (wide-characters.md).
- **Its parts**: strings as written; `counter()` and `counters()` in
  their counter styles, without a prefix or suffix (lists.md "Counter
  styles"), from the counter walk; quotes from the build's quote depth
  ("Counters and quotes"); an image draws nothing (deviation 1).
- **Its own paint and spacing**, as a nested inline element's: its
  color, glyph properties, text transform, tracking, decoration,
  background, opacity and visibility; its horizontal padding and
  margins quantized to cells — margins as blank cells its background
  leaves bare — where an inline element's margins do nothing
  (cell-model.md deviation 5): `before:mr-1` spaces an icon from its
  text, and an empty one's padding and margins take their cells, as in
  CSS.

## Pseudo-element boxes

A pseudo-element whose `display`, `position` or `float` makes it a box
builds as an element of that kind would, its text the generated text:

- `display: block` (`flex`, `grid`, …): a block-level child before the
  element's first child or after its last; an inline element around it
  splits, as around a block child (cell-model.md "Inline content").
- `display: inline-block` (and its kin): an atomic inline box in the
  run.
- `position: absolute` or `fixed`: an out-of-flow box, positioned
  against its containing block as an element's is — `before:inset-0`
  on a `relative` element fills its padding box; with an axis
  unplaced, at its static position, inline or block as its display
  was before the position blockified it.
- `float`: a float, as float.md places one.

Its fill, borders, shadows and gradients paint as an element's, in its
paint phase — a decorative box behind the text it should sit behind,
over the fills before it — and its transforms and filters as a layer
of its own (layers.md). It takes its element's chain of decorations
and opacity, and the atomic boxes' order in its run, as an element in
its place would.

## Counters and quotes

- **The counter walk** (lists.md "Numbering") takes each pseudo-element
  as a record of its own, an empty one's included, in CSS's order: the
  element's own, its `::before`'s, its children's, its `::after`'s. It
  runs once a build, where a marker or generated text first reads a
  counter's value, and gives each writer every counter in scope.
- **Quotes**: the build writes them as it reaches them, in tree order —
  the element's marker, its `::before`, its children, its `::after` —
  from one quote depth, with no walk: `open-quote` draws the opening
  quote of its depth and deepens
  it, `close-quote` shallows it and draws that depth's closing quote,
  `no-open-quote` and `no-close-quote` move the depth alone, and a
  close at depth 0 draws nothing and stays there; past the last pair,
  the last repeats (probed). `quotes` pairs are read as given, none for
  `none`; `auto` takes the content language's pairs as Chromium
  carries them (probed, 2026-09-28: `de` `„ “ ‚ ‘`, `fr` `« » « »`,
  `fr-CA` `« » ” “`, `ja` `「 」 『 』`, … — fifteen sets over 36
  tags), the tag's own or, failing it, its first subtags', English's
  `“ ” ‘ ’` for any other (deviation 2). A list marker's `open-quote`
  draws from the same depth.

## Paint, hit, selection and copy

- **Paint order**: generated text paints with its line; a box in its
  phase, as an element in its place would.
- **Hit**: a generated cell's element is the pseudo-element's element
  — the hover chain, the cursor, a press — as the browsers hit an
  element through its pseudo-elements.
- **Focus**: a pseudo-element's box is no focusable element's; its
  inline text is its element's, whose focus rect holds it.
- **Selection and copy**: generated text is text of its run, where no
  browser selects or copies generated content (but Firefox's quotes,
  probed) — the user's call: a TUI's generated content is its text. A
  selection over it highlights it and the copy holds it, as the grid
  shows it. Its characters have no DOM position of their own: a
  `::before`'s stand just after its element's start (`(element, 0)`),
  an `::after`'s just before its end, so a range from the element's
  start, a paragraph gesture on it, or a drag begun on a generated cell
  holds its `::before`, and a range to its end its `::after`; one begun
  at its element's first character holds no `::before`, as a list
  item's partial first line holds no marker. A block
  pseudo-element copies with one line break around it, whatever its
  element.
- **Assistive technology** reads the light DOM's generated content,
  which stays authored.

## Animation

A pseudo-element's paint-only transition (`color`, `opacity`, …) lays
the host out each frame (animations.md); its keyframe animation, and a
transition of its transform or filter, show at the next layout
(deviation 5).

## The light DOM

- **A `::before` or `::after` takes the grid's font**, as every element
  does, and **one the engine reads takes its element's locks**
  (styles.css), gated on its element's read flag: no ink (its text
  its element's fill lock by inheritance; decoration color,
  background, borders, shadows), the grid's letter spacing, line
  height, white space and baseline, and its run's horizontal padding
  and margin cells; the transition mask while the flag is on; in grid
  mode, its element's pointer events. One it does not read — a
  replaced element's, a cross-origin sheet's — the browser draws as
  authored.
- **The engine's writes for a pseudo-element go on its element**,
  which gives it no inline style: its kind in the element's flag
  (`data-mw-before="text"`, `"image"`, `"flow"` or `"box"`), its variables
  under its name (`--mw-before-pl`, `--mw-before-x`, …), each kind's
  written whole, as the element's descendants inherit them
  (cell-model.md "Engine variables").
- **So its native box lies where the grid draws it**: inline text
  holds the grid's cells, the native text after it landing on the
  grid's; a box draws no text natively (`content: ""`), its box the
  engine's cells — absolute where the engine places it, so a box a
  press reaches natively (a card's stretched link over its border,
  `after:absolute after:-inset-1`) lies where the grid draws it, in its
  container's text run too; an atomic one in its line, aligned to the
  line's text row as the grid aligns it; a block one in a mixed
  container in the native flow a flow child takes, its margins the
  engine's, a formatting context's root contained. A block one in a
  multi-column flow keeps its text (`"flow"`), its native lines
  fragmenting as the grid's do, as a paragraph's there (multicol.md
  "Fragmenting text-leaf children"). One whose `content` holds an
  image draws none (`"image"`), as a marker's.
- **The scroll spacer** takes whichever pseudo-element the author
  leaves free (`data-mw-scroll="after"`, else `"before"`); a scroll
  container with both keeps its author's, its native range unpinned
  (`data-mw-scroll=""`, deviation 3).

## Deviations from CSS

1. An image in `content` draws nothing, on the grid or natively: the
   companion drops its pseudo-element's `content`, its text and
   alternative text with it, from the light DOM, as a marker's
   (lists.md deviation 3).
2. `quotes: auto` draws Chromium's pairs in every engine — English's
   for a language Chromium carries none for — where Firefox and WebKit
   carry their own, for more languages.
3. A scroll container with both a `::before` and an `::after` of its
   own leaves its native scroll range to the browser, whose end edge
   the engines disagree on (scrolling.md): its native ceiling may sit
   a row off the engine's.
4. `::first-letter` and `::first-line` are not read: their text draws
   in its element's style.
5. A pseudo-element's keyframe animation, and a transition of its
   transform or filter, show at the next layout: the engine samples
   elements' frames alone.
6. An `input`'s and an `img`'s pseudo-elements are not read: an
   `appearance: none` checkbox's `::before` (a custom checkbox) draws
   nothing on the grid.
7. Quote depth begins at the host, as counters do (lists.md
   deviation 5), and counts the quotes the grid draws: an element the
   layout drops (`sr-only`) moves none.
8. A pseudo-element's box never scrolls: an `overflow` that would
   scroll it clips.
9. An inline pseudo-element's `position: relative` or `sticky`, and
   its `z-index`, do nothing: it lays out static, where a nested
   inline element's apply.
10. A cross-origin sheet's rules are not read, as its `@counter-style`
    rules are not (lists.md deviation 1): a pseudo-element only it
    gives content draws nothing on the grid.
11. A rule under `@scope` is matched from the host: one naming `:scope`
    reads the host alone.
12. The host's own `::before` and `::after` are not read, nor locked.
13. A `content` rule the CSSOM inserts deeper than a sheet's top level
    applies once that sheet's top-level rules change, as a
    `@counter-style` rule does (lists.md deviation 7).

All cell-model deviations apply, the font the root's (3) first.

## Testing

- **Node** (`generated-content.test.ts`): the rule scan and the
  selector match (Tailwind's flat rules, stacked variants, container
  queries, nested ones, `q`); each `content` part; a pseudo-element's
  reads — its variant's classes alone, its declared lengths, each
  pseudo-element and marker once a build; inline text in a span, a leaf
  and a container, its padding and margin cells, its color, an empty
  one's cells and image; a box of each kind, a block one splitting its
  inline element, its decorations, opacity, order, static position,
  flex static slot, layer and clip, built once; the counter walk with
  pseudo-elements, once a build, quotes without it to three levels in
  five languages and `quotes`, a marker's quote; the character
  mapping, the highlight and the copy of text and boxes; hit and
  focus; a button's, an input's and an img's; the render's writes
  for each kind (a block one in a multi-column flow, split by a
  spanner or not), their clearing, and the scroll spacer's side.
  `cascade.test.ts` checks the variables the companion reads on a
  pseudo-element against those its kind writes; `render.test.ts` a
  box in a container's text run.
- **Storybook** (`generated-content.stories.ts`, three engines):
  "Generated Content" — icons after and before links, a required
  field's `*`, an `attr()` badge, numbered steps, nested and French
  quotes; its play reads the rows, the links' underlines, and each
  element's native glyphs on the grid's cells (the generated text
  between them the grid's alone). "Pseudo-Element Boxes" — a
  decorated heading, and a card's block `::before` title and its link
  stretched over the card, its border included; its play reads the
  rows, the underline, the native glyphs, and the stretched link's
  native box at each edge and past it. Each a golden. "Generated
  Content Transition", test-only:
  a pseudo-element's transition through its layouts, and its box's
  pointer events in grid mode. "Generated Content Native Text",
  test-only: the native glyphs beside and after each kind of box — a
  float, a middle- and a bottom-aligned atomic one, a block one in a
  mixed container, and in a multi-column flow, split or not — on the
  grid's cells.
- **Visual**: their goldens; `visual/generated-content.spec.ts`, a press
  on the stretched link's card border and past the card, with trusted
  input.
- **Bench**: `labels` — 300 paragraphs, each numbered by a counter
  `::before` and marked by an `::after` (performance.md).

## Touch points on implementation

- sheets.ts: the walk of the page's sheets (`sheetRules`, cached per
  sheet), the `content`-setting pseudo-element rules' selectors among
  what it collects, by pseudo-element.
- generated.ts: the elements each pseudo-element may give content
  (`generatedElements`), the pseudo-element read (`readGenerated`,
  `GeneratedNode`, `GeneratedText`), `quotes`' pairs with Chromium's
  language table (`quotePairs`), and the quote depth (`quoteWriter`).
- style.ts: `readCellStyle` with the build's reads (`BuildReads`): a
  pseudo-element's box from the declaration its read found — its
  variant's classes (`authoredClasses`, which also keeps them off its
  element's reads), its declared lengths (`declaredLengths`), no
  element-only reads, its overflow clipped — and the markers read so
  far (`markerOf`), which the counter walk shares.
- counters.ts: `QuotePart`s among `content`'s parts (`isQuote`,
  `holdsImage`), and the walk's pseudo-element records (`countersOf`).
- tree.ts: the pseudo-elements among an element's child nodes, read
  once a build and those shown (`shownChildNodes`, `pseudoElementsOf`),
  a block one splitting its inline element (`hidesBlock`), inline text
  in runs (`collectGenerated`, `pushText`), boxes (`buildGeneratedBox`),
  their order (`compareOrigins`), static read and chains, the text once
  a build with its quotes and counters (`generatedText`, `withQuotes`,
  `contentText`), and the pseudo-elements an element's author gives
  content (`LayoutNode.authoredPseudos`).
- types.ts: `QuotePart`, `LayoutNode.generated`, `InlineElement.pseudo`,
  `CharSourceRun.pseudo` (`domLength`), a box's parent element
  (`parentElementOf`) and key across layouts (`boxKey`).
- glyphs.ts: a computed style's glyph set (`glyphSetOf`).
- selection.ts: a pseudo-element's characters at its element's edge
  (`charIndexAt`, `positionOf`, `leafExtent`), no point of its
  element in its atomic box, one break around a block one.
- layout.ts: a pseudo-element's flex static slot (`parentElementOf`).
- paint.ts: a pseudo-element's layer, keyed apart from its element's,
  its effects read from it.
- pointer.ts: a held layer found by its box (`sameBox`).
- render.ts: a pseudo-element's kind and variables on its element
  (`writePseudo`, `writePseudoBox`, `PSEUDO_NAMES`), their clearing
  where a layout made any (`writtenPseudoElements`), the scroll
  spacer's side, and a run's box against its container.
- element.ts: a pseudo-element's transitions settled with its
  element's.
- styles.css: the pseudo-elements' locks, a box's cells, the
  declared-length and static reads, the image lock, the transition
  mask, grid mode's pointer events, and the spacer on either
  pseudo-element.
- animation.ts: `nodeIndex` leaves an element's node its own.
- focus.ts: a pseudo-element's box takes no focus of its element's.
- top-layer.ts: a pseudo-element's box is no top-layer entry.
- plain-text.ts: a pseudo-element's inline text in its element's rects
  (`inlineElementRects`).
