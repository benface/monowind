# Semantic selection in grid mode

Status: **implemented** (2026-09-04) — engine (selection.ts, the gesture
handlers in element.ts, the leaf hook), stories, and this spec agree.
Engine facts below marked _verified_ were established on 2026-09-04
against the CDN bundle in Chromium, Firefox, and WebKit (Playwright).
Scope: `select="grid"` only for the gestures; the copy serialization
applies to both modes. `select="text"` otherwise already gets every
semantic gesture natively from the light DOM.

## Why

Under `select="grid"` a drag selects the rendered `<pre>` directly:
what you see is what you copy, box glyphs and all. Multi-click
gestures, though, come from the browser's model of the `<pre>` — one
block of text with newlines — not from the document the grid renders:

- **Double-click** selects a "word" by the browser's own segmentation
  of the row string. Mostly right (box-drawing characters break words),
  wrong where two leaves' texts touch without a blank between them.
- **Triple-click** selects the browser's paragraph — the whole `<pre>`,
  i.e. the entire grid — because the grid is a single block. The user
  expects the paragraph under the pointer: that element, its text.

This spec makes both multi-click gestures select **the element's
text**: the word or paragraph under the cell, in the light-DOM leaf
found through the layout tree the engine already hit-tests
(specs/cell-model.md "Pointer states"), selected the way any HTML page
selects a word or a paragraph.

## Locked decisions

- **The selection is the element's, not the grid's.** A paragraph
  gesture builds a Range over the leaf's DOM contents
  (`selectNodeContents(leaf.source)`) and applies it with
  `document.getSelection().setBaseAndExtent(…)`. A DOM range is
  contiguous in DOM order, so it covers exactly that paragraph —
  its own lines and nothing beside them — and copies exactly its text.
  A grid range could never do this: a `<pre>` selection is "every cell
  between two points", which sweeps whole rows and drags neighboring
  boxes into the copy.
- **The highlight is the native layer's.** The light-DOM text sits
  under the grid's glyphs cell-for-cell (the unified render), and the
  canonical `::selection` invert (styles.css) paints it exactly as
  `select="text"` paints a selection today — same rule, same look, same
  sub-cell deviations (odd centering without the nudge, cell-model.md
  "Text alignment"). _Verified_: a programmatic paragraph range paints
  the inverted band over exactly that paragraph in all three engines
  (Firefox paints no selection in an unfocused document — a
  headless-only concern). Grid mode therefore shows a semantic
  selection the way text mode does, and follows the content when a
  container scrolls (content-anchored, unlike a grid drag). The
  highlight is not mirrored onto the grid: painting the selected cells
  inverted would make it cell-exact instead of native-layer-exact, and
  the sub-cell cases are the documented text-mode ones.
- **The paragraph is the text LEAF.** The unit is the innermost layout
  node under the cell that carries text (`LayoutNode.text` — a `<p>`,
  `<li>`, `<h1>`, a `<div>` with direct text, a `<td>`, a custom leaf
  such as `<mono-ascii>`), taken from `hitStack` (pointer.ts), which
  already applies scroll offsets, or the root leaf itself when nothing
  in the stack carries text (the host's own inline content,
  host-leaf.md). Leaves are elements or the root — a container's
  direct text next to block children is dropped (cell-model.md), so
  there are no anonymous runs — and inline descendants (`<span>`,
  `<a>`, `<b>`) and `<br>` lines belong to their leaf. An `inert` leaf
  yields no unit (its text is unselectable natively) — the browser's
  grid gesture applies. An atomic
  inline box (`inline-block`, `inline-flex`) is a leaf of its own: a
  gesture on its cells selects
  within it, and its parent paragraph's range includes it as a
  descendant. Both gestures need a CHARACTER of the leaf painted at
  the cell (a space between words counts; a banner's art cells count).
  Anything else — a leaf's padding or border, a container's, a gap, a
  short line's blank tail — is left to the browser's own gesture on
  the grid: the grid LINE on a triple-click (a `<pre>` row is a
  paragraph to the browser) and a glyph run on a double-click. One
  rule, deliberately: text selects its element, everything else
  behaves like the terminal it looks like. **Deviation** from native
  triple-click, which selects a paragraph from its padding too.
- **The grid-mode lock lifts while a semantic selection is live.** The
  lock is `user-select: none` on the light DOM — the shadow rule
  `:host([select="grid"]) slot { … }` plus an explicit companion rule
  on every light element, because the slot's value reaches slotted
  content in Chromium and WebKit but not Firefox (_verified_: computed
  `auto` there, and a grid drag straying onto a light element — a
  multicol spanner, see specs/multicol.md — selected it). _Verified_:
  in Chromium and WebKit a range set into locked content is inert
  programmatically — `Selection.toString()` is `""` and a copy writes
  nothing — and after the lift the same range selects, highlights, and
  copies. The engine sets `data-mw-semantic-selection` on the host
  BEFORE applying the range; both rules yield under that attribute.
  Editable controls are exempt from the explicit rule: Firefox honors
  an explicit `none` on a field's value (_verified_), while the slot's
  inherited value never reached it. `pointer-events` is untouched, so a
  plain drag still lands on the grid and selects it as before. The attribute clears synchronously on the next plain
  `mousedown` on the grid (`detail === 1` — the drag that follows must
  not reach into a still-lifted light DOM while `selectionchange` is
  pending) and, as the catch-all, on `selectionchange` once the
  selection no longer lies in the light DOM or has collapsed.
- **The engine writes the plain-text copy of any selection in its
  light DOM — both modes.** _Verified_: Chromium and WebKit serialize
  a range spanning two of the host's paragraphs with NO line break
  between them (`…in it.Second paragraph…`), in `select="text"` today
  as well — the light elements are absolutely positioned, and those
  serializers derive block breaks from in-flow layout; Firefox emits a
  blank line. A `copy` listener on the host therefore sets
  `text/plain` itself whenever the selection lies within the host's
  light DOM or a leaf's shadow, following the rules the browser would
  have applied to in-flow boxes — the HTML `innerText` rendered-text
  algorithm: a `<p>` is surrounded by a blank line (two required line
  breaks), any other block-level box by one, table cells of a row are
  separated by `\t` and rows by `\n`, `<br>` is `\n`, and a leaf's
  text is its layout text (`LayoutNode.text`, inline-box and padding
  markers dropped). Then `preventDefault()`. A grid selection (inside
  the shadow `<pre>`) is left to the browser, which already copies it
  row by row. Custom leaves copy their `text` — the art for
  `<mono-ascii>` — so a copy never depends on how an engine serializes
  a shadow host.
- **Click counting comes from `mousedown`.** `event.detail` carries the
  click count on `mousedown`/`click` (PointerEvent's `detail` is 0), so
  the engine listens for `mousedown` on the host (grid mode only, and
  only when the event path includes the grid — clicks landing on
  interactive elements, `pointer-events: auto` in grid mode, are the
  light DOM's — or a PHANTOM target: a non-interactive light element
  that received the event by a browser quirk, _verified_ Firefox
  hit-testing a multicol spanner's rows as its container despite
  `pointer-events: none`; it is a grid event at the same coordinates,
  and a plain press there starts an engine-driven grid drag, since no
  native selection can begin on locked content). `detail === 2` is a
  word gesture, `detail >= 3` a paragraph gesture; the engine
  `preventDefault()`s the event —
  stopping the browser's own word/whole-`<pre>` selection AND the
  native drag it would start — and owns the gesture until release.
  Mouse and pen only: a `mousedown` counts only when the most recent
  primary `pointerdown` was mouse or pen. _Verified_ (Chromium,
  WebKit): a tap runs `pointerdown(touch) → pointerup(touch) →
mousedown(detail 1, no pointerType) → mouseup → click`, so the
  compatibility `mousedown` is recognized by the touch `pointerdown`
  before it; a touch otherwise never reaches the pointer handlers
  (specs/scrolling.md "Touch panning"), and long-press selection stays
  native.
- **Drag extends unit by unit, in DOM order.** While the button stays
  down after a gesture, each `pointermove` re-derives the unit (word or
  paragraph, per the gesture) under the pointer and sets the selection
  to cover the anchor unit and the current one: base at the anchor's
  boundary farthest from the current unit in DOM order, extent at the
  current unit's far boundary, so the browser's selection direction
  matches the drag (Shift+Arrow afterwards extends from the right end).
  Everything between the two in DOM order is selected — the behavior
  of double- and triple-click-drag on any page. A pointer over cells
  with no unit leaves the previous extent in place. Release ends the
  gesture; the selection stays.
- **Double-click is the same gesture at word granularity.** The word
  is the segment of the leaf's text that contains the character painted
  at the cell, by `Intl.Segmenter` (`granularity: "word"`, locale from
  the element's closest `lang`; _verified_ present in all three
  engines), word-like or not — a double-click on a blank or a
  punctuation run selects that run, as Chromium does. A cell with no
  character is the browser's, as for paragraphs. Both gestures are
  element selections, so copy means the same thing
  whichever one made the selection; the grid's own segmentation of the
  row string is never used.
- **Shift extends an existing element selection.** A semantic
  `mousedown` with `shiftKey` keeps the current selection's anchor and
  moves its focus to the far boundary (in DOM order) of the hit unit
  (an anchor inside a custom leaf's shadow becomes that host's
  light-tree edge). No selection, or a grid selection (which cannot
  extend into the light tree): the gesture behaves as without Shift,
  replacing what was there.
- **A semantic gesture moves focus the way a native click would.** The
  canceled `mousedown` no longer moves focus, so the engine blurs a
  focused element inside the host (a text control, a button) before
  selecting — otherwise the browser's copy command would serve the
  focused control's empty selection instead of the document's.
- **Grid drags and semantic selections coexist.** A single click or a
  drag on the grid still makes a grid selection (replacing a semantic
  one, natively); a semantic gesture replaces a grid selection. Which
  layer holds the selection is whatever the last gesture chose.
- **Custom leaves name their selectable node.** `LeafRegistration`
  (the `registerLeafRenderer` options) gains an optional
  `selectionTarget(el): Node | null`: the node whose contents a
  gesture ON the leaf selects. `<mono-ascii>` returns its
  shadow transcript (`#mirror`). _Verified_: a range over the
  transcript's contents highlights the art and natively copies it in
  all three engines — it is what `select="text"` selects there today —
  whereas a range over the host's light contents highlights nothing
  and copies inconsistently (the transcript in Chromium and Firefox,
  nothing in WebKit). A leaf without the hook selects its light
  contents (no visible highlight; the engine's copy still yields its
  `text`). Extension ACROSS a custom leaf keeps its boundaries in the
  neighbors' text and contains the host whole; the copy is the
  engine's either way.
- **Nothing changes for keyboard or AT.** Shift+Arrow extends
  whichever selection exists natively (the lift makes that possible on
  a semantic one); the grid stays `aria-hidden` and the light DOM stays
  the accessibility surface.

## Mechanics

- **Hit → leaf → element.** `hitStack(layout, col, row)` from the last
  layout, innermost entry whose node has `text` and no in-flow children
  (the paint walk's own leaf test); its `source` is the element.
  Paragraph-flow multicol children share their container's box, so
  `hitStack` tests them by their line fragments (specs/multicol.md).
  No such entry, or no character of it at the cell → the event is not
  canceled and the browser's own gesture runs on the grid.
- **Paragraph range.** `selectNodeContents(source)`, or of the leaf's
  `selectionTarget` when it has one. Extension:
  `setBaseAndExtent(anchorBoundary…, currentBoundary…)` with the
  boundaries chosen by `compareDocumentPosition` as described above;
  a boundary inside a custom leaf's shadow cannot pair with one in the
  light tree, so extension uses light-tree edges around the host —
  the previous sibling's content end and the next sibling's start,
  not points on the host's parent: _verified_ Firefox's
  `getComposedRanges` re-expresses a point on the host itself inside
  the host's shadow slot, which would read as outside the light DOM.
- **Cell → character.** The leaf's line geometry (`leafLineGeometry`,
  or the multicol leaf's stored fragmentation) with its per-character
  advances gives, for a cell inside the leaf, the index into
  `LayoutNode.text` painted there, or none. Recomputed at event time
  from the last layout — a pure function of the node, as the paint
  walk uses it.
- **Character ↔ DOM position.** The tree builder already records
  per-character metadata for a leaf (`charInline`); it also records
  which source Text node and offset every character of `node.text`
  came from, stored as runs of consecutive characters (a collapsed
  whitespace run maps to its first source character;
  a `<br>` newline to the element; an inline box's U+FFFC and inline
  padding cells to no position). Word boundaries map forward through
  it to `setBaseAndExtent` points; the copy serializer maps a Range's
  boundary points backward through it to slices of `node.text`. A
  renderer leaf's text is the art, produced by the renderer, and has
  no positions at all.
- **Word range.** `Intl.Segmenter` over the leaf's text (with U+FFFC
  and pad markers treated as boundaries), the segment containing the
  hit index, both ends mapped to DOM positions. A word whose ends have
  no position (an art leaf, a marker) falls back to the leaf's
  paragraph range — the leaf as a whole is the smallest selectable
  unit there. Extension and Shift use the same anchor/focus rules as
  paragraphs, at segment boundaries.
- **Copy serialization.** On `copy` (host listener, both modes): the
  selection's first range; if both boundary points are inside the
  host's light DOM or a leaf's shadow, walk the leaves of the last
  layout in tree order (out-of-flow descendants after their parent's
  text; table cells are leaves like any other), take each one the
  range intersects — fully (`node.text`, minus the final `\n` a
  trailing `<br>` leaves, which the wrap layer drops too) or partially
  (the slice between the mapped boundary offsets; a point inside an
  inline box's subtree maps to the box's marker in the parent, and the
  marker is replaced by the box's own serialization; a custom leaf is
  all-or-nothing) — and assemble them with the `innerText` required
  line breaks (2 for a `<p>`, 1 for any other block-level box, per
  `style.display` and the source tag; `\t` between cells of a table
  row; runs of required breaks collapse to the maximum, none at the
  ends), set `text/plain`, `preventDefault()`. No `text/html` is
  written: a TUI copy is plain text.
- **Lift, then select.** Attribute first, one forced style resolution,
  then the range — so the range is only ever set into selectable
  content.
- **Gesture state.** `mousedown` (detail ≥ 2) starts it and records the
  anchor unit; `pointermove` extends while the primary button is down;
  the window-level `pointerup`/`pointercancel` the engine already
  listens to ends it. The existing press bookkeeping (`#pressing`,
  data-mw-active) runs as for any press.
- **Repaints.** The selection lives in the light DOM, which the paint
  never rebuilds — paintGrid's capture/restore and the structural hold
  are about grid selections and do not engage (`hasSelectionInside` is
  false, so a held structural rebuild proceeds and leaves the light
  Range alone). render.ts writes only geometry custom properties and
  engine attributes to light elements, which does not disturb a Range.
- **Scroll containers.** Native text scrolls with its container, so
  the selection and its highlight follow the content; while a scroll
  gesture is live the native layer may trail the grid ink by under a
  cell (specs/scrolling.md Deviations), converging at the settle.

## Deviations (documented, like the cell model's running list)

- **DOM order, not screen order, between units.** Extending from one
  column to the next selects everything between them in the DOM (a
  sidebar that sits between in source order but beside on screen) —
  native HTML behavior, kept.
- **The highlight rides the native layer**, so it inherits text mode's
  sub-cell deviations (an odd-parity centered line without the nudge
  sits half a cell off). The grid glyphs beneath are covered by the
  band, which is the intent.
- **Word boundaries are `Intl.Segmenter`'s**, not each engine's native
  double-click rules (Chromium on Windows takes the trailing space
  along; Firefox's `layout.word_select.*` prefs vary). One rule in
  every engine, and the standard one.
- **Copies are plain text only.** No `text/html` flavor — pasting into
  a rich editor gets the text, not the styling. The text itself follows
  the standard `innerText` rules in every engine, rather than each
  engine's serializer quirks.
- **Clipped or truncated text is selected and copied in full** — the
  element's text is the unit, not the visible cells (unlike a grid
  drag, which copies what shows). The highlight shows only the visible
  part, clipped natively with the element.
- **Extension over nothing keeps the last extent** rather than reaching
  the nearest unit in the pointer's direction (the browser's behavior
  for paragraphs separated by margins). Cheap to revisit if it feels
  sticky.

## Verified after implementation

- Firefox and WebKit invert a wholly contained banner (an extension
  across `<mono-ascii>`), like Chromium.
- A real ⌘C after each gesture pastes exactly the engine's text, in all
  three engines.
- Firefox touch event order stays unprobed (no touch synthesis); the
  guard is order-based, so an unexpected order fails safe (no gesture).

## Testing

- Storybook, hidden (`tags: ["!dev"]`) like `TouchPan`: a grid-mode
  host laid out as a flex row of a column holding two stacked `<p>`s
  and a third `<p>` beside them (so the side paragraph is never between
  the stacked ones in DOM order), plus a `<mono-ascii>` and a trailing
  `<p>`, and a two-column paragraph flow. The play dispatches `mousedown` with
  `detail: 3` on a cell of the first paragraph and asserts
  `document.getSelection().toString()` equals that paragraph's
  `innerText`, that the host carries `data-mw-semantic-selection`, and
  that nothing from the side paragraph is selected; then `pointermove`
  (primary button held) onto the second stacked paragraph and asserts
  the string covers both and still excludes the side one; `pointerup`
  ends the gesture; `removeAllRanges` followed by `selectionchange`
  clears the attribute. A `mousedown` with `detail: 3` on a gap cell
  asserts the event was not canceled and the selection untouched (the
  browser's gesture); so does a triple-click on a bordered box's border
  or padding cell, while one on its characters selects its text. A
  pointer moved past the grid during an engine-driven drag clamps the
  extent to the grid's end; grid-mode light elements compute
  `cursor: text` while an authored `cursor-pointer` still wins; in
  `select="text"` a triple-click on the grid is not canceled. Word
  gesture:
  `detail: 2` on a cell inside a known word asserts the selection
  string is that word; on a blank cell of the same line, not canceled;
  `pointermove` onto a later word asserts the string runs
  from the first word to the second; a Shift+`mousedown` (`detail: 3`)
  on another paragraph asserts the selection now ends at that
  paragraph's boundary. Banner: `detail: 3` on the art asserts the
  selection string is the art. Runs in all three engines.
- Copy: a synthetic `ClipboardEvent("copy", { clipboardData: new
DataTransfer() })` dispatched on the host after each selection above
  asserts `getData("text/plain")`: two `<p>`s separated by a blank
  line; a word alone; the art for the banner; and, for an extension
  across the banner, paragraph, blank line, art, blank line, paragraph.
  Real keyboard copies are spot-checked manually per engine in the
  plan.
- Core: the character ↔ DOM map and the copy serializer are pure
  functions of the tree; Node tests cover collapsed whitespace, `<br>`,
  inline boxes and padding markers, and partial slices.
- Visual: none — the selection invert is already covered by
  `visual/selection.spec.ts`, and the highlight is the same rule.
