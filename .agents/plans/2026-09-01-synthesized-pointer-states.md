# Synthesized pointer states initiative

Hover AND active (`hover:`, `active:`, `group-hover:`, `group-active:`,
`peer-hover:`, …) plus cursor mirroring — every pointer-derived state
that grid mode's hit-target exclusivity currently breaks on
non-interactive elements.

Status: **implemented 2026-09-01** (phases 1–6). What shipped, and
where it diverged from the plan below:

- Spikes: all three favorable (results inline below).
- Selection preservation went FURTHER than planned: paintGrid
  preserves node identity — structure-matching paints (fades) patch
  span styles in place, zero node churn, so selections AND in-flight
  drag anchors survive natively in all three engines; structural
  rebuilds capture/restore flat offsets, and are deferred to release
  while a primary press holds a grid anchor (Chromium's drag collapses
  even across a restore — the offset-restore alone proved insufficient
  for live drags there, contra the spike's simpler fixture).
- Hover core, `:active`, cursor mirroring, scroll/relayout refresh:
  shipped per plan (pointer.ts + element.ts). Press-freeze dropped —
  hover tracks during drags; its restyles land via the paint rules.
- Variants live in src/variants.css (Tailwind source, imported by
  styles.css and injected by cdn.ts next to rules.css); play smoke
  verifies the CDN compiler picks them up. `mw-hover:` opt-out
  variant: not added (override policy + docs suffice for now).
- Docs: cell-model "Selection" + "Pointer states", README "Pointer
  states in grid mode" with the override snippet, architecture note.
- Coverage: hitChain unit tests; SynthesizedPointerStates story
  (synthetic-pointer driven, all gates); SelectionSurvivesRepaints
  story; real-mouse cross-engine probes for mid-drag selection over
  live fades (all three engines pass); Transitions story is plain
  divs. Found and fixed en route: packages/core `files` omitted
  rules.css from the published tarball.

## Motivation

Under `select="grid"` (the default), non-interactive light-DOM elements
are `pointer-events: none !important` so drag-selection lands on the
grid `<pre>`. The cost: they can never be a hit target, so `:hover`
(and `:active`) never match — `hover:` utilities on a plain `<div>`
silently do nothing. Today's escape hatches all trade selection away:
interactive elements, `[tabindex]`/`[role]`, or `pointer-events-auto!`
(important + layered beats the engine's unlayered lock) all make the
element the hit target, which blocks grid selection over its cells.
CSS has no "hover yes, click-through yes" mode — one hit target per
pixel.

The engine, however, knows the exact cell geometry of every element.
It can synthesize hover itself: leave ALL pointer events on the grid
(selection intact) and derive the hovered element chain by hit-testing
the pointer against the layout tree.

A working PoC (2026-09-01, reverted) validated the whole chain: cell
hit-testing on `#lastLayout`, `data-mw-hover` on the hovered chain, a
`@custom-variant hover` in the companion, per-frame sampled fades on
plain divs in grid mode, with drag-selection preserved by freezing
hover during a press. It also surfaced the two real problems this plan
must solve properly (selection vs repaints; consumer variant
collisions).

## Design (validated by the PoC)

1. **Hit-testing**: on `pointermove` over the host (early-exit unless
   the hovered CELL changed), map client px → cell via the grid's
   bounding rect + cell metrics, then walk `#lastLayout`: the innermost
   node whose border-box contains the cell, plus its ancestors — native
   `:hover` matches the whole chain, so the synthesized attribute does
   too. Mark the chain `data-mw-hover`; diff against the previous
   chain; on change, write/remove attributes and `#scheduleLayout()`
   (the attribute is deliberately not in the MutationObserver's filter,
   and `pointerover` won't fire — in grid mode the hit target is always
   the grid `<pre>`).
2. **Companion variant**: `@custom-variant hover
(&:is(:hover, [data-mw-hover]));` in styles.css. Only a Tailwind
   build sees the at-rule (browsers skip it); raw `:hover` selectors in
   hand-written CSS keep native behavior — documented deviation.
3. **`pointerleave`** clears the chain; disconnect clears state.

## Problems to solve properly (the reason the PoC was reverted)

### A. Selection must survive repaints — prerequisite, standalone value

The selection lives on the grid's spans; `paintGrid` rebuilding a row
kills any selection anchored in it. This already bites today (select
during any running transition), and synthesized hover makes it
constant: hovering starts fades on the exact rows being selected.
The PoC's freeze-hover-during-press only masked the common case (a
drag started mid-fade still dies).

Fix: preserve the selection across paints in grid coordinates —
capture (anchor row/col, focus row/col) before mutating rows the
selection intersects, restore via a new Range after the paint.

**SPIKE RESULT (2026-09-01, all three Playwright engines)** — best
case across the board, no per-engine forks needed:

- `getSelection().getComposedRanges({ shadowRoots })` returns correct
  shadow offsets in chromium, firefox, AND webkit.
- `getSelection().setBaseAndExtent(shadowTextNode, …)` restores in all
  three (`shadowRoot.getSelection()` is Chromium-only and unneeded).
- Plain `getSelection().toString()` reads shadow content in all three.
- **Mid-drag restore works in all three**: rebuild spans + restore
  while the button is held, and continued dragging keeps extending
  from the restored anchor. The press-freeze fallback is likely
  unnecessary; keep it in the back pocket only.
  Remaining diligence for phase 2: verify against the real grid (multi-
  row spans + newline text nodes, selection direction/backwards drags,
  collapsed carets), not just the spike fixture.

### B. Consumer `@custom-variant hover` collisions

A consumer who redefines `hover:` themselves must WIN — monowind's
definition is a default, not a lock. Policy:

- The companion defines the variant FIRST (it already does naturally:
  `@import "monowind"` precedes the consumer's own at-rules in their
  stylesheet), so a later consumer definition overrides it.
  **SPIKE RESULT (tailwindcss 4.3.3 compile API): last-wins CONFIRMED**
  — a second `@custom-variant hover` fully replaces the first.
- A consumer who overrides `hover:` silently loses grid-mode hover
  unless their selector includes `[data-mw-hover]` — consumer docs
  must carry the exact copy-paste snippet (see Docs below).
- Keep the wrapper: Tailwind v4's `hover:` is gated on
  `@media (hover: hover)`; the companion's redefinition must preserve
  it or every `hover:` utility changes behavior on touch (sticky
  tap-hover). **SPIKE RESULT: confirmed both ways** — the shorthand
  form LOSES the wrapper; the block form keeps it and is therefore the
  canonical definition (verified output wraps in the media query):
  `@custom-variant hover { @media (hover: hover) {
&:is(:hover, [data-mw-hover]) { @slot } } }`. The consumer override
  snippet in the docs must use the block form too.
- `group-hover:` / `group-active:` / `peer-hover:` / `peer-active:`
  MUST work — requirement, not nice-to-have. The attribute model
  supports them by construction: the hovered chain marks ancestor
  groups, and a hovered peer carries the attribute itself for sibling
  selectors. **SPIKE RESULT: Tailwind v4 composes `group-*` and
  `peer-*` from the redefined base variant** — `group-hover:x` emits
  `:where(.group):is(:hover, [data-mw-hover]) *` with no extra work;
  no explicit group/peer variants needed. (`active:` has no media
  wrapper by default, so its shorthand redefinition is fine.)
- Decide whether `mw-hover:` should ALSO exist as a separate variant
  for consumers who opt out of the `hover:` override.

### C. Distribution paths

- Workspace/Vite: companion is inside the user's Tailwind build ✓.
- CDN: **SPIKE RESULT (by inspection of cdn.ts)** — styles.css is
  injected as PLAIN css there (browsers skip `@custom-variant`), but
  rules.css already reaches the in-browser compiler as a
  `type="text/tailwindcss"` style tag. The variant must live on that
  path: put it in rules.css (or a sibling Tailwind-source file that
  both styles.css `@import`s and cdn.ts injects). Verify end-to-end
  with the play app's smoke test in phase 4.

## Scope decisions

- **Gating**: synthesize hover only under `select="grid"` (native
  `:hover` works in `select="text"`; double-application is harmless
  but wasted work) and only when `matchMedia("(hover: hover)")`.
  `:active` synthesis is NOT hover-gated — touch devices have no
  hover but absolutely have presses.
- **Scroll staleness**: native `:hover` re-evaluates when the page
  scrolls under a stationary pointer. Store the last pointer position
  and re-hit-test on scroll (and on relayout, which can move content
  under the pointer); otherwise the synthesized chain goes stale.
- **Hit-test cost**: `getBoundingClientRect` per pointermove can force
  reflows — cache the grid origin per layout, invalidate on
  scroll/resize; keep the per-cell early exit.
- **Overlaps**: PoC resolved sibling overlaps by document order; align
  with the paint order (`paintOrderedChildren`, z-index) instead.
- **Inline elements**: skipped (consistent with the inline-opacity
  deviation); hover resolves to block-level boxes.
- **`:active` synthesis** (first-class, same mechanism):
  `data-mw-active` from `pointerdown`→`pointerup`/`pointercancel` on
  the pressed cell's chain, `@custom-variant active` alongside hover.
  Native fidelity notes: only the primary button activates, and
  `:active` clears when the pointer leaves the pressed element while
  held (Chromium re-enters on return; verify per engine and pick one
  behavior).
- **Out of scope, documented with the escape hatch**
  (`pointer-events-auto!`): native `title` tooltips (need a real hit
  target; not synthesizable) and JS pointer/click handlers on
  non-interactive elements (grid mode routes their events to the grid;
  re-dispatching synthetic clicks would forge trusted-looking
  interactions — not doing that).
- **Cursor mirroring** (same root cause: `cursor-pointer` on a
  non-interactive is invisible in grid mode): read the hovered chain's
  computed `cursor` and mirror it onto the host/grid. Cheap once
  hit-testing exists; include.
- **Press-freeze**: keep only if the selection work leaves gaps;
  otherwise drop for native-like hover-during-drag.

## Testing

- **Unit (core vitest, no browser)**: the hit-test walk is a pure
  function over `LayoutNode` trees — cover innermost-chain selection,
  ancestor inclusion, overlap/paint-order resolution, out-of-bounds
  cells, `tableHidden` skips.
- **CSS-level (story)**: set `data-mw-hover` manually on an element
  and assert `hover:` utilities' computed styles apply — proves the
  variant wiring independent of the pointer machinery; same for
  `group-hover:`/`peer-hover:`/`active:` variants.
- **Pointer-driven (play)**: synthesized states respond to _synthetic_
  pointer events (the engine listens; no trusted-event requirement
  like real `:hover`), so play functions can drive the full path:
  dispatch pointermove at a tile's cell, assert the attribute chain
  and the grid repaint; assert fades sample when combined with
  `transition`; pointerdown/up for `active:`; leave/disconnect clear
  the chain; `select="text"` writes no attributes.
- **Selection preservation**: play test selects grid text, toggles a
  class that repaints those rows, asserts the selection string is
  unchanged (per engine; skip where the shadow-selection API is
  absent).
- **Visual goldens**: rest states only — unaffected.

## Docs (consumer-facing deliverables)

- README section on pointer states in `select="grid"`: what works out
  of the box, the `title`-tooltip and JS-click-handler deviations, and
  the `pointer-events-auto!` escape hatch.
- The `@custom-variant hover` override snippet: consumers who redefine
  `hover:` must include `[data-mw-hover]` (exact copy-paste block,
  plus the `group-*`/`peer-*` equivalents if those end up
  companion-defined).
- cell-model.md "Pointer states" spec section; architecture doc note
  beside the dynamic style-change detection entry.

## Phases

1. **Spikes**: shadow-selection API matrix; Tailwind duplicate-variant
   precedence + `group-*`/`peer-*` composition; CDN compiler
   visibility of companion at-rules.
2. **Selection preservation across paints** (ships alone; fixes the
   existing select-during-transition fragility).
3. **Hover core**: hit-testing + `data-mw-hover` + relayout trigger,
   gated (`select="grid"`, hover-capable pointer), paint-order-aware,
   scroll-aware.
4. **Companion variants + docs**: `@custom-variant hover` (+ group/peer
   if needed), collision guidance + override snippet, CDN path, spec
   section, README section.
5. **Active + cursor**: `data-mw-active` synthesis (not hover-gated),
   cursor mirroring, press-freeze removal decision.
6. **Stories/tests/goldens**: Transitions to plain divs, a Pointer
   States story (hover + active + live grid selection together), play
   coverage, spec/architecture doc updates.

## Deviations (to document in cell-model.md)

- Only Tailwind variants (`hover:`, `active:`, `group-*`, `peer-*`)
  and selectors written against `data-mw-hover`/`data-mw-active`
  participate; raw `:hover` in hand-written CSS stays native-only.
- Hover resolves to block-level boxes (no inline-span hover).
- Overlap resolution follows grid paint order, which may differ from
  the browser's own hit-testing in unlaid-out edge cases.
- Native `title` tooltips and JS pointer/click handlers on
  non-interactive elements stay hit-target-bound: `pointer-events-auto!`
  is the escape hatch (at the cost of grid selection over that
  element).
