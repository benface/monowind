# Anchor positioning implementation plan

Status: **implemented** (2026-09-13; every phase green, the golden
recorded). Spec: `anchor-positioning.md` — normative; `positioning.md`
for the absolute pass it extends, `top-layer.md` for the popovers it
usually places; this plan only sequences them. Phase 2 of
`2026-09-13-components.md`. What shipped differently from the phases
below:

- Inline elements anchor too: a `<span>` in a paragraph run is not a
  node, so its entry carries the name and the positioning pass
  records its first fragment's rect.
- The engines compute the initial `position-anchor` as `normal`
  (the current spec's initial value; `auto` is its older spelling),
  both read as the implicit anchor.
- A fallback may be a `position-area` of its own, not only flip
  keywords, as the spec allows; `position-anchor: match-parent` reads
  the parent's.
- A scroll follows through a relayout: the scroll offsets land on the
  tree before the positioning pass, an anchor's rect is moved by the
  scrollers the box escapes, and a scroll of such a scroller
  schedules a layout (`anchorScrollers` on the root).
- The stories live in `anchor.stories.ts` (Features / Anchor
  Positioning): `Placement` and `Fallbacks` (the flips live, through
  a scroll and the pane's width), goldens, and `InScroller`, hidden.
- `anchor-name` lists every name; `anchor-center` in `justify-self`
  or `align-self` centers on the anchor from any side.

## Shape

Three things are new: the read of the anchor properties, the anchored
placement in the positioning pass — the area as the containing block,
the alignment, the flip tactics — and the area written onto the light
element. The anchor's rect comes from the pass itself, which already
walks top-down with absolute origins; the browser's own anchor
positioning stays off the light elements, whose place the engine
writes as for any positioned box.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 0. Probe

A temporary `zz-probe` story, deleted after: the computed strings of
`position-area` for one and two keywords, the logical and `self-*`
spellings, and of `position-try-fallbacks` for a list, in the three
engines; whether the companion's `left`/`top` locks keep the light
element off the browser's own anchored placement where it exists
(Chromium, WebKit), or whether `position-anchor: none` must be locked
outside `[measuring]` too.

### 1. The read

- style.ts: `anchorName` (the first dashed ident, null for none),
  `positionAnchor` (a dashed ident, `"auto"`, or null), `positionArea`
  (the two physical axis keywords, null for none), `positionTryFallbacks`
  (the list of tactics, each a set of the three flip keywords) on
  `CellStyle`; the logical keywords mapped for a horizontal LTR host.
  The implicit anchor of a popover: the invoker named by its id in a
  `popovertarget` or `commandfor` in the host, resolved in the read
  from the element's own id.
- styles.css: whatever the probe says the companion must lock.
- Tests: the read of each property and spelling; the implicit anchor.

### 2. The placement

- positioning.ts: an anchored box (out of flow, a `positionArea`, an
  anchor found by name among the nodes laid out before it in tree
  order — the pass collects `anchorName` nodes with their absolute
  rects as it goes) takes the area as its containing block: the 3×3
  grid of its containing block cut by the anchor's border box, an
  anchor edge past the block leaving an empty row or column; `auto`
  insets are the area's edges, the box laid out inside it with the
  existing `placeAbsolute` machinery, then aligned toward the anchor
  (against the side, along the kept edge of a span, centered under
  `span-all` and `center`) unless `justify-self`/`align-self` say
  `start`, `end`, `center`, or `anchor-center`.
- The tactics: each of `position-try-fallbacks` mirrors the area
  (`flip-block` the row, `flip-inline` the column, `flip-start` the
  two axes swapped) and relays out the box's subtree in it until one
  fits its area; none fitting, the first stands.
- render.ts: the area taken written as `data-mw-area` (two physical
  keywords) on the light element; `data-mw-area` removed elsewhere.
- Tests: a box under, above, beside, and centered on its anchor,
  spanning and flush on each side; a shrink into a narrow area and a
  `whitespace-nowrap` overflow; a flip at the bottom and at the right
  edge, a `flip-start`; the alignment keywords; an anchor inside a
  scroller followed through a scroll; a margin gap; the implicit
  anchor.

### 3. Stories, goldens, docs

- An `Anchors` story in `top-layer.stories.ts`: a menu under its
  button, the light element on its cells; a flip near the host's
  bottom edge; a tooltip above a word; a submenu beside its item. A
  golden of the resting anchored boxes.
- The spec's status; the components plan's phase 2 marked.
