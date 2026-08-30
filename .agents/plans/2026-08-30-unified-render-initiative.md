# Unified render initiative (Milestone 6)

Status: **planning.** Delivers Milestone 6 in the top-level plan:
collapses what were separately-scoped as "Native interaction" and
"Visual system" into a single architectural reshape, plus the merger
of "layered" and "plain-text" modes into one render.

## Motivation

Today monowind ships two rendering modes and each has a distinct problem:

- **Layered** (default in real apps): fully interactive, native events,
  focus, ARIA, forms. But characters ride on the browser's native text
  layout — anti-alias, font metrics, and subpixel positioning let content
  visually overlap in ways an actual terminal never would (`AbsoluteChildren`
  is the canonical example), and decorations sit in a separate overlay
  that can drift by a pixel from the light DOM's text.
- **Plain-text**: strict cell grid, perfect TUI look, one-glyph-per-cell,
  copy-pastes into a code editor unchanged. But the whole light DOM is
  hidden — no event handlers fire, screen readers see only the shadow's
  `<pre>`, forms don't work.

The goal: **one render** with the plain-text mode's cell-perfect look AND
the layered mode's live DOM. The two modes go away; a single `select`
prop chooses whether text selection copies the semantic element text
(default) or the whole visual grid.

## Design decisions (locked)

Answered 2026-08-30:

1. **Rendering path**: engine paints all glyphs in the shadow; the
   light DOM keeps its real text nodes but styled `color: transparent`
   and `text-shadow: none` (plus `caret-color: inherit` on editable
   elements) so events, ARIA, focus, and selection still work. The
   browser never gets to reflow characters; the engine owns every
   glyph's cell.
2. **`select` prop**: enum `select="text" | "grid"`, default `"text"`.
   - `"text"` (default): selection copies each element's own text, like
     any DOM (`<a>Save</a>` → `Save`). Decorations and layout whitespace
     are `user-select: none`.
   - `"grid"`: selection copies the whole shadow-rendered grid,
     decorations and layout whitespace included. The whole light DOM
     is `user-select: none`; the grid takes over.
3. **Backgrounds clear decorations**: any `bg-*` on an element clears
   the decoration glyphs its box covers (matching what layered already
   does natively via z-order). Adds a `bg-clear` utility that does
   the same occlusion without a visible fill — the "punch a hole in
   the decoration layer" primitive.
4. **The old modes go away**. No `<mono-wind plain-text>` attribute; no
   two paint paths in the engine. Migration: `plain-text` becomes
   `select="grid"` (and now also interactive).

## Architecture sketch

The current `plain-text` renderer already knows how to walk the layout
tree and emit a per-cell glyph grid with paint (color, font-weight,
font-style, decoration). This becomes the ONE renderer. The layered
codepath (per-element positioned decoration spans in the shadow, plus
the light DOM rendered natively) retires.

What has to change:

- **Light DOM stays intact** (frameworks own it, events fire, ARIA
  works). The engine still writes `--mw-*` geometry vars on every
  element (the framework code that reads them keeps working), but now
  the light DOM's text becomes VISUALLY inert: `color: transparent`,
  `text-shadow: none`, `caret-color: inherit` for editable elements.
- **Interactive elements' pointer regions** need to stay clickable
  where their glyphs paint. Since the shadow grid sits ABOVE the light
  DOM (`z-index` in the shadow root's `#viewport`), clicks would land
  on shadow glyphs first. Fix: `pointer-events: none` on every shadow
  glyph span; the click passes through to the light DOM element
  underneath, which is positioned by our own `--mw-x/y/w/h` vars at
  the exact same cells.
- **Focus indication**: native browser focus outlines are suppressed
  (they'd clip against shadow glyphs and paint off-grid). Instead, a
  companion-CSS default inverts fg/bg on `:focus-visible` for
  interactive elements — the bg change re-triggers layout via Phase 3
  and re-renders via Phase 4 (bg occludes decorations), so the
  focused element appears as a solid inverted block. TUI-native and
  drops out for free. Cell-aware `outline-*` utilities are deferred.
- **Editable text** (`<input>`, `<textarea>`, `contenteditable`): the
  value has to stay ON-GRID like everything else — the exemption
  approach would leave a fractional-width native rendering sitting
  inside a cell-precise grid, visibly misaligned. Approach: sync-on-
  input. Listen to `input`/`beforeinput` on editable elements, re-run
  the layout pass (so `input.value` reaches the shadow grid), and
  paint a synthetic caret glyph at the cell corresponding to
  `selectionStart`. The native element stays `color: transparent`, so
  the browser handles all typing/deletion/selection semantics
  (keyboard, IME, mobile input, `selectionchange` events, native
  clipboard) — we just mirror what it holds onto the grid every
  keystroke. Selection highlight paints via a `::selection` style on
  the invisible native text so users see the range they've selected.

The renderer takes the layout tree and produces the cell-precise
shadow content. Shadow layout — `#viewport` positioned, `#grid`
absolutely overlays the slotted light DOM:

```
<div id="viewport">              <!-- position: relative -->
  <slot></slot>                  <!-- light DOM, color: transparent -->
  <div id="grid"></div>          <!-- absolute inset: 0, one span per cell,
                                       pointer-events: none -->
</div>
```

Decorations become glyphs in the same grid as text — one flat span
tree, everything owned by one renderer. That's the collapse.

### Backgrounds

Currently, `background-color` is a paint-only style the engine reads
into `CellStyle.backgroundColor` and passes through (no engine action).
For the unified render:

- Any element with a non-transparent `bg-*` **clears the decoration
  glyphs its box covers** — before this pass, the engine paints spaces
  (with the element's bg color as paint) over every cell in the
  element's border box; decoration glyphs from ancestors don't reach
  those cells. Matches what layered mode gets for free via z-order.
- New `bg-clear` utility (Phase 5) does the same occlusion without a
  visible fill.
- The plain-text export (`toPlainText()`) becomes trivially correct
  for backgrounds because the grid already IS the plain-text render;
  cleared cells emit spaces.

### Dynamic state (Phase 3)

Currently `hover:`/`focus:` variants on layout-affecting properties
don't retrigger layout — the engine measures once per frame and reads
computed styles, but nothing tells it to re-measure when a pseudo-state
changes. Under the unified render, this becomes both more visible (any
paint drift is immediate) and easier to fix (one renderer, one relayout
signal).

Approach: an engine-side `:hover`/`:focus-visible`/`:active`/`:checked`
watcher on every laid-out element — `pointerover`/`pointerleave` and
`focusin`/`focusout` listeners on the host (event delegation), each
scheduling a relayout for the target subtree. This is small; the
architecture doc's open "dynamic-style question" resolves here.

## Milestones

Each milestone is independently mergeable (leaves a working repo).

### Phase 1: `select` prop plumbing (attribute-only rename)

Pure attribute rename that keeps today's rendering intact — the
existing layered/plain-text split stays behind the scenes until
Phase 2 replaces it. No visual change beyond the attribute name.

- Add `select` attribute → `observedAttributes`; values `"text"`
  (default) and `"grid"`. Rename the internal `plain-text`-attribute
  check to read `select="grid"` instead — same code path, new
  attribute name.
- The old `plain-text` HTML attribute goes away from the public
  surface (it was undocumented outside the changelog anyway; the
  Storybook toolbar was its main user).
- Storybook toolbar toggle: `plainText` → `select` (same UX, new
  values); visual-golden URL pin updates from
  `&globals=plainText:layered` to `&globals=select:text`.
- `host.toPlainText()` unchanged (still calls `renderPlainText` on
  the last layout).
- Story `data-test` attributes (`data-test="plain-text"`,
  `data-test="layered"` in the plain-text stories) are unaffected —
  they're test IDs, not the CSS attribute.

### Phase 2: The unified renderer (the big one)

Split [render.ts](packages/core/src/render.ts) into two: the
geometry-writing half (writes `--mw-*` vars, `data-*` attrs,
quantized inline padding, class flags on the light DOM — required for
pointer routing and companion-stylesheet layout) STAYS; the
decoration-painting half (per-BorderRun `<span>`s in `#decorations`)
is GONE.

New unified renderer, alongside the geometry pass:

- Walks the layout tree like [plain-text.ts](packages/core/src/plain-text.ts)
  does today (borders, decoration runs, leaf text with `charInline`
  and insets, ellipses, painted-space preservation).
- Emits per-cell spans in `#grid`: one span per contiguous same-paint
  run per row, positioned via CSS grid or absolute placement.
- Sets `pointer-events: none` on every glyph span (clicks pass through
  to the light DOM at the exact same cell).
- Makes the light DOM visually inert (`color: transparent`,
  `text-shadow: none`), with a `::selection { color: <fg> }` rule so
  selection stays visible on the transparent text under `select="text"`.
- Removes `#decorations` and `#plain-text` from the shadow template;
  `#grid` is the only render target.

Test strategy: the visual golden suite is our safety net. This is the
one phase where broad golden churn is expected — the goldens
regenerate to the new cell-perfect look, and reviewers eyeball each
diff for regressions. The 3-engine story suite pins the ownership loop
(state → mutation → relayout still works after this change).

### Phase 3: Dynamic-state relayout

- Host-level `pointerover`/`pointerleave` + `focusin`/`focusout` +
  `input`/`change` listeners, event-delegated to laid-out elements.
- Each fires a scoped relayout (or the whole host, first cut — measure
  cost before optimizing).
- Resolves the architecture doc's dynamic-style open question.

### Phase 4: Backgrounds occlude decorations (default)

- New pass in the renderer: any element with non-transparent
  `background-color` fills its border-box with painted spaces
  (space glyph + bg color as paint), which naturally overwrites
  decorations from ancestors thanks to the last-wins per-cell rule
  the grid already uses.
- Host bg (`<mono-wind class="bg-*">`) fills the whole grid as a
  base layer under everything (same rule applied to the root box).
- Handles the story you flagged (`InlineDisplay` badge with `px-1` +
  `bg-*`); the invert-on-focus default (Phase 6) also lands
  correctly since it changes the focused element's bg.

### Phase 5: `bg-clear` utility

- New `bg-clear` utility: fills the element's border-box with plain
  spaces (glyph = ' ', paint = undefined) that overwrite ancestor
  decoration glyphs, without painting a bg color. Same last-wins rule
  as Phase 4; the difference is undefined paint vs a colored paint.
- Authors: `bg-transparent` when they want the browser default (no
  occlusion); `bg-clear` when they want the cutout effect.
- Encoding: `@utility bg-clear` sets `background-color: transparent`
  (so it cascades over an earlier `bg-red-500` in `bg-red-500
sm:bg-clear`) and mirrors `--mw-bg-clear: 1` for the engine to read
  (bg-color reader treats this as "cutout" and skips the colored-space
  fill in Phase 4's path).

### Phase 6: Interactive semantics wiring

- `pointer-events` audit: buttons, links, form controls, `contenteditable`
  all confirmed clickable at their glyph cells.
- Focus visibility: no new utility. Ship a companion-CSS default that
  inverts foreground/background on `:focus-visible` for interactive
  elements (`<a>`, `<button>`, `<input>`, `<textarea>`, `<select>`,
  `[tabindex]`, `[role="button"]`, etc.) — reads as TUI-native
  (ncurses/vim-style highlight) and drops out of the box thanks to the
  bg-occludes-decorations rule (Phase 4). Uses host-level `--mw-fg`/
  `--mw-bg` custom properties (defaults derived from the host's
  computed `color` / `background-color`) so authors can retune without
  writing selectors. Users can override the invert per-element with
  `focus:` Tailwind variants; native browser outlines are suppressed.
- Editable elements (sync-on-input, per architecture): `input`/
  `beforeinput` listeners re-run layout so `input.value` reaches the
  grid; paint a synthetic caret glyph at `selectionStart`;
  `::selection` on the invisible native text keeps the selected
  range visible.
- Selection semantics: `select="text"` puts `user-select: none` on
  the shadow grid, keeps the slotted light DOM selectable;
  `select="grid"` inverts. Stacking gotcha to prototype: the grid
  overlays the slotted light DOM; native drag-selection targets the
  layer the drag starts on. May need `pointer-events: auto` on the
  grid under `select="grid"`, `none` otherwise — verify empirically.
- Screen-reader audit: shadow glyphs are `aria-hidden`, light DOM
  carries semantics; verify VoiceOver/NVDA read the expected text.

## Open questions

1. **IME (input method editors)** in editable elements: composition
   events (`compositionstart`/`update`/`end`) may show intermediate
   half-composed text natively. Under sync-on-input, either sync on
   every compositionupdate too (choppy but on-grid), or pause the
   invisibility trick during composition so the native IME UI stays
   visible, then re-hide on end. Decide at Phase 6.
2. **Cost of relayout-on-hover**: probably fine. Continuous
   `ResizeObserver`-driven relayout during a viewport drag is worse
   (whole tree, sustained) and performs well today; a hover only
   dirties one subtree. Measure at Phase 3 anyway, but don't
   pre-optimize.
3. **Visual-golden regeneration scope for Phase 2.** Whole suite, with
   per-file review. Expect real diffs; keep the diff readable by
   landing Phase 2 as its own commit so bisect stays useful.

## Risk register

- **Frameworks and refs**: React/Vue/Svelte/Solid may keep refs to
  light-DOM nodes. As long as we don't move or remove them (only style
  them), refs stay intact. Verified path: no DOM restructuring.
- **iframe/portal edge cases**: some frameworks portal content
  elsewhere. Not in scope; portal targets should render as their own
  `<mono-wind>` host.
- **Text-selection UX in `select="text"`**: users may expect to
  drag-select across multiple elements (which is how normal HTML
  works). If the light-DOM elements aren't visually adjacent (grid
  cells between them), selection may feel odd. Prototype early.
- **Text-selection UX in `select="grid"`**: selection landing on
  shadow glyphs means the light-DOM text underneath is unselectable
  during a grid-select drag. Acceptable per user's design.
- **Performance ceiling**: per-cell shadow spans in a 200×80 render
  are 16,000 spans. Same-paint run coalescing (already done in
  `renderPlainTextSegments`) keeps counts down. Measure at Phase 2 review.

## Explicitly out of scope

Everything the top-level plan already lists as Deferred. This initiative doesn't add scrolling, transforms, forms
beyond `<input>`, virtualization, etc.

## Post-implementation doc sweep

When Phase 6 lands (all phases shipped), update in the same PR (or
immediately after):

- **`.agents/architecture/core-architecture.md`** — rewrite D3 to
  describe the single unified render (drop the "two rendering layers"
  framing, drop the "revision incoming" note); update the top-of-file
  status line; move the dynamic-style-detection entry from resolved
  under Milestone 6 to a historical note in D3's rationale.
- **`.agents/plans/2026-08-25-implementation-plan.md`** — mark
  Milestone 6 as DONE with the shipped scope; update the Scope
  section's `plain-text mode` line to describe the `select` prop
  instead; update the "Package structure" `plain-text.ts` comment
  (that file becomes the unified renderer's core, likely renamed).
- **`README.md`** — update the status paragraph to remove
  "unified-render initiative is next" and note the new `select` prop
  and interactive-in-grid capability.
- **`.agents/specs/cell-model.md`** — cell-aligned backgrounds
  reference (currently "Milestone 6 (unified render)") becomes
  "shipped" with a link to the render code.
- **This plan itself** — flip the status to "shipped" with a link to
  the release, and leave the phases as historical record.

## Success criteria

1. Every existing story renders correctly under the unified render (visual goldens updated per Phase 2).
2. React/Solid examples' counters still work (event loop unbroken).
3. `AbsoluteChildren` and `InlineDisplay` bg-badge cases visually
   match the current plain-text render (the whole point).
4. Screen-reader spot check passes: VoiceOver reads the semantic
   content, not the raw decoration glyphs.
5. `select` toggle behaves per its spec on all three engines.
6. `pnpm check` exit 0; no golden churn beyond Phase 2's expected diff.
