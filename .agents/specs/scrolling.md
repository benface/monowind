# Scrolling (`overflow-x/y: scroll | auto`)

Status: **implemented** (2026-09-02) — engine (per-axis overflow,
gutter bars, clip+offset paint walk, scroll plumbing in
element.ts) with settlements noted inline. This file is the source of
truth.

## Locked decisions

- **Why native scrolling works at all (load-bearing mechanics).**
  Every laid-out element is `position: absolute` with PARENT-relative
  `--mw-x/y` (the companion's geometry rule), so a scroll container is
  its children's containing block: native scrolling moves them, and
  absolutely positioned descendants legally create native scrollable
  overflow, sized in the same cell-quantized pixels the engine
  planned. The engine derives the scroll RANGE from its own layout
  (content cells minus content box) and PINS the native range to it:
  browsers disagree on end-edge padding in scrollable overflow (the
  native ceiling can otherwise sit BELOW the engine's max, stranding
  the last rows), so a 1px `::after` spacer ends at exactly
  `max + box` cells (`--mw-se-*`, written by render.ts) making
  `scrollHeight − clientHeight` equal the engine's max in every
  engine — with NO overhang: any native room past the engine's max
  would latch a native (text-mode) gesture to an invisible scroll
  instead of chaining. Rounding can still put the native ceiling a
  pixel either side of the multiple, so "at the native ceiling" reads
  as "at max" and the settle parks the max cell ON the ceiling.
- **The browser owns scroll physics; the engine mirrors on the grid.**
  Authored `overflow(-x|-y): auto | scroll` stays LIVE on the light
  element (not normalized away like `clip`/`hidden` are), so the
  container scrolls natively — wheel, touch momentum, keyboard,
  `scrollIntoView`, focus-follows-scroll, anchors, and the
  `scrollTop`/`scrollLeft` programmatic API all come from the browser.
  The engine listens for `scroll` events and repaints the grid with
  the container's offset. This is the same division of labor as focus,
  hover, and forms: native behavior in the light DOM, ink on the grid.
- **Scrolling is PAINT-ONLY.** Layout is scroll-independent: content
  is laid out at its natural size inside the container's fixed box;
  a scroll offset only changes which cells the subtree's ink lands on.
  A `scroll` event therefore triggers a repaint pass, never a layout
  pass — new plumbing: a schedulePaint path beside scheduleLayout that
  reruns paintGrid from the LAST layout, with each container's current
  offset read at paint time. The walk offsets the container's
  descendants by the cell-quantized scroll and CULLS ink at the
  PADDING box per CSS (reserved gutter cells excluded — the bar owns
  them): padding sits blank at the scroll extremes and content flows
  through it mid-scroll. The same rect covers `overflow: clip`. During a live grid-mode drag,
  scroll repaints are HELD like any structural repaint
  (`holdStructural`) and apply on release.
- **Offsets are cell-quantized for ink; the native position settles to
  match.** The grid paints the cell it already shows while the native
  position stays within half a cell of it (a wobble never flips a
  row), and otherwise the cell NEAREST the position, ties broken away
  from the shown cell — a 40px keyboard step against 16px cells is two and a half
  cells and moves three in either direction, so Up and Down take the
  same number of presses — and the native ceiling reads as max (see
  the first bullet); every frame during a scroll, cheap through the
  existing signature/patch paths. Mid-gesture the native (invisible)
  text may sit up to half a cell off the grid ink; once scrolling has
  gone quiet (`scrollend` plus a short debounce — a held key fires
  scrollend after every step, and an instant settle would cut the next
  step's animation short) the engine snaps the native position to the
  cell the grid already shows — never a different cell, or the grid
  would jump after the gesture (the max cell settles on the ceiling) —
  restoring exact overlay alignment (selection and hit-testing read
  the settled state). The snap is idempotent — its scroll event
  changes no cell and the follow-up settle no-ops. No CSS scroll-snap
  — content has no per-row snap targets.
- **Mode-independent scrolling.** In `select="text"` the native path
  just works (the light DOM has pointer events). In `select="grid"`
  light elements are pointer-inert and wheel events land on the grid,
  so the engine ROUTES them — the synthesized-pointer-state pattern:
  hit-test the wheel's cell, walk the hit chain to the nearest
  scrollable ancestor, `scrollBy` its light element (with
  `preventDefault`), letting native physics take over from there.
  Both modes scroll identically. Nested scroll containers resolve by
  nearest-ancestor — and because programmatic `scrollBy` does NOT
  chain natively (a no-op at the boundary, unlike a real wheel), the
  router itself walks outward per axis: a delta the nearest scroller
  cannot consume goes to the next scrollable ancestor.
- **TUI scrollbars, engine-drawn.** Native scrollbars are hidden by
  an engine-owned rule on scroll containers (`scrollbar-width: none
!important` plus the `::-webkit-scrollbar { display: none }`
  fallback). Bars come in two forms, matching CSS's own semantics
  (settled during implementation — CSS COERCES the untouched axis of
  any scroll container to `auto`, so reserving for `auto` would eat
  both edges of every scroll container):
  - An EXPLICIT `scroll` axis reserves a one-cell gutter on its end
    edge (right column for y, bottom row for x — inside the border,
    outside the padding, folded into resolvedPadding) and always
    paints track `░` + thumb `█` (full-length thumb when nothing
    overflows).
  - An `auto` axis reserves its gutter only when content actually
    overflows — CSS parity: layoutNode lays out once without the
    gutter, and an overflowing `auto` axis re-lays out WITH it,
    keeping it regardless of the narrower result (the browsers' own
    anti-oscillation rule). Since one axis's gutter can push the
    other into overflow (a vertical bar narrowing a line that just
    fit), the re-layout repeats while a newly overflowing `auto` axis
    lacks its gutter — gutters only accrue, so at most one more pass.
    An overflowing `auto` scroll container is
    then indistinguishable from `scroll` — track, thumb, drag, the
    lot; a fitting one reserves and paints nothing. Paint, drag, and
    hit-testing read the RESERVED gutter (`node.scrollGutterCells`),
    never the style.
  - Bar THICKNESS is `--mw-scrollbar-size-x/y` cells per bar (the
    `scrollbar-<n>` shorthand and `scrollbar-x-<n>` / `scrollbar-y-<n>`
    longhands — `x` the horizontal bar's height, `y` the vertical
    bar's width; default 1) — CSS `scrollbar-width` has no length form
    (`thin` and `auto` both mean the default; `none` still suppresses
    everything).
  - `scrollbar-inset-<n>` / `-x-<n>` / `-y-<n>` (`--mw-scrollbar-inset-x/y`
    cells, default 0) keep cells clear AROUND the bars, as room for
    the author's own arrow buttons (absolutely positioned; the engine
    draws none): `x` moves the vertical bar that many columns inward
    (the band grows by it, the freed columns stay blank) and insets
    both ends of the horizontal bar — except that a track always runs
    up to the other axis's band when there is one, so two bars meet
    at a single blank corner cell; `y` is the mirror. Paint and thumb
    dragging share one bar-geometry helper.
  - Thumb length is proportional to the visible fraction, shrunk until
    every scroll offset gets its own thumb position (at most
    track − max cells, at least one) — a scrollable bar always shows
    track, and each step moves the thumb while the track has room —
    no arrow caps; when both axes show bars the shared corner
    block stays blank. Dragging the thumb is engine-routed in both
    modes (the bar is grid ink; there is no native scrollbar to
    grab).
- **Scroll positions survive relayouts.** The measuring mask collapses
  container geometry (the range spacer is off) and browsers clamp native
  positions during that reflow — Chromium eagerly, Firefox lazily —
  so the engine snapshots every scroll container BEFORE the mask, paints the
  layout pass from that snapshot (a native read inside the pass is a
  cell short, and a paint from it flickers against the restored
  position), and writes it back AFTER the unmask — bottom-stick
  applies there too. Restoring any earlier gets wiped by the clamp.
- **`scrollbar-width` and `scrollbar-color` are honored.**
  `scrollbar-width: none` suppresses gutter and bar entirely (the
  full-width opt-out; scrolling still works); `thin` and `auto` both
  mean the 1-cell treatment. `scrollbar-color: <thumb> <track>`
  colors the ink; `auto` (the default) paints uncolored — currentColor
  for thumb and track alike, like borders (the glyph density tells
  them apart). The companion seeds Tailwind's `--tw-scrollbar-thumb` and
  `--tw-scrollbar-track` variables with `currentColor` so a lone `scrollbar-track-*`
  or `scrollbar-thumb-*` utility keeps the other half visible (their
  registered initial is transparent); the property itself is left
  alone — it inherits into native scrollers, where equal colors would
  hide the thumb.
  `transparent` paints nothing — `not-hover:scrollbar-thumb-transparent`
  makes an overlay-style bar. Read hardening,
  settled during implementation: environments with forced overlay
  scrollbars (headless Firefox among them) compute `scrollbar-width:
none` on EVERY element — a one-time pristine-probe detects that and
  the engine then ignores the property (bars stay on). Where reads
  are trustworthy, the authored value is cached from the first clean
  layout, because Firefox never re-resolves the computed value once
  the engine's own hiding lock has matched (authored changes after
  the first layout go unseen there — deviation).
- **Scrollbar glyphs join the glyph-set vocabulary.** New optional
  `GlyphTable` roles (`scrollTrack`, `scrollThumb`) defaulting to `░`
  and `█` — additive per the theming contract, so `ascii` can map them
  to `|`/`#`, every theme customizes them exactly like border glyphs
  (resolved through the container's `--mw-border-glyphs` set), and
  custom sets override per glyph.
- **Sizing semantics per CSS.** A scrollable container's intrinsic
  contribution and box sizing follow the existing overflow rules
  (scrollable overflow does not grow the box); without a constrained
  size on the scroll axis there is nothing to scroll, exactly as in
  CSS. The scrollable range is the laid-out content size minus the
  content box, in cells.
- **Per-axis overflow in the style model.** `CellStyle.overflow` is
  per-axis four-state (`visible | clip | auto | scroll`) read from
  the longhands — `auto` and `scroll` are both scroll containers
  (`scrollsAxis`), kept distinct because their GUTTERS differ
  (reserved always vs on overflow). The CSS coercion applies (one non-visible axis forces
  the other's `visible` to compute `auto`). Truncation keys on the
  inline axis's clip; the sr-only heuristic reads raw `cs` as
  before.
- **Bottom-stick across relayouts.** The browser preserves a
  container's scrollTop NUMBER through the engine's var rewrites, but
  a container settled at its MAX offset before a relayout that grows
  its content is re-pinned to max after layout (the terminal
  convention). Only a REAL bottom arms it: the pre-relayout max must
  be > 0, so a scroll container that just became scrollable stays at the top
  instead of leaping to its new bottom. This is not sugar: engine layout is async, so the
  web's own pin-to-bottom line (`scrollTop = scrollHeight` right
  after appending) reads pre-layout geometry here and cannot work —
  the engine-side pin restores effective web parity. Containers
  scrolled anywhere else keep their position natively, untouched.
- **The host itself is not a scroll container** in v1 — `overflow`
  on `<mono-wind>` is ignored for scrolling (the grid is sized to the
  host); put scrolling on an inner wrapper.
- **Gesture latching and `overscroll-behavior`, both modes.** The
  grid-mode router decides chaining at gesture START (native
  scroll-chaining semantics) and LATCHES the gesture to what it
  started on: a scroll container — mid-gesture boundary hits are consumed, never
  leaking to an ancestor or the page — or the page, so a scroll container sliding
  under the stationary pointer never captures a page gesture
  (Chromium also marks such a sequence's later ticks non-cancelable,
  which the router honors — unless nothing outside the host can scroll
  that way, where routing is the only useful thing left; zero-delta
  phase ticks — Safari's, and Chromium's momentum cancel when a finger
  lands mid-inertia — end the latch and are canceled so the sequence
  they open stays cancelable). The DOM exposes no gesture phases (Safari
  excepted: its zero-delta phase ticks end the latch), so a gesture
  ends when ticks quiesce (200ms), the pointer moves, or the delta
  RISES after an inertia-shaped decay — momentum never rises (it
  often repeats a delta), finger ticks wobble, and confirmed inertia
  sticks for the
  gesture because a new push starts below the momentum it interrupts
  — so a scroll container at its end hands a new push to the page instead of
  blocking until the inertia dies. Momentum follows the pointer (its
  ticks land wherever the cursor went), so after a move a same-axis
  tick that continues the decay still belongs to the old gesture,
  while any rise or a new dominant axis starts the new one — a
  horizontal swipe on a second scroll container works while the first container's
  inertia is still ticking. A tiny first tick that nothing
  consumes (a swipe's cross-axis lead-in) is eaten without deciding —
  the next tick does. At the start decision,
  `overscroll-behavior: contain | none` on a boundary scroll container stops the
  outward walk (the gesture stays there, inert). The native path
  honors all of this natively; in grid ink `contain` and `none` are
  equivalent (there is no local bounce to suppress).
- **Authored `scroll-snap` is unsupported inside a host** for now:
  native snap targets on light elements would fight the engine's
  cell settle-snap. Documented, revisit on demand.
- **Hit-testing follows the ink.** `hitChain` applies each scroll
  container's cell offset while descending, so hover, active, cursor
  mirroring, and semantic selection (`semantic-selection.md`) see the
  element actually under the pointer in a scrolled container. Cells in
  the gutter hit the container itself.

## Deviations (documented, like the cell model's running list)

- Mid-gesture the native overlay may trail the grid ink by less than
  one cell until `scrollend` snaps it; selection made during an active
  scroll gesture may need the settle to align. This is VISIBLE on
  natively rendered content: form controls (and text-mode selection
  bands) slide fractionally with the native scroll while the grid ink
  steps by cells, converging at the settle. Rubber-band overscroll is
  the same story: the clamped grid ink never bounces (TUIs don't),
  only the native layer does, converging when the bounce ends.
- A live grid-mode Selection inside a scrolled container is positional, not
  content-anchored: scrolling repaints the scroll container's cells and the
  selection keeps its grid coordinates (terminal behavior), rather
  than following the content.

## Resolved (were open questions)

- **Touch panning in grid mode**: where the primary pointer is coarse
  (`@media (pointer: coarse)`), scroll containers take pointer events
  in grid mode — their children stay inert, so a touch lands on the
  container and the browser pans it natively (physics, momentum,
  chaining, `overscroll-behavior`), mirrored on the grid like any
  scroll. A long-press inside a scroll container selects the ELEMENT's
  text there (the container's subtree is `user-select: text` on those
  devices — an element selection like a semantic one, copied by the
  engine; specs/semantic-selection.md), and the thumb drag stays a
  mouse/pen gesture — a finger on the gutter pans. Fine-pointer
  devices are unchanged: the grid keeps every pointer event, and
  wheel routing plus the thumb cover scrolling. Both modes: the
  pointer handlers ignore a touch until it lifts — no hover synthesis,
  no press chain, no dynamic relayout on `pointerover`/`pointerdown`/
  `pointercancel` (iOS fires the cancel the moment it takes the pan).
  iOS decides which scroller owns a pan in the first frames, and any
  relayout reflows the light DOM under the finger, which abandons the
  pan to the page (reproduced on the iOS Simulator). `pointerup` is
  the release: its relayout picks up the tap's outcome.
- **`scrollend`**: used where present; where missing (older Safari), a
  debounced settle timer (160ms after the last `scroll` event) snaps
  instead.
- **Gutter corner**: blank.
- **Keyboard scrolling**: nothing synthesized in v1 — the engine never
  adds focusability. A container the author makes focusable
  (`tabindex`) scrolls natively with keys; browsers' default
  nearest-scrollable keyboard heuristics cover text mode.
- **CSS scroll-snap**: considered for the cell-quantization settle and
  rejected — snap positions come from snap-target BOXES
  (`scroll-snap-align` on descendants), and the scrolled content has
  no per-row elements to carry them (text rows are not boxes at all).
  The engine's `scrollend` snap (`scrollTo` with `behavior:
"instant"` to the cell multiple) is exact and simpler.
- **`position: sticky`**: out of scope here; becomes implementable on
  top of the clip/offset machinery (tracked as its own future spec).

## Interactions with existing machinery

- **Selection preservation** (paint.ts): scroll repaints flow through
  the same structure-match/rebuild paths; flat-offset capture/restore
  is position-based, consistent with the deviation above.
- **sr-only heuristic**: unchanged — `auto`/`scroll` are not clipping
  values, so scrollable boxes are never dropped.
- **Leaf renderers**: a leaf inside a scrolled container needs no changes
  (its ink is walked like any subtree); a leaf's own shadow transcript
  scrolls with its element natively.
- **Themes**: gutter glyphs resolve through the decoration owner's
  glyph set like borders and rules do.
