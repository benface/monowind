# Visibility

Status: **implemented** (2026-09-22).

`visibility: hidden` (Tailwind's `invisible`) and `collapse` on the
grid: a hidden box keeps its place in the layout and paints nothing of
its own, as in CSS.

## The read

`visibility` is read from the computed value, which inherits, so every
box and every inline element carries its own: `hidden` and `collapse`
hide, anything else — `visible`, or no value where a DOM has not got
the property — paints. The host reads as visible while the engine
reads, its hiding before its first layout off and an ancestor's
`hidden` held back, so the read is the author's within the host; the
host's own visibility stays the grid's, natively (deviation 3). A
nested host, which never lays out, is never hidden.

## Locked decisions

- **A hidden box keeps its space.** It is laid out as if visible; the
  boxes after it stay where they were.
- **It paints none of its own ink**: no text, fill, gradient, shadow,
  border, gap rule, table lattice, scrollbar, or truncation ellipsis.
  Its subtree still walks: a descendant that says `visible` paints, as
  in CSS. A hidden layer root keeps its layer for such descendants,
  but its box takes no hit and its `backdrop-filter` is off. A
  collapsed table's lines are the table's ink, a sticky row's share of
  them included.
- **A hidden inline element's cells stay blank** in its line, their
  space kept — its text either side of a block it wraps too; a visible
  inline element inside a hidden paragraph paints its own cells.
- **It takes no hit.** A press on a hidden box's cells falls to what is
  under it; a visible descendant under the cell takes it — a box, or
  a visible inline element's character in a hidden leaf — the hidden
  ancestor staying in the hit chain, as native `:hover` climbs.
- **It takes no focus**: focus navigation skips a hidden box or inline
  element, a visible descendant kept. The browser skips it natively
  too, the light element keeping its authored `visibility` — where the
  engine hides a container's stray table text natively and shows its
  rows through, a hidden row stays hidden (`data-mw-invisible`).
- **Its text is no copied text.** A copy leaves hidden characters out,
  a `<br>` in hidden text among them, and drops a hidden box's own
  line breaks, keeping its visible descendants', as `innerText` does
  in all three engines (probed 2026-09-22). A hidden row gives no
  newline and a hidden cell no tab: each visible row and cell puts
  its separator after itself, before the next. An anonymous run is no
  element and gives no breaks of its own, the boxes beside it theirs.
  A hidden character takes no selection gesture.
- **A fade shows the element throughout.** A `visibility` transition
  from `visible` to `hidden` keeps the element visible to the grid
  until it ends, as CSS interpolates it, and with it what inherits its
  visibility — the text of its children — so a fade-out that also sets
  `invisible` (`transition-all invisible opacity-0`) fades: the host
  finds the transition before its read, which would cancel it, and
  lays out again as it ends. A fade-in shows from its start, so its
  cancel changes nothing: an element closed before one ends, with
  nothing transitioning the close, hides at once.
- **A hidden `::backdrop` draws no box**, and a hidden box's fill is
  no ground for the editable colors above it.

## Deviations from CSS

1. `collapse` hides as `hidden` on a box or a table row: a collapsed
   row keeps its space, and a collapsed flex item is not a strut. A
   collapsed column (`<col>`) is not read, its cells painting.
2. During a fade-out the light element is hidden natively from its
   start — the transition the host's read cancels is the browser's
   own — so it takes no native click or focus while the grid still
   shows it.
3. A hidden host shows none of its subtree, a `visible` descendant
   included: the host's visibility is the grid's natively, so it shows
   and hides at once whatever changes it, with no relayout.
4. A `<br>`'s own `visibility` is not read.
5. A hidden layer root's layer takes the press on its visible
   descendants' ink and fills; one on a visible descendant's blank,
   unfilled cell goes to the main grid's cell under the pointer, where
   the descendant lies only while its layer is untransformed.

## Testing

- Node (`visibility.test.ts`): the read; a hidden block, inline
  element, atomic inline box, scroll container, and inline element
  split around a block painting none of their own ink; each piece of
  a hidden box's ink — fill, gradient, outer and inset shadows,
  ellipsis, `bg-clear`, collapsed table lines, a renderer leaf's art —
  against a visible control; a visible descendant painting, a hidden
  text-clip box tinting no glyph; the hit through a hidden box, onto
  a visible descendant box or inline element (in a leaf or an
  anonymous run); focus skipping hidden controls and links, keeping
  visible ones; the copy's characters, breaks, `<br>`s, rows, and
  cells. `layer.test.ts`: a hidden layer root's visible fill takes the
  hit, its own blank box not. `sticky.test.ts`: a stuck thead's lines
  follow the table's visibility.
- Storybook (`effects.stories.ts`): the paint in the browser, the rows
  kept, and a golden (`Visibility`); a fade-out paired with `invisible`
  (`VisibilityFade`); a host hidden by an ancestor showing at once
  (`HiddenAncestor`).

## Touch points on implementation

- types.ts: `CellStyle.visible`, and each inline entry's.
- style.ts: `readVisible`, a fade's hold (`holdVisible`); the
  `::backdrop` read returns none for a hidden one.
- tree.ts: each inline element's `visible`, the anonymous runs' and
  renderer leaves' from their element, and an entry for the text an
  inline element split around a block leaves in a run
  (`collectRunNodes`).
- plain-text.ts: `walk` guards each piece of a node's own ink on
  `visible`, and each text cell on its inline element's or the leaf's;
  a table hands its lines to a stuck part only while it shows.
- pointer.ts: `descend` passes a hidden box through unless something
  of it shows at the cell (`shows`); the top-layer stack likewise.
- paint.ts: a hidden layer root's box takes no hit and applies no
  `backdrop-filter`.
- focus.ts: candidates skip a hidden box or inline element.
- selection.ts: `charVisible`; the copy's characters, breaks, and row
  and cell separators skip what is hidden.
- element.ts: the gesture units ask `charVisible`; `#holdFades` finds
  the fades before the read.
- render.ts: the editable colors' ground skips a hidden fill;
  `data-mw-invisible` on a hidden laid-out element.
- styles.css: the host visible while the engine reads, hidden before
  its first layout, a nested host skipped; a stray-text container's
  rows shown through unless `data-mw-invisible`.
