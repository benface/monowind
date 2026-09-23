# CSS `visibility`, the anchor functions, and the scrolling gestures

The engine paints `visibility: hidden` and `collapse` boxes as if
visible (probed: a hidden `<p>` shows its text on the grid), so
Tailwind's `invisible` does nothing. `position-visibility` builds on
the same hiding, so `visibility` comes first. The anchor functions
and the scrolling gestures landed in the same batch.

## 1. `visibility` (done)

- `CellStyle.visible` from the computed `visibility`; `collapse` is
  `hidden` everywhere, tables included (spec deviation).
- The rasterizer skips a hidden box's own ink — text, background,
  borders, shadows, scrollbar, rules, a text clip's tint — and still
  recurses: a `visible` descendant paints. A hidden inline element
  leaves its cells blank in its run, keeping their space.
- Hit-testing passes through a hidden box to what is under it; its
  visible descendants — boxes, and inline elements in a hidden leaf —
  stay hittable. Focus navigation skips it. The copy follows
  `innerText`: no hidden characters or `<br>`s, no hidden box's
  breaks, rows' newlines and cells' tabs after the visible ones.
- A stray-text container's rows keep their authored `visibility`
  natively (`data-mw-invisible`). The host reads as visible while the
  engine reads, its own visibility the grid's natively, so a host an
  ancestor hides shows at once however it is shown; a `visible` child
  of a hidden host stays hidden (a documented deviation — forcing the
  grid visible instead left it stale and swallowing clicks).
- A `visibility` fade-out keeps its element on the grid until it
  ends, what inherits its visibility with it: the host finds the
  transition before its read, which cancels it. A fade-in holds
  nothing, so closing one early hides it at once.
- The text an inline element split around a block leaves in a run
  keeps the element's style, its visibility and color included.

## 2. `anchor()` and `anchor-size()` (done)

Read as authored from the inline style or an arbitrary-value utility
(the browsers resolve them against the pre-grid anchor), resolved in
cells as the box is placed: `anchor()`'s sides, `inside`/`outside`,
the logical sides, percentages, a named anchor per inset, the point
rounded once; another axis's side resolving to the fallback alone.
`anchor-size()`'s dimensions, `max-*`/`size-*`, named anchors. Both
take a fallback after the comma (a length, a percentage, a calc(), a
zero).

## 3. Fallbacks and `position-try-order` (done)

Every absolutely positioned box tries its fallbacks, a box placed by
its insets too: a tactic's flips, in their written order (`flip-x`
and `flip-y` included), flip its insets — an `anchor()` moving to the
mirrored side and point — its margins, and its self-alignment; a
`position-area` fallback places it in that area. The fit is the
margin box against the area, or the block the insets leave.
`most-width` / `most-height` (and the logical spellings) sort the
placements, the base among them, by their room on that axis, largest
first, stable. A box keeps the placement it last fit in while that
still fits, as CSS keeps its last successful option (the host
remembers it between layouts, forgetting it when the box's choosing
styles change); none fitting, the one in effect stands.
`anchor-center` centers a box placed by its insets on its anchor. A
flipped `anchor()` point rounds from the mirrored edge, so the cell
mirrors too.

## 4. `position-visibility` (done)

Initial `anchors-visible` in all three engines: a box whose default
anchor is hidden (its `visibility`, or itself or a box above hidden
by `position-visibility`, so hiding chains) or fully clipped by the
scroll containers the box escapes is strongly hidden (subtree
included, no `visible` override); an anchor inside a fixed box is
judged by the clips inside that box alone, and one inside a scroller
the positioning pass sizes — a menu's list in the top layer — at that
scroller's offset, synced as the pass places the box (a scrolled
menu's submenu hid). `no-overflow` hides a box
that overflows after the fallbacks; `anchors-valid` one whose anchor
does not resolve; `always` never. `position-anchor: normal` names the
implicit anchor only where a `position-area` is set, as in all three
engines.

## 5. Keyboard scrolling and track paging (done)

A scrolling key holds relayouts until its container settles (a
relayout under a smooth key scroll cancels it in Firefox and WebKit),
released at once when a later handler cancels the key; paints follow
the scroll meanwhile. A press on a scrollbar's track pages toward it,
repeating while held, stopping under the pointer. Under
`focus="arrows"`, the arrow moves the focus at the end of its
dispatch, so a framework's root handler cancelling it keeps it. A
reveal stops clear of a scroll container's border and bars,
`scroll-padding` locked to their cells: a `nearest` reveal left the
item under the border. `scroll-behavior` is locked to `auto` on
scroll containers: under `scroll-smooth` the engine's own writes
animated — a thumb drag fought itself, and in Firefox a relayout's
restore scrolled an arrow's reveal back (since 0.3.1).

## 6. Sizing against the trigger in the UI package (done)

`anchor-size()` on the positioner sizes a part against its trigger.
A reference size Zag's `--reference-width` names, published in cells
and tracked through resizes and anchor changes, was built and dropped:
`anchor-size()` covers it through every layout, inline anchors
included, and Zag's other positioning variables are unset anyway
(`--transform-origin`, which its middleware still writes, ignores the
engine's flips).
Zag's size middleware stays off, `sameWidth` and `fitViewport` with it.

## 7. Tooling (done)

`pnpm check` reports non-canonical Tailwind classes in `class` and
`className` attributes (`scripts/check-canonical-classes.mjs`,
`pnpm check:fix` rewrites them), against the stylesheet
`.oxfmtrc.json` maps each file to, at IntelliSense's 16px root; the
VS Code settings map the same stylesheets for IntelliSense. Storybook's
preview hands an input back to the browser at a person's first edit:
a play's `userEvent` leaves interceptors on every input it focused,
which put the caret at the end on any value write.

## 8. The browser's placement, checked (done)

A box the browser places itself — an atomic inline box in its line, a
flow child, a float — lies on its engine cells in every story and
engine (`visual/agreement.spec.ts`). Inline boxes give back their
width's layout-unit headroom on their right margin: two on an exactly
full line (the combobox's input and ▼) outgrew it, and the browser
wrapped the button under the input where the grid did not. An inline
element's native border is zeroed, and an authored one warns.

## 9. Vitest environment (done)

`pool: "vmThreads"` in the core package: one happy-dom per worker,
files still isolated; the run 1.9 s → 0.8 s. `isolate: false` was as
fast but shares module state (the registries) across files.

## Outcome

Specs: `visibility.md` (new), `anchor-positioning.md`,
`scrolling.md`, `positioning.md` (logical insets), `cell-model.md`
(negative percent insets; inline boxes' give-back margin, so a line
holding two that fits exactly fits natively; inline borders zeroed),
`focus-navigation.md` (arrow moves at the end of the key's dispatch),
`ui.md`, `table.md`, `semantic-selection.md`. Stories: the UI stories
regrouped (a listbox without hover highlight, its hover variant
test-only), `SelectMultiple` sized by `anchor-size()`, the combobox's
"nothing matches" line. Performance: `architecture/performance.md`
"Visibility and the anchor extras".

Open: a hidden layer root's layer leaves a visible descendant's blank,
unfilled cells to the main grid, which misses the descendant under a
transformed layer (visibility.md deviation 5).
