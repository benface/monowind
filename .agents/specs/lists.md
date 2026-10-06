# Spec: list markers

Status: **implemented, 2026-09-28** (plan 2026-09-28-lists.md).

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
as text, and Tailwind ships the utilities. Left to the browser, the
light DOM's native markers go wrong three ways (probed, three
engines), which "The light DOM" answers:

- **An inside marker moves the native text.** It pushes the native
  first line right by its own advance — `1. ` three cells, a disc
  2.28, 1.60 and 1.56 (Chromium, Firefox, WebKit) — so the native
  text, a link's hit box, the caret and find-in-page sit off the
  glyphs the grid paints from the line's start. `summary`, whose
  disclosure marker the UA puts inside, drifts 1.76, 1.46 and 1.66
  cells.
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
  `::marker`'s computed `content`, `color` and glyph properties
  (`font-weight`, `font-style`, … — `getComputedStyle(el,
  "::marker")`); a `color` the item's own is read as the item's, which
  a transition's frames resample. All three
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
  (deviation 3); a quote draws from the quote depth
  (generated-content.md "Counters and quotes").
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
  `decimal-leading-zero`'s pad. A representation past 60 code points
  falls back, as css-counter-styles-3 allows, and a pad fills to 60 at
  most: a symbolic or additive style at a large value, or a huge pad,
  would build a string past what a page can hold.

  The other simple predefined styles — the decimal digits of other
  scripts, `armenian`, `georgian`, `hebrew`, the kana, the CJK
  branches and stems — match Chromium's marker text (its
  accessibility tree, probed at 1–27, 49, 100, 3999, 4000, 9999,
  10000, 19999, 0 and −3) but where Chromium runs past the spec's
  ranges: `armenian` past 9999 and `hebrew` at 0 and past 10999.
  Firefox runs `hebrew` past 10999 alone; WebKit keeps every range, as
  the engine does. Chromium's `square` is `■`, the spec's `▪`.

- **Every glyph listed is one cell** (width.ts), and Menlo draws each
  at one cell in all three engines; a font without one is boxed onto
  its cell (wide-characters.md). The browsers draw disc, circle,
  square and the triangles as shapes, not glyphs (a disc's inside
  advance: 2.28, 1.60, 1.56 cells), which css-counter-styles-3
  allows; the grid draws the symbol and its suffix's space.
- **An `@counter-style` rule** is read through the CSSOM, whose
  `CSSCounterStyleRule` all three engines expose: the same-origin
  sheets, adopted and imported ones included, of the host's root and
  its document (a shadow root's rule winning), under the `@media` and
  `@supports` conditions that hold at the read (a disabled sheet, one
  whose media fails, and a container query's rules apply none), read
  on the first name a rule may define (deviation 7), each rule's
  system, symbols, range, negative, pad, prefix, suffix and fallback
  run by the same algorithm, an `extends` loop extending `decimal`. A name the engine does not carry — a
  cross-origin sheet's rule, a complex predefined style's, Firefox's
  `symbols()` — draws as `decimal`, CSS's own fallback for an
  undefined name (deviations 1 and 2).
- **Symbols come from the list item's glyph set** (theming.md): the
  glyph tables carry the marker roles `disc`, `circle`, `square`,
  `disclosureOpen` and `disclosureClosed` on the solid table, as they
  carry the scrollbar's, falling back per glyph to the defaults —
  the table's glyphs, but the disclosure triangles `▼` and `▶`, where
  the browsers' own `▾` and `▸` draw a half-height triangle in a cell
  — and honoring `--mw-missing-glyphs`; `ascii` maps them to
  `* o # v >`, `cp437` to `• ○ ■ ▼ ►` (CP437 has no `▶`). The item
  owns its marker, so its set resolves it, a rule extending a bullet
  included. A string, a numeral or a letter is the author's text,
  never remapped.

## Numbering

- **CSS Lists 3 counters, computed by the engine** in a walk of the
  host's light DOM in tree order, its pseudo-elements among its
  elements (generated-content.md "Counters and quotes") — once a
  build, where a marker or generated text first reads a counter's
  value, none for strings, quotes and bullets, and twice for a
  `reversed()` counter with no value. An element with
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
  count). The walk gives each marker every counter in scope,
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

- **Native markers draw nothing, take no line height and no hit**: the
  companion gives every `::marker` a zero `font-size` and
  `line-height` (ungated, as the font lock is), so no type draws —
  Chromium's shapes included — and an outside one, which hangs past
  its item's box where the covered rule (cell-model.md "Pointer
  states") never reaches, takes no press: Firefox and WebKit toggle a
  `summary` from a press where its native marker hangs otherwise. A
  zero-size marker keeping its line height stretches its line in
  Firefox and WebKit, its baseline aligned with the text's.
- **Images are locked off**: `list-style-image: none` on every light
  element (measuring-gated), the native marker falling back to its
  type; and a list item whose marker `content` holds an image carries
  `data-mw-marker-image`, under which its native marker's `content`
  is `none` — gated too, or the engine's next read would see `none`
  and drop the marker, the one after bring it back.
- **Native markers take no line space**: every light element is
  `list-style-position: outside` (gated), and the engine hands an
  inside marker's cells to the native line as text-indent — `--mw-ti`
  holds the authored indent plus the marker's cells, and on a
  justified line its spaces' share of the spread, on the element whose
  first line the marker opens — so the native first line starts under
  the grid's (in three engines, "Lists", "Details" and "Lists Against
  Native" checking each glyph).
- **Type and text content stay authored**, so assistive technology
  reads the author's marker: Chromium's accessibility tree names each
  `ListMarker` (`1. `, `• `, `(1) `) inside or outside under the
  zero-size lock (re-probed 2026-09-28), the type's text where a
  `list-style-image` is gone, and each `summary` a disclosure triangle.
  A `content` of counters reads no name in Chromium, lock or none; a
  `content` holding an image loses its text with the image, the lock
  taking the whole `content`.

## Selection, copy and accessibility

- **A marker is no text in any engine**: `innerText`, `textContent`,
  `Selection.toString()` and a real copy leave it out in all three;
  Firefox's copy indents each item four spaces instead (probed).
- **The copy holds a marker with its item's first line**: the engine's
  copy (semantic-selection.md "Copy serialization") puts the text of a
  marker the grid shows — a cell inside its clips, right of the host's
  edge — before the first text of its item where the selection holds
  that text's first line whole — a paragraph gesture, a drag across it
  — where no browser copies one; a table's first cell included. A
  word, part of the first line, or a later line alone copies none (a
  word that is the whole first line is that line); nested items'
  outside markers, which share a row, copy in a row (`1. 1. `). Grid
  mode's drag copies the rows it shows, markers included.
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
6. `display: inline list-item` lays out as an atomic inline box, as
   `inline-block` does, where CSS makes it an inline box its lines
   break across: the tree builder runs only `inline` and `contents`
   into a text run. Its marker sits inside, as CSS places an inline
   item's whatever its position (WebKit has no inline list item).
7. An `@counter-style` rule the CSSOM inserts into a group rule
   (`@layer`, `@media`, `@supports`) or an imported sheet of a sheet
   the engine has read applies once that sheet's own rules next
   change: the engine reads a
   sheet once, and again when its top-level rules change (a count, or
   the first rule, which `replaceSync` makes anew).

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
  - counter styles: each simple predefined style at 1 and 27 against
    Chromium's accessibility tree, range ends, 0 and negatives, the
    fallbacks, `decimal-leading-zero`'s pad under a sign, the fallback
    past 60 code points and a pad to 60 at most; an
    `@counter-style` rule of each system, its descriptors, escapes,
    images, the rules CSS drops, `extends`, loops of it, a shadow
    root's rules over its document's, rules under `@media` and
    `@supports` and in imported, disabled and media-failing sheets, the
    lazy and re-read sheets, a replaced sheet, a comma symbol;
    each glyph set's bullets, a missing glyph, `extends disc`;
  - numbering: every case under "Numbering" as a table — the engines'
    value where they agree, CSS's (Firefox's) where they split — with
    `display: none` skipped, `sr-only` counted, skipped contents, a
    custom counter and `counters()`; the counter properties parsed as
    computed and as specified;
  - text: `content` strings, counters, images (`image-set()`
    included), quotes and `none`, a string type, `list-style-type:
    none` under a string `content`; a name an object's prototype holds;
  - outside placement: `9. ` and `10. ` ending at the border edge; item
    padding and margin; indent and alignment leaving it; a float's band
    moving it; a multi-column, a flex and a grid list's items; a leading
    block below an
    inside marker's own line, natively too, and an outer marker on
    that line; the first baseline through a block, a flex row, a scroll
    container and a table, past an empty block and out-of-flow boxes;
    an empty item one row, one holding an empty block none; tracking;
    the item's clip and an ancestor's; a marker past the host's edge
    dropped;
  - inside placement: the first line's wrap width, the indent before
    the marker, center alignment, justification through the marker's
    spaces, balance as an equal indent, truncation (a box narrower
    than the marker too, with and without an ellipsis), a block-first
    item's marker line, an empty item's row, tracking;
  - paint: color, weight, an inside marker's decorations and an outside
    one's none; a hidden item's marker; the marker over a later
    block's fill, under a positioned box; `renderPlainText` rows;
  - hit and selection: a marker cell's hit is its item's, a marker
    cell is never highlighted; the copy's marker with a whole first
    line, inside and outside, on a line of its own, nested and in a
    table, and none with a word, part of the line, a later line, a
    hidden item or one the grid cuts;
  - the light DOM: `--mw-ti` with an inside marker's cells and their
    justified spread, `data-mw-marker-image`; cascade.test.ts: the
    marker locks in the lock layer.
- **Storybook** (three engines): "Lists" (`lists.stories.ts`) —
  bullets nested in `circle` and `square`, numbers from `start` with a
  `value`, letters, romans `reversed`, a string in a `marker:` color
  and weight of its own, inside items wrapped, centered and indented,
  a float beside a list; its play reads the markers' cells row by row
  and each item's native glyphs on the grid's cells
  (`expectNativeOnGrid`); a golden. "Marker Styles" — `marker:`
  utilities, strings touching or one or two cells off, an
  `@counter-style` `prefix` and a wider `suffix`, item padding,
  `counters()` in `content`, and images drawing nothing; its play reads
  the same; a golden, and a twin laying it out twice more, its image
  marker kept each time. "Details" (`interactive.stories.ts`) — each
  `summary`'s triangle and its native text on the grid. "Lists
  Against Native" (test-only, `!dev` and `!golden`, on
  `besideNative`) — inside markers laid out beside the browser's own,
  each word where the browser puts it: wrapping, a wider marker,
  indent, center and end, justification (WebKit departs), a leading
  block and an empty item, and an inline item's marker.
- **Visual**: the "Lists", "Marker Styles" and "Details" goldens;
  `visual/lists.spec.ts`, with trusted input in three engines — a
  press on a `summary`'s marker cell toggles it and one where its
  native marker would hang does not, and a press on the grid's cells
  of a link on an inside marker's line lands on the link.
- **Bench**: `pnpm bench --shape lists` (architecture/performance.md) —
  one `::marker` read per item, the counter walk over every element.

## Touch points on implementation

- types.ts: `MarkerStyle` (`CellStyle.marker`: its parts, position,
  paint and image flag) and `Marker` (`LayoutNode.marker`: its text,
  advances, cells, spaces and an outside one's laid-out origin).
- style.ts: `readMarker`, the `::marker` read once per list item a
  build (`markerOf`, the build's and the counter walk's);
  `skipsContents`, shared with the counter walk.
- counters.ts: the counter-style algorithm over the simple predefined
  styles, the `@counter-style` reader (`pageCounterStyles`), the
  bullets' glyphs (`withBullets`), `content`'s parts, and the counter
  walk (`countersOf`) with its property parsers.
- sheets.ts: the walk of the page's sheets that finds the
  `@counter-style` rules (`sheetRules`, `pageSheets`).
- tree.ts: `counterTree`, the walk's view of the host's elements and
  pseudo-elements with HTML's hints, walked once a build
  (`BuildContext.readings`); `attachMarkers`, each item's marker — the
  items gathered as `buildNode` builds them — an inside one on the
  leaf holding its first line or a run of its own.
- layout.ts: `firstLineIndent` (an inside marker's cells in the first
  line's indent), a justified spread's marker gaps, `firstLineStart`
  (which the paint and `markerSpread` share), an outside marker's
  origin at its item's first baseline and band edge, a marker's own
  line in `baselineRow` and none in the native flow.
- multicol.ts: a paragraph-flow item's outside marker at its first
  line, in its column.
- stacking.ts: `contentOf` visits a node's marker before its text; the
  paint index carries marker entries.
- plain-text.ts: `forEachMarkerCell`, the one walk of a marker's cells
  that the paint, `markerCovers` (the hit) and `markerShows` (the copy)
  share; the marker's paint in its node's content turn, under its
  clips.
- selection.ts: `copyMarker`, a shown marker before its item's first
  text in the copy.
- pointer.ts: a marker entry takes the hit for its node.
- glyphs.ts: `BULLET_GLYPHS` (the bullet roles and their defaults,
  whose names counters.ts takes) and `ascii`'s and `cp437`'s;
  `bulletGlyph`.
- render.ts: `nativeIndent` with an inside marker's cells and spread;
  `data-mw-marker-image`.
- styles.css: the marker locks — position, image and the flagged
  image's content (gated), and the zero-size native marker.
