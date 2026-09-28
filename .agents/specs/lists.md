# Spec: list markers

Status: **spec, 2026-09-27** — not implemented.

List items' markers on the grid: the bullets and numbers of `ul`, `ol`
and `menu`, `summary`'s disclosure triangle, and any element that is
`display: list-item`, with Tailwind's `list-*` utilities and its
`marker:` variant. The engine reads the list styles, numbers the items
itself, and paints each marker's text in whole cells where CSS places
it; the light DOM keeps its lists, their native markers invisible and
out of the text's way. Probed 2026-09-27 in Chromium, Firefox and
WebKit (Playwright 1.63 on macOS, Menlo at 16px; the light DOM through
the 0.3.3 CDN bundle), and again 2026-09-28 for the inside marker's
line and `details` — "Browser agreement".

## Why

Numbered steps, bulleted notes, a `<details>` toggle: a TUI draws them
as text, and Tailwind ships the utilities. Today the grid draws no
marker — preflight sets `list-style: none` on `ol`, `ul` and `menu`,
and restoring it with `list-disc` draws nothing — and the light DOM
goes wrong three ways (probed, three engines):

- **An inside marker moves the native text.** It pushes the native
  first line right by its own advance — `1. ` three cells, a disc
  2.28, 1.60 and 1.56 (Chromium, Firefox, WebKit) — so the native
  text, a link's hit box, the caret and find-in-page sit off the
  glyphs the grid paints from the line's start. `summary`, whose
  disclosure marker the UA puts inside, drifts 1.76, 1.46 and 1.66
  cells in every host today.
- **An image marker shows.** `list-style-image` and a `url()` in a
  marker's `content` paint natively, off the grid: an image ignores
  the text-fill lock that hides every other marker, Chromium's drawn
  disc, circle and square included.
- **`marker:text-lg` escapes the font lock**, which matches no
  pseudo-element: the inside marker widens (`1. ` takes 3.8 cells),
  and an outside one grows the native first line (48px in Chromium,
  60px in Firefox and WebKit, for a 40px marker at 60px leading).

## Tailwind's utilities (4.3.3)

| Utility                                  | CSS                            |
| ---------------------------------------- | ------------------------------ |
| `list-disc`, `list-decimal`, `list-none` | `list-style-type`              |
| `list-inside`, `list-outside`            | `list-style-position`          |
| `list-[upper-roman]`                     | `list-style-type: upper-roman` |
| `list-['→_']`                            | `list-style-type: '→ '`        |
| `list-(--name)`                          | `list-style-type: var(--name)` |
| `list-[--name]`                          | `list-style-type: --name`      |
| `list-image-[url(…)]`, `list-image-none` | `list-style-image`             |
| `marker:text-red-500`                    | `color` on `::marker`          |
| `marker:font-bold`                       | `font-weight`                  |
| `marker:text-lg`                         | `font-size`, `line-height`     |
| `marker:content-['→']`                   | `content: var(--tw-content)`   |

- No `list-circle`, `list-square` or `list-roman`: other types are
  arbitrary values, and `list-[--name]` names a counter style, not a
  variable.
- `marker:` compiles to `.x ::marker, .x::marker` (with
  `::-webkit-details-marker` twins): on a list it styles every marker
  below it, a nested list's included.
- Preflight, in `@layer base`: `ol, ul, menu { list-style: none }`
  with zero margin and padding, and `summary { display: list-item }`.
  A layered rule beats HTML's presentational hints, so under preflight
  `<ol type="a">` computes `none` in all three engines, while
  `<li type="i">` computes `lower-roman`. Without preflight the UA's
  `ul` is a disc list with 40px (ten cells) of padding, nested lists
  `circle` then `square`.

## What the engine reads

- **A list item** is an element whose computed `display` holds
  `list-item` (`list-item`, `flow-root list-item`): an `li`, a
  `summary`, a `div` with the `list-item` utility. An `li` made `flex`
  or `grid` is none: no marker, no count, as in CSS.
- Its `list-style-type` and `list-style-position`, and its
  `::marker`'s computed `content`, `color`, `font-weight` and
  `font-style` (`getComputedStyle(el, "::marker")`). All three
  engines honor a marker's `color`, `font-weight`, `font-size`,
  `line-height` and `content` (strings, `var()`, `counter()`, `none`)
  and report each; `content` resolves `var()` to its string and keeps
  `counter()` as written. A reader that gets no `::marker` style
  (happy-dom returns the element's own, `content` empty) reads
  `normal` and the item's color.
- **No engine exposes a marker's text**: `content` reads `normal` for
  a default marker, and no range or `innerText` holds one. The engine
  generates it ("Marker text", "Numbering").
- Every element's `counter-reset`, `counter-set` and
  `counter-increment`. HTML's `ol[start]`, `ol[reversed]` and
  `li[value]` are presentational hints that only Firefox shows in the
  computed values — a `counter-reset` of `list-item 4` for `start=5`
  and of `reversed(list-item) 11` for `reversed start=10`, a
  `counter-set` of `list-item 7` for `value=7`; WebKit shows `value`'s
  alone, Chromium none. The engine reads the attributes — `start`
  itself, as the IDL reads 1 for a reversed list without one.
- `list-style-image` is not read (deviation 3).

## Marker text

- `::marker { content: none }`: no marker.
- **A `content` of strings and counters** — `counter()` and
  `counters()` with a style or without; an `attr()` computes to its
  string in all three — draws its text, even where `list-style-type`
  is `none` (all three draw it). An image in it draws nothing
  (deviation 3), nor does a quote (deviation 8).
- **`normal`** draws from `list-style-type`: a string as written, no
  suffix added (`list-['→']` is one cell, touching the text); a
  counter style's representation of the item's `list-item` value;
  nothing for `none`.

### Counter styles

- The engine runs css-counter-styles-3's algorithm — the `cyclic`,
  `fixed`, `symbolic`, `alphabetic`, `numeric` and `additive`
  systems; `prefix`, `suffix`, `range`, `pad`, `negative` and
  `fallback` — over its "Simple Predefined Counter Styles", carried
  as data. The common ones, the same cells in all three engines
  (probed at 0, 1, 4, 9, 10, 26, 27, 49, 100, 3999, 4000 and −3):

  | Type                    | 1      | 27        | Others                 |
  | ----------------------- | ------ | --------- | ---------------------- |
  | `disc`                  | `• `   | `• `      | every ordinal          |
  | `circle`                | `◦ `   | `◦ `      | every ordinal          |
  | `square`                | `▪ `   | `▪ `      | every ordinal          |
  | `disclosure-open`       | `▾ `   | `▾ `      | every ordinal          |
  | `disclosure-closed`     | `▸ `   | `▸ `      | every ordinal          |
  | `decimal`               | `1. `  | `27. `    | −3 `-3. `              |
  | `decimal-leading-zero`  | `01. ` | `27. `    | 0 `00. `, −3 `-3. `    |
  | `lower-alpha`, `-latin` | `a. `  | `aa. `    | 0 `0. `, −3 `-3. `     |
  | `upper-alpha`, `-latin` | `A. `  | `AA. `    | 0 `0. `, −3 `-3. `     |
  | `lower-roman`           | `i. `  | `xxvii. ` | 3999 `mmmcmxcix. `     |
  | `upper-roman`           | `I. `  | `XXVII. ` | 4000 `4000. `, 0 `0. ` |
  | `lower-greek`           | `α. `  | `αβ. `    | 0 `0. `                |

  An ordinal outside a style's range draws in its fallback, `decimal`:
  0 and the negatives for the alphabetic and roman styles, and past
  3999 for the roman ones. A sign counts toward
  `decimal-leading-zero`'s pad.

- **Every glyph listed is one cell** (width.ts), and Menlo draws each
  at one cell in all three engines; a font without one is boxed onto
  its cell (wide-characters.md). The browsers draw disc, circle,
  square and the triangles as shapes, not glyphs (a disc's inside
  advance: 2.28, 1.60, 1.56 cells), which css-counter-styles-3
  allows; the grid draws the symbol and its suffix's space.
- **An `@counter-style` rule** is read through the CSSOM, whose
  `CSSCounterStyleRule` all three engines expose: the host's document's
  same-origin stylesheets, again when their list changes, each rule's
  system, symbols, range, negative, pad, prefix, suffix and fallback
  run by the same algorithm. A name the engine does not carry — a
  cross-origin sheet's rule, a complex predefined style's, Firefox's
  `symbols()` — draws as `decimal`, CSS's own fallback for an
  undefined name (deviations 1 and 2).
- **Symbols come from the list item's glyph set** (theming.md): the
  glyph tables carry the marker roles `disc`, `circle`, `square`,
  `disclosureOpen` and `disclosureClosed` on the solid table, as they
  carry the scrollbar's, falling back per glyph to the defaults above
  and honoring `--mw-missing-glyphs`; `ascii` maps them to `* o # v >`,
  `cp437` to `• ○ ■ ▼ ►`. The item owns its marker, so its set
  resolves it. A string, a numeral or a letter is the author's text,
  never remapped.

## Numbering

- **CSS Lists 3 counters, computed by the engine** in one walk of the
  host's light DOM in tree order, after the read. An element with
  `display: none` counts nothing, its subtree with it, as natively;
  one the layout tree drops (`sr-only`) counts, as do floated,
  out-of-flow and `visibility: hidden` items (probed). The contents a
  box skips (visibility.md "Skipped contents") count nothing past it:
  a closed `details`'s ("`details` and `summary`"), and a
  `content-visibility: hidden` box's, whose style containment keeps
  its counters inside it (css-contain-2).
- **Per element, in CSS's order**: `counter-reset` makes a counter
  scoped to the element's descendants and following siblings, then
  `counter-increment`, then `counter-set` — so `<li value=7>` is 7 and
  the next item 8. A counter incremented or set with none in scope is
  made on that element at 0: list items outside any list count 1, 2.
- **A list item increments `list-item`** by 1, −1 in a reversed
  counter's scope, unless its computed `counter-increment` names
  `list-item` (`summary`'s UA `list-item 0` keeps it out of the
  count). The walk tracks every counter a marker's `content` names,
  `list-item` among them, by the same rules.
- **HTML's lists**: `ol`, `ul` and `menu` reset `list-item`, an `ol`
  with `start` to `start − 1`. A `reversed` `ol` resets a reversed
  counter to `start + 1`, or without `start` to the value that counts
  back from the scope's end: the last item gets the negation of its
  increment (1), each earlier one the next one's value less the next
  one's increment, and a `value` restarts the count at itself
  (css-lists-3). `li[value]`, an integer, sets `list-item`.
- **Author CSS beats the hints**, as the cascade ranks them: a list's
  computed `counter-reset` or an item's `counter-set` naming
  `list-item` applies instead of the attribute.
- **The engines agree** on start, a zero or negative start, reversed
  with and without start, values up and down, nested lists, items of
  flex and grid lists, `hidden` and `display: none` items (skipped),
  `visibility: hidden`, absolute and floated ones (counted), a `div`
  between items, `counter-set` and `counter-increment` on items, and
  list items outside a list. Where they split, the engine follows CSS,
  as Firefox does, in all but the last case:
  - `<ol reversed><li><li value=10><li>`: 11 10 9 in Firefox and
    WebKit, 3 10 9 in Chromium.
  - `counter-reset: list-item 4` on a list, or on any element: 5 6 in
    Firefox and WebKit; Chromium ignores it (1 2), and keeps a list's
    `start` over it.
  - A list whose `counter-reset` names another counter, or `none`:
    Firefox continues the outer count, Chromium and WebKit restart —
    as the engine does (deviation 4).

## `details` and `summary`

- **A `details` without `open` shows its first `summary` alone**
  (visibility.md "Skipped contents"), and its list items count
  nothing, as in Chromium and Firefox (WebKit counts them; probed
  2026-09-28).
- **`summary`** is `display: list-item` with an inside
  `disclosure-closed` marker, `disclosure-open` in an open `details`,
  and `counter-increment: list-item 0` (the UA's, computed so in all
  three); `::marker` styles it in all three engines, WebKit included,
  and `::-webkit-details-marker` in none (probed 2026-09-28).

## Placement

### Outside, the initial value

- **The marker ends at the item's border-box start**, on its first
  line's row: `1. ` fills the three cells left of the edge, its
  suffix's space the gap; `9. ` and `10. ` end in the same cell, the
  wider starting one further out; a string with no trailing space
  touches the edge. The item's padding widens the gap and moves its
  text alone; its margin moves both (probed, three engines alike).
- **`text-indent` and `text-align`** move the text, not the marker.
- **Floats**: where floats beside the item shorten its first line, the
  marker's end moves in by as much — a leaf item's first band offset
  (float.md) — hugging the float: an 8-cell float over a list with 3
  cells of padding puts the end 5 cells into the item, 3 with 2 cells
  of item padding (probed). A float inside the item moves nothing. An
  item that is a container is a formatting-context root (float.md
  deviation 2) and steps aside from the float, its marker then over
  the float's cells, as Chromium and Firefox draw a
  `flow-root list-item`.
- **The first line is the one CSS takes the item's first baseline
  from**: the first line box of its in-flow content, looking into
  blocks, flex and grid
  containers, scroll containers, multicol containers and atomic
  inline boxes, past boxes with no line (an empty block above the
  text), floats and out-of-flow boxes (probed, three engines); in a
  table, its first row's (Chromium, Firefox; WebKit keeps the marker
  on the item's first row).
- **No line**: an item whose in-flow content has no line box carries
  its marker on its first content row, adding no height; an item with
  no in-flow content — empty, or holding only out-of-flow boxes — is
  one row tall, the marker's line, unless a height says otherwise (all
  three). An item holding only an empty block is 0 rows in Firefox
  and WebKit, 1 in Chromium: the engine gives 0.
- **No room**: the marker lands where this puts it — in the list's
  padding (`pl-6` holds `10. `), over a neighbor, or past the host's
  left edge, which has no cells: it is dropped, as all ink left of the
  host is (cell-model.md "Overflow"), where a page shows it in the
  margin beside the box. Preflight zeroes a list's padding, so
  `list-disc` alone puts every marker there, as it puts them left of
  the list's box natively.
- **Clips**: the item's own clip cuts its outside marker (an
  `overflow-hidden` item draws none, in all three), and so does every
  ancestor's.

### Inside

- **The marker is the item's first inline content**: its cells open
  the first line after `text-indent`, the line wraps at the width less
  both, later lines start at the content edge, and `text-align` moves
  the marker with its line (probed, three engines).
- **An item that starts with a block** — a `div`, a nested list —
  holds its marker on a line of its own above it: an anonymous run of
  the marker alone (cell-model.md "Inline content"). An empty item is
  one row, the marker's.
- **Wrapping**: `text-wrap: balance` and `pretty` count the marker's
  cells on the first line as they count an equal `text-indent`
  (probed, three engines).
- **Justification**: the marker's spaces are the line's justification
  opportunities, sharing its leftover with the text's gaps by the
  rounded spread (cell-model.md "Text alignment"), as Chromium and
  Firefox spread it; WebKit leaves the marker's spaces alone.
- **Truncation** keeps the marker and cuts the text after it; a box
  narrower than the marker cuts the marker too, its last visible cell
  the `…` (Chromium, Firefox; WebKit keeps the marker whole).
- **Line clamps**: a clamped item is no list item — `line-clamp-*`'s
  `-webkit-box` computes `flow-root` (`-webkit-box` in WebKit), so it
  draws no marker in all three. A clamp on a block inside the item
  keeps the marker, on its own line above that block.

### Both

- **The marker's cells** are its clusters at their widths, each
  advancing like the item's text, tracking included: all three
  engines apply the item's `letter-spacing` to its marker
  (`tracking-wide` gives `1. ` six cells).
- The `::marker`'s own `letter-spacing`, `text-transform`,
  `background` and `padding` are not read: css-pseudo-4 applies none
  of them to a marker (Firefox honors none; Chromium and WebKit apply
  its `letter-spacing`).

## Paint

- **Color, weight and style are the `::marker`'s**, inheriting the
  item's; a translucent color composites as text does, and a marker
  that inherits its color follows the item's sampled color through a
  transition (cell-model.md "Animation").
- **The font is the root's**, as every glyph's (cell-model deviation
  3); `marker:text-lg` warns through the inner font-size warning,
  whose class scan already matches it.
- **Decorations**: an inside marker shows the lines its item
  propagates, as Chromium and Firefox underline one (WebKit does not);
  an outside marker shows none (all three).
- **Visibility and opacity are the item's**: the marker inherits its
  visibility and paints in its group.
- **Paint order**: the marker is its item's first inline content
  (css-lists-3), so it paints in its stacking context's inline-content
  phase — over every in-flow block's fill and over the floats, under
  positioned boxes (positioning.md "Paint order") — at the start of
  its item's content turn, before the item's text.
- **Hit**: a marker's cells are its item's — the hover chain, the
  cursor, a press — as the browsers hit an item on its marker
  (`elementFromPoint`, three engines).
- **Selection** never highlights a marker: it is no DOM text, and no
  browser highlights one.

## The light DOM

- **Native markers stay invisible** by the text-fill lock they
  inherit — every type, Chromium's drawn shapes included — but for
  images, which the companion locks off: `list-style-image: none` on
  every light element (measuring-gated), the native marker falling
  back to its invisible type; and a list item whose marker `content`
  holds an image carries `data-mw-marker-image`, under which its
  native marker's `content` is `none`.
- **Native markers take no line space**: every light element is
  `list-style-position: outside` (gated), and the engine hands an
  inside marker's cells to the native line as text-indent — `--mw-ti`
  holds the authored indent plus the marker's cells, and on a
  justified line its spaces' share of the spread, on the element whose
  first line the marker opens — so the native first line starts under the
  grid's. Probed with the rules injected into a host: the
  lock takes every drift to 0, `summary`'s too, and the indent puts
  the native text where an authored indent of as many cells does, in
  all three.
- **The marker's native font is the root's**: `::marker` inherits
  `font-family`, `font-size` and `line-height` (ungated, as the font
  lock is).
- **Type and text content stay authored**, so assistive technology
  reads the author's marker: Chromium's accessibility tree names each
  `ListMarker` (`1. `, `• `) inside or outside and under the fill
  lock, and the type's text where the image is gone.
- **An interactive item's native marker hangs left of its box**, in
  cells where the grid shows something else: a press there is the
  grid's, by the covered rule (cell-model.md "Pointer states").

## Selection, copy and accessibility

- **A marker is no text in any engine**: `innerText`, `textContent`,
  `Selection.toString()` and a real copy leave it out in all three;
  Firefox's copy indents each item four spaces instead (probed).
- **Text mode copies no marker**: the engine's copy serializes leaves'
  text by the `innerText` rules (semantic-selection.md), and a marker
  is no text of its leaf. Grid mode copies the rows it shows, markers
  included — what you see.
- **A marker cell holds no character of its leaf**: a word or
  paragraph gesture there falls to the browser's gesture on the grid,
  as one on a leaf's padding does (semantic-selection.md).
- **Assistive technology reads the light DOM's lists** as authored,
  their native markers included.

## Interplay

- **Multicol**: an item distributed into a column hangs its outside
  marker into the gap or the column before, as natively; a text-leaf
  item fragmented across columns (multicol.md "Fragmenting text-leaf
  children") carries its marker on its first fragment's first line.
- **Flex and grid items**: an item of a flex or grid list keeps its
  marker, hanging over the gap or the previous item (probed).
- **Scrolling, sticky and relative items**: the marker is its item's
  content, and scrolls, sticks and shifts with it.
- **Direction**: markers go left, the engine laying out left to right
  (cell-model deviation 18).

## Deviations from CSS

1. An `@counter-style` rule in a cross-origin stylesheet is not read:
   a style it defines draws as `decimal`. The CSSOM hides such a
   sheet's rules.
2. The complex predefined counter styles (`cjk-ideographic`,
   `japanese-formal`, `korean-hangul-formal`, `simp-chinese-informal`,
   `ethiopic-numeric`, …) and Firefox's `symbols()` draw as `decimal`:
   the engine carries the simple predefined styles alone.
3. The grid draws no image: a `list-style-image` marker draws its
   `list-style-type`, as CSS draws it when the image fails to load,
   and an image in a marker's `content` draws nothing.
4. A list whose `counter-reset` names other counters, or `none`, still
   resets `list-item`, where CSS lets the author's value replace the
   UA's reset. The cause: the UA's reset is invisible in the computed
   value in Chromium and WebKit, so the engine cannot tell the two
   apart.
5. Counters begin at the host: one reset or incremented outside it
   reaches no marker inside.
6. A `::before`'s or `::after`'s counter properties are not read, so
   they count nothing: the engine reads elements, and markers.
7. `display: inline list-item` lays out as a block list item: the tree
   builder runs only `inline` and `contents` into a text run.
8. `open-quote` and `close-quote` in a marker's `content` draw
   nothing: the engine tracks no quote depth.

All cell-model deviations apply: the marker's font is the root's (3),
its cells left of the host are dropped ("Overflow"), and it lies left
of its item whatever the `direction` (18).

## Browser agreement

Probed 2026-09-27 in Chromium, Firefox and WebKit, each result above
marked where it was. The methods, for re-running:

- **Advances**: an inside marker's cells are the offset of the item's
  first glyph from its content box, per type and ordinal. WebKit's
  range rects leave out a justified line's expansion, so justified
  lines are read by ink.
- **Outside geometry**: the marker's ink found by scanning a
  screenshot for its color, the text another color; a full-block
  counter style (`additive-symbols: 1 "█"`) makes the ink the box,
  and its cases landed within 0.05 cells of the edges the rules name,
  in each engine.
- **Numbering**: the ordinal read back through a width-encoding
  counter style — value n draws n cells inside, 0 and negatives
  offset past any ordinal — against the computed `counter-*`.
- **The light DOM**: the CDN bundle's hosts, each item's first native
  glyph against the grid's cell for its text, and a screenshot of the
  cells around it for native ink; then the proposed locks injected
  into the same page.

## Testing

- **Node** (`lists.test.ts`, on node trees and DOM-built ones):
  - counter styles: each simple predefined style at 1, its range's
    ends, 0 and a negative; `decimal-leading-zero`'s pad under a sign;
    the fallbacks; each glyph set's symbols;
  - numbering: every case under "Numbering" as a table — the engines'
    value where they agree, Firefox's where they split — with
    `display: none` skipped, `sr-only` counted, and a custom counter in
    `content`;
  - text: `content` strings, counters and `none`, a string type, and
    `list-style-type: none` under a string `content`;
  - outside placement: `1. `, `9. ` and `10. ` ending at the border
    edge; item padding and margin; indent and alignment leaving it; a
    float's band moving it, a root item beside a float; the first
    baseline through a block, a flex row, a scroll container, a
    multicol box and a table, past an empty block and out-of-flow
    boxes; an empty item one row, one holding an empty block none; the
    item's clip and an ancestor's; a marker past the host's edge
    dropped;
  - inside placement: the first line's wrap width, the indent before
    the marker, center and end alignment, justification through the
    marker's spaces, balance, truncation (a box narrower than the
    marker too), a clamped item's missing marker, a block-first item's
    marker line, tracking;
  - `details`: a closed one's content neither drawn nor counted, an
    open one's both;
  - paint: color, weight and style; an inside marker's decorations and
    an outside one's none; a hidden item's marker; the item's group
    opacity; the marker over a later block's fill and a float's, under
    a positioned box; `renderPlainText` goldens;
  - hit and selection: a marker cell's chain is its item's, a marker
    cell is never selected, and the text-mode copy holds no marker;
  - render: `--mw-ti` with an inside marker's cells and
    `data-mw-marker-image`; cascade.test.ts: the marker locks in the
    lock layer.
- **Storybook** (`lists.stories.ts`, three engines): "Lists" — bullets,
  numbers, letters, romans and a string; nested lists in `circle` and
  `square`; `marker:` color and weight; `start`, `reversed` and
  `value`; inside and outside; `summary` open and closed, toggled; a float
  beside a list; a centered and an indented item. The play asserts
  each item's native text on the grid's cells (`expectNativeOnGrid`,
  inside markers and `summary` included), the markers' cells row by
  row, a press on the link of an inside marker's line landing on the
  link, and one on the cells left of a `summary`, where its native
  marker hangs, reaching what the grid shows there; its golden in the
  sweep.
- **"Lists Against Native"** (test-only, `!dev` and `!golden`, as
  `StackingAgainstNative`): seeded lists — types, `start`, `reversed`,
  `value`, nesting, `counter-*` utilities, inside and outside, padding
  and floats — painted by the engine and, beside it, natively at the
  measured cell in a `contain: layout` box. The native copy numbers
  through the width-encoding counter style, read from each item's
  first glyph, against the grid's numerals; each text marker's inside
  advance against the grid's marker cells; the cases where Chromium
  departs from CSS asserted against CSS there.
- **Visual**: the "Lists" golden; `visual/lists.spec.ts` — a native
  copy with full-block string markers screenshotted and scanned beside
  the grid's marker cells, the probe's method, in three engines; and
  no native ink from an image marker in a host.
- **Bench**: a host of 500 list items holds `pnpm bench`
  (architecture/performance.md) — one `::marker` read per item, three
  counter properties per element.

## Touch points on implementation

- types.ts: will hold `CellStyle`'s list fields — list item, type,
  position, the marker's `content`, color, weight and style, the
  counter properties — and `LayoutNode.marker`: its text, advances
  and position, and the cells layout places it on.
- style.ts: will read them, the `::marker` once per list item.
- counters.ts: will hold the counter walk and the counter-style
  algorithm, with the simple predefined styles as data.
- tree.ts: will attach each item's marker, count the elements the
  layout tree drops, and make an inside marker before a leading block
  an anonymous run of its own.
- layout.ts: will reserve an inside marker's cells on the first line
  (the wrap's `firstLineIndent`, `lineStart`), place an outside one at
  its item's first baseline and band edge, and give an empty item its
  row.
- stacking.ts: `contentOf` will visit a node's marker before its text,
  and the paint index will carry marker entries for the hit.
- plain-text.ts: will paint an item's marker cells in its content
  turn, under its clips.
- pointer.ts: a marker cell will take the hit for its item.
- glyphs.ts: will carry the marker roles, their defaults, and
  `ascii`'s and `cp437`'s.
- render.ts: will add an inside marker's cells to `--mw-ti` and write
  `data-mw-marker-image`.
- styles.css: will hold the marker locks — position, image, the
  flagged content, and the native marker's font.
