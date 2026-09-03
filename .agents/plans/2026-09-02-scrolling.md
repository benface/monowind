# Scrolling implementation plan

Status: **implemented** (2026-09-02), phases 1-7 landed; settlements
recorded in the spec (auto axes reserve their gutter only on overflow,
after the CSS overflow coercion discovery; native range pinned to the engine's via
the --mw-se-* spacer; scrollbar-width capability probe + first-read
cache for Firefox's sticky computed value). Docs phase folded into
the spec update.

## Phases (each ends green: `pnpm check` + affected visual/story runs)

### 1. Style model — per-axis overflow

- `CellStyle.overflow` becomes `{ x: OverflowAxis; y: OverflowAxis }`
  with `OverflowAxis = "visible" | "clip" | "scroll"` (`auto` and
  `scroll` both read as `"scroll"`; `hidden` stays `"clip"`; the CSS
  coercion — one non-visible axis forces the other's `visible` to
  compute `auto` — applied at read time in `readCellStyle`).
- Update every consumer of today's single flag with an EXPLICIT
  per-axis mapping (don't let "suite green" hide semantic choices):
  truncation/ellipsis keys on the INLINE axis (`overflow.x` clipping,
  per CSS text-overflow); `data-mw-clip` on any clipping axis;
  multicol's paragraph-flow eligibility on either axis non-visible;
  the sr-only heuristic keeps its own raw `cs` reads. Behavior for
  existing authored values must not change — the suite is the
  referee, the mapping above is the intent.

### 2. Layout — gutter + scroll range

- A `"scroll"` axis reserves a one-cell gutter on its end edge by
  FOLDING it into `resolvedPadding` (+1 on that side at padding
  resolution time). One fold point makes every content-box
  computation, intrinsic-size path, AND the native overlay (the
  companion applies `--mw-p*` as real padding) inherit the gutter for
  free — no third inset category threaded through the layout modes.
  Paint re-derives the gutter cell's position from `style.overflow`
  (the outermost inset cell on that edge); the spec's
  border|gutter|padding order is what renders.
- `readCellStyle` also reads `scrollbar-width` (none → gutter 0) and
  `scrollbar-color` (thumb/track ink colors; default currentColor) —
  the native-scrollbar hide rule must be `[measuring]`-gated for the
  read to see authored values.
- After layout, the engine records per-container `scrollSize` (content
  cells) and `scrollMax = scrollSize − contentBox` per axis on the
  LayoutNode. Range comes from engine layout, never `scrollHeight`.
- Unit tests: gutter reduces content width by exactly one cell;
  scrollMax math; `auto`/`scroll`/mixed-axis combos; no gutter for
  `clip`/`visible`.

### 3. Paint — clip + offset walk

- Thread `{ clip: Rect, offsetX, offsetY }` through the plain-text
  walk: a scroll container clips its DESCENDANTS' ink to its content
  box and shifts them by the cell-quantized offset; its own
  decorations (border, gutter) paint unclipped. Implement as a
  wrapped `put` per subtree that culls outside the active clip —
  nested containers INTERSECT rects, so nesting composes by
  construction. Also route today's absolute-descendant
  `overflow: clip` truncation through the same rect.
- Scroll offsets live on the LayoutNode (`scroll: {x, y}` in cells),
  written by the element plumbing (phase 5); headless default 0, so
  goldens are unchanged and tests can set offsets directly.
- Gutter ink: track/thumb painted as container decoration —
  `scroll` always (full thumb when no overflow), `auto` only when
  scrollMax > 0. Thumb length = max(1, round(visible fraction ×
  track)), position proportional.
- Unit tests: scrolled container paints shifted content, culls outside the
  box; thumb geometry; blank `auto` gutter without overflow.

### 4. Glyph roles

- `GlyphTable` gains optional `scrollTrack` / `scrollThumb`; defaults
  `░` / `█`; `ascii` maps `|` / `#`; resolution through the
  container's set like borders. Unit tests beside glyphs.test.ts.

### 5. Element plumbing (the interactive half)

- `#schedulePaint`: paint-only pass from `#lastLayout` (no measuring);
  scroll events coalesce into one rAF paint. Respect `holdStructural`
  during a live grid-mode drag.
- Scroll capture: `scroll` doesn't bubble — a capture-phase listener
  on the host catches light-DOM container scrolls; the target maps to
  its LayoutNode (element → node map from the last layout), offset =
  `floor(scrollTop/cellH)` clamped to the engine's scrollMax.
- Settle: `scrollend` (or ~150ms debounce fallback) snaps the native
  position to the cell multiple via `scrollTo({behavior: "instant"})`,
  clamped to the engine range; idempotent by construction.
- Bottom-stick: before applying a layout, record containers with
  `offset === scrollMax && scrollMax > 0`; after, re-pin those to the
  new max (native scrollTop write → normal scroll path repaints).
- Grid-mode wheel router: non-passive `wheel` listener; hit-test the
  cell, walk the chain to the nearest `"scroll"` container, chain
  OUTWARD per axis when a scroller can't consume the delta, then
  `scrollBy` and `preventDefault` ONLY when something consumed —
  otherwise the page keeps scrolling. Normalize `deltaMode` (line
  deltas × cell height, page deltas × content box). Text mode: no
  listener work — native.
- After a scroll repaint, refresh the synthesized pointer states
  (`#updatePointerStates`): the cells under a stationary pointer
  changed, so hover/active/cursor must re-resolve without waiting for
  a pointermove.
- Gutter thumb drag: pointerdown on a gutter cell (grid mode's
  existing pointer routing; text mode via the same engine listener —
  the gutter is grid ink in both) maps drag distance to offset.
- Companion CSS: scroll containers keep authored overflow live
  (exclude them from the clip enforcement), plus
  `scrollbar-width: none !important` and
  `::-webkit-scrollbar { display: none }`; `data-mw-scroll-x/y`
  attributes written by render.ts.

### 6. Hit-testing

- `hitChain` applies each container's scroll offset while descending;
  gutter cells resolve to the container itself. Pointer tests extend
  pointer.test.ts.

### 7. Stories, visual, play

- Storybook: `Features / Scrolling` story — a fixed-height scroll container
  (`overflow-y-auto`) with long content, a horizontal `overflow-x-auto`
  code block, a nested-scroller case; assertions on gutter glyphs,
  shifted content after programmatic scroll, hover in a scrolled container.
  Visual goldens for the scrolled states (programmatic scrollTop +
  settle before screenshot).
- Play smoke: scroll the sample's article scroll container (add one to the
  default sample only if it reads naturally; otherwise storybook
  carries coverage).
- Cross-engine interactive verification (playwright chromium/webkit/
  firefox): wheel over a scroll container in BOTH select modes scrolls it; settle
  alignment (mirror/light overlay realigns); tab-focusing a control
  below the fold scrolls it into view natively and the grid follows.

### 8. Docs

- Spec flips to implemented (settlements recorded); cell-model
  deviations list gains the scroll entries; root README status blurb
  and core README mention scrolling; theming spec's roster note gains
  the two new roles.

### Out of scope, stated

- `overflow` on the `<mono-wind>` HOST itself is not a scroll
  container in v1 (the grid pre is sized to the host); scrolling
  lives on inner wrappers. Documented in the spec.

## Risks / watchpoints

- The companion currently enforces `overflow: clip` broadly
  (`data-mw-clip`, textarea rules) — phase 1/5 must not let a scroll
  container fall into those locks, and textareas stay engine-sized
  (no user scroll) as today.
- Repaint-per-scroll-frame walks the whole tree; the signature path
  bounds DOM churn, and profiling waits until a real scroll container feels slow
  (region-limited repaint is deliberate non-scope).
- Selection preservation across scroll repaints is positional (spec
  deviation) — watch the story tests for surprises in webkit.
