# Code removal pass

Status: **chunks 1–7 done 2026-09-23**; chunk 8's `auto`, the
browser's easing, the painted-origin pass and the opacity model done;
its `getAnimations()` sampling done in part by the opacity plan's
"Opacity transitions repaint" (the tick's one subtree query); the
measuring/settling single attribute not addressed. Planned 2026-09-23,
to run after the follow-ups commit and before new CSS features. From
a survey of the whole tree (five area surveys, merged and
spot-checked). Goal: less code for the same result; every chunk is
independent, keeps behavior (the listed bug fixes aside), and carries
its own tests. Line numbers are approximate —
re-grep before editing. ✔ checked against the code, ~ spot-checked,
(unverified) neither.

Core source grew from 16,926 lines (09-11) to 23,877 (+41%), mostly
features (anchor positioning, the components and their adapters,
pointer-events) and measured performance work, not duplication. The
duplication is concentrated: the same code per axis or per row/column,
repeated object literals, keyword `switch` blocks that could be tables,
set-or-clear pairs, and adapter files that differ only in a name.

## Bugs found on the way

Four predated the follow-ups batch and were fixed in it: `h-screen
md:h-auto` at `md`, a stale `--mw-base`, `--mw-ink` meaning two things,
and a plain background ignoring `background-clip` (see that plan).
Still open, unverified: float.md says a float is at least its
min-content width, the code's shrink mode has no such floor. A table
child's static position ignoring its margins and the rows before it is
fixed (table.md; "puts an abspos child of the table where a row in its
place would start" in table.test.ts), and the sticky ancestor chain
ignoring `hostRect` too (chunk 8's painted-origin pass).

Found during the pass, fixed: **v0.3.2's Vite plugin pre-bundled a
linked engine** (`optimizeDeps.include` on a workspace or `npm link`
copy), and the optimizer's cache never saw its edits — the React
example's dev server kept serving the engine from before a change while
the stylesheet, loaded from source, had moved on. An installed engine
is still pre-bundled; a linked one is excluded, so it is served from
source and a pre-bundled package built on it imports it rather than
inlining a copy (packages/vite/test/resolve.test.ts). Ship in 0.3.3.

## Chunks, in order

1. **Dead code and trivial folds (≈ −40).** ✔ `breakableSegments`
   (wrap.ts, no callers); ✔ `scripts/inspect.mjs` (−117, referenced
   nowhere — delete or document); one-caller helpers
   (`hasSelectionInside`, `animatesBackground`, `isLegacy` =
   `isLegacyColor`), ✔ table's `spanAttribute`/`spanCount` twins,
   `LAYER_TRANSITION`/`TRANSFORMS` duplicating `EFFECTS`, the dead
   `border-color` alternative in `SAMPLED_TRANSITION`, unreachable
   branches in element.ts, the probe filtered twice, impossible checks
   in multicol.ts; `export` dropped from file-local symbols; stale
   comments (element.ts banner, metrics.ts "shadow probe", types.ts's
   `decorationRuns` doc and plan jargon).
   **Done 2026-09-23** (core src −33, `inspect.mjs` −117). Left: the
   probe filter — `buildRootLeaf`'s is its tested contract
   (host-leaf.test.ts) and `#buildRootContainer`'s runs on the other
   path; one filter means passing the node list in, for chunk 6's tree
   builder. The dead `clearVar` went in the follow-ups batch.
2. **The interactive list as an engine-written flag (≈ −100).** ✔
   styles.css spells INTERACTIVE out twice (cursor rule, pointer
   opt-in) and COMPOSITE a third time (focus invert); element.ts holds
   the source list; interactive.test.ts only keeps them equal. render.ts
   already writes change-checked flags on every box and inline element:
   add `data-mw-interactive` (and a composite flag) and key the rules on
   them. Likely faster style matching too — measure.
   **Done 2026-09-23** (styles.css −70, element.ts +12, observed.ts
   +1). The marks go on in the layout's measuring loop over every light
   element, not render.ts's walk: the focus invert's exclusion shapes
   the read, so a composite's mark must precede it (written after, a
   focused box made a listbox read inverted and stayed so — the
   `Widgets` pointer story), and the loop reaches what the walk does
   not, as the stylesheet's lists did. `tabindex` joins the observed
   attributes. Style recalc −1 ms a prose relayout, paid back by the
   `matches()` calls; main-thread CPU level (performance.md).
3. **The UI packages (≈ −340, public API unchanged).** ✔ Vue's index as
   `export *` (−88; stop exporting the internal `Api` type that would
   collide); ✔ Svelte's 15 item-part files into 5 over a shared list
   context set by the three list roots and providers (−130; this
   overturns the follow-ups plan's "left as is" — no wrappers or prop
   hop needed; not for menu, dialog, popover or tooltip, where a nested
   trigger would bind the wrong root); ✔ the vanilla mount taking a
   `cleanup` instead of re-wrapping itself (−18); ~ one shared
   `coverage.test.ts` helper (−30); (unverified) Svelte's `Positioner`
   folded into `Part`, a Vue `positionerPart`, `MenuTriggerItem` as an
   ordinary part, a Svelte `binding()` helper, small unused options
   (−70 together).
   **Done 2026-09-23**: packages/ui\* src 5,978 → 5,578 lines (−400),
   every candidate taken; the menu's mount wrapper stays (it extends
   `updateProps` for submenus). A Svelte item part now reads the
   nearest list root, so a `SelectItem` in a `ListboxRoot` works.
4. **Layout (≈ −275).** ✔ one signature for every mode function, read
   from the node (−45); ✔ one main-axis placement helper for flex rows
   and columns (−45); ✔ the gap-rule context built from the node (five
   14-line literals, −35); ✔ one `TrackState` literal in `sizeTracks`
   (−30); ✔ one `intrinsicOuterWidth(node, cache, kind)` (−30); ~ one
   builder of grid sizing items for both axes (−25); ✔ table spacing as
   line widths (−20); ~ `resolveWidth`'s table branches (−12);
   (unverified) multicol's `fillHeight` and spanner placement written
   more than once (−20, decide a spanner's `h-full` first); ✔
   `unclampedHeight` removed (one reader, −12).
   **Done 2026-09-23**: layout, flex, grid, table and multicol.ts 5,902
   → 5,647 lines (−255; positioning.ts −1 for the new
   `intrinsicOuterWidth(node, kind, cache)`). No behavior change: the
   core suite and a 20,000-tree before/after layout fuzz agree; bench
   layout time unchanged (boxes 25.0 → 24.7 ms, blocks 52.4 → 52.3). The
   gap-rule builder also applies rule-inset (grid's segmenter already
   has, so it passes 0). Left: `unclampedHeight`, for chunk 6's node
   factory (element.ts and tree.ts literals; done there); the spanner placement,
   whose two paths differ in more than `h-full` — paragraph flow lays a
   spanner out against no height at the folded content width and carries
   the segment's trailing margin into its `multicolFlowSpan`, the
   element path passes the definite height at the full width — so one
   helper would take three switches for no lines saved.
5. **Paint, positioning, glyphs (≈ −245).** ✔ junction tables as
   lookups (glyphs.ts, −80); ✔ one per-axis `placeByInsets` /
   static-position function, `edges()` for the relative content box,
   fit-content reused (−50 to −65); ✔ a `setVar` that clears on a
   `null` value, exported for element.ts (−40 to −50); (unverified) borders.ts ring loops (−25); ✔ one
   `putRuns(runs, dx, dy)` in the paint walk (−20); (unverified) mirrored scrollbar
   and gradient-join loops, the `CellPaint` field list spelled 4 times,
   one content-box and inset helper (−40).
   **Done 2026-09-23** (core src −286: positioning.ts −111, glyphs.ts
   −76, plain-text.ts −37, render.ts −32, borders.ts −23, element.ts
   −7). The junction tables are a role string per style in
   `LINE_ROLES` order and a mask → role array, the same glyph for
   every mask × style × weight × set, derived sets included
   (glyphs.test.ts pins a sample). Positioning places each axis with
   one function, the inset-margin offset folded in, and
   `alignInArea` takes an axis: the same rects on 5,000 random trees.
   `setVar(target, property, value | null)` takes a rule too, for the
   host's tokens. The ring loops its corners, sides and radii; the
   bars share one loop; the two gradient joins are one `joinGradient`
   (the same segments on 50,000 random rows). Left: the `CellPaint`
   field lists, each reading its own subset (`samePaint` per cell),
   and a content-box helper, which saves nothing in these files.
   `pnpm bench` unchanged (218.5 / 220 ms interactive both ways).
6. **The style reader and tree builder (≈ −250).** ✔ keyword `switch`
   blocks as tables with one `readKeyword` (−35); ~ one read-source
   object instead of up to 8 positional arguments (−45); ✔ `readSize`
   reusing `viewportLimit` (−30; the shared active-check is in); ✔ one happy-dom display
   fallback (−30; only happy-dom changes); ✔ one `LayoutNode` factory
   (−25); (unverified) one `splitTopLevel(value, separator)`, duplicate
   type shapes, `BuildContext` through the tree builder, the text/ink
   reads written three times (−70); ✔ optionally generated
   `position-area` tables (−38).
   **Done 2026-09-23** (core src −321: style.ts −172, tree.ts −115,
   element.ts −30, layout/flex/table.ts −9, types.ts +1, color.ts +4).
   The keyword reads are tables through one `readKeyword`; one
   `ReadSource` per element replaces the `limit` closure, and
   `AnchorSource` extends it; `readSize` and `readLimit`
   share one `authoredCells` (the inline style or a viewport string
   Typed OM kept, then a utility's calc() or viewport length,
   active-checked) over one Typed OM read per property. happy-dom's
   `""` display reads as the initial `inline`, the table parts aside
   (`computedDisplay`), so `FALLBACK_INLINE_TAGS` is gone. One
   `createNode`; `buildRoot` filters the probe once and builds either
   root, element.ts's container included; `BuildContext` threads the
   builder; one `splitTopLevel(value, separator)`; `Insets`,
   `NullableInsets` and `LatticeSegment` are aliases. A survey item
   folded in with them: a flex column reads an `auto` basis as the
   item's height, the same bases on 20,000 random trees. One
   precedence fix: an inline viewport limit beats a utility's calc() the cascade overrides (style.test.ts).
   `pnpm bench` unchanged (boxes 226 / 226 ms, prose 308 / 301).
   Left: the text/ink reads (a shared reader saves no lines) and the
   generated `position-area` tables (their `span-` keywords would drop
   out of grep).
7. **The host element (≈ −95).** ✔ one `AbortController` for its 30
   listeners (−27); ~ the `select` and `focus` attributes from one
   table (−17); (unverified) one gesture start for character drags and
   multi-clicks, `#containerScrolled` dropped (−25); ~ small overlaps
   (−15); ~ (medium) the six placement attributes as one valued
   attribute, once asserted exclusive.
   **Done 2026-09-23** (element.ts −57, selection.ts −3). One
   `AbortController` per connection takes every listener (the arrow's
   one-shot keeps its own); element.test.ts pins that a disconnected
   host, its window listeners included, answers nothing and a
   reconnected one answers again (seen failing without the abort).
   `select` and `focus` take their values, defaults and warning from
   one `HOST_KEYWORDS`; one `#startGesture(e, unit)` starts the
   character drag and the multi-clicks; `selectedRanges` and
   `leafSlice` share `coveredChars`; `#owns` in the phantom and covered
   checks. Left: `#containerScrolled` — following the pointer after
   every paint would extend a held text-mode press at its own
   relayout (pointerdown relayouts for `:active`), selecting the
   pressed character on a plain click; the shared ancestor walk
   (`#collectSurroundingBoxes` climbs `parentElement`, the token and
   observer walks cross shadow roots: one walk changes a
   shadow-embedded host); one document scroll capture (scroll is not
   composed, so it misses a host inside a shadow tree); the placement
   attribute — about −4 JS lines, the CSS only shorter through
   prefix-matched values, across 12 files, and the six attribute
   buckets would become one Chromium bucket that every placed element
   matches all ~15 rules of, in the measuring flips' recalcs.
8. **Medium risk, one at a time (≈ −250).** ~ One painted-origin
   pre-pass replacing the seven places that re-derive a box's painted
   origin from `hostRect`, the parent's scroll and `stickyShift`
   (sticky, fixed, top layer; fixes the sticky-in-fixed lead, −50); the color-blending opacity model,
   which merges four paint paths (`alphaPaint`, the faded inline colors,
   the text-clip tint's fade, `mergePaint`'s translucent fill) and ends
   the "blends only with the page behind the host" deviation (−30 to
   −45 net; spec first, and a decision on group opacity); ~ the
   browser's own easing via `Animation`/`getComputedTiming()` instead
   of animate.ts's (−75; its test moves to a story; unverified in all
   three engines); (unverified) sampling transitions with
   `getAnimations()` (−20); one encoding for `auto` (~22 checks,
   −10 to −15); the measuring/settling single attribute (−8, only if
   the bench shows a gain).
   **`auto`, done 2026-09-23** (core src −32: flex.ts −14, style.ts −5,
   table.ts −4, layout.ts −3, grid.ts −3, tree.ts −2, positioning.ts
   −1). An `auto` width, height or flex basis is `undefined`, the
   encoding the defaults and `readFlexBasis` already used;
   `{ kind: "auto" }` left `Size`, so each check is a `??`, `??=` or
   `=== undefined`. The limits keep theirs, one per field: a minimum's
   `"auto"` (the automatic minimum) and a maximum's `undefined`
   (`none`). The same layouts on 20,000 random trees, each side fed its
   own encoding.
   **The browser's easing, done 2026-09-23** (animate.ts −77). Probed
   in Chromium 153, Firefox 155 and WebKit 26.6: a target-less
   `KeyframeEffect` takes every computed `transition-timing-function`
   serialization (the keywords, `steps()` in every jump position,
   `cubic-bezier()`, `linear()` with its points' positions) and, filled
   backwards as each engine's CSS transitions are, gives their progress
   exactly at every 5 ms, delay and end included (null only past the
   end). The hand-written easing differed at two edges, now CSS's: a
   `linear()` starting above 0 shows its start through the delay, and
   a jump-start `steps()` takes its first step the instant the delay
   ends. `play()` leaves the start time to the browser, as a native
   transition's is; a dropped fade's animation runs out unrendered
   (happy-dom's `cancel()` rejects `finished` unhandled). A progress
   read costs 0.6–0.8 µs, an `Animation` 2 µs. The easing assertions
   moved to the `TransitionEasing` story, each fade against its box's
   native `color` transition frame by frame (the old code passes it but
   for the delayed `linear()` case, and a wrong easing fails it; its
   window, the text's last 150 ms, lost the sample the fade's lag
   reached back to across a 106 ms frame under the whole suite —
   WebKit, `jump-start` — so since 2026-09-24 the lag is the change's
   frame to two after it, by their times, from the last sample at or
   before it, and the story holds one frame 200 ms, which fails the old
   window in all three engines; since 2026-09-25 the window reaches
   1 ms further back: Firefox starts the fade's timing a frame after
   the layout that arms it (Chromium and WebKit on that frame, a frame
   inside the window), so on steady frames each read lands on the
   window's edge, a text
   sample's time to 20 µs, and with frames 1/120 s apart every
   `steps()` jump (250 ms, 300 ms, ⅓ s) lands on one too: the fade's
   clock rounded before a jump the text's had passed, Firefox 4 of 42
   runs, every painted frame the fade's own read of the frame before);
   animation.test.ts stubs `getComputedTiming` for the arming,
   retargeting and mixing.
   **The painted-origin pass, done 2026-09-23** (core src −76:
   pointer.ts −46, element.ts −13, focus.ts −11, plain-text.ts −8,
   render.ts −5, sticky.ts ±0, layout.ts +3, types.ts +4).
   sticky.ts's `placePainted` writes every box's `paintOrigin` in one
   walk — last in `layoutRoot`, and on each scroll repaint after the
   offsets sync — a sticky box's shift folded in; the paint, the hit
   test (its stack is the nodes now), focus and the fixed box's
   takeback read it, and `collectStickyBoxes`/`applyStickyShifts`
   with their per-box ancestor chains are gone. The lead held where a
   sticky box's nearest scroller lies above a fixed box or a top-layer
   element: it stuck to that scroller (3 rows off in the
   `StickyInFixed` story); in a scrolling dialog it was right, every
   rect off by the same amount. The same pass fixes a fixed box in a
   fixed box, whose light element took back every ancestor's scroll,
   and a top-layer element's ancestors on the hit stack, placed
   without a fixed ancestor's `hostRect` or the root's scroll — the
   story and two unit tests, each seen failing first. The pass costs 0.5 ms on
   6,000 nodes in Node, a scroll frame level with it (18.3 ms both, the
   paint walk now cheaper); `pnpm bench` level, seven pairs
   alternated at load 7–8, the per-pair median after − before boxes
   −3 ms and prose −1 ms (pairs ±18 ms apart), blocks 86 / 86 ms.
   **The color-blending opacity model, done 2026-09-23**
   (`2026-09-24-one-opacity-model.md`; core src **+370**, not a
   removal: plain-text.ts +263, element.ts +61, paint.ts +18, width.ts
   +11, tree.ts +9, color.ts +6, types.ts +2; unit tests +408, the
   blend fixture and its spec +162; trimmed the same day to **+263**:
   plain-text.ts +162, paint.ts +13, width.ts +10). The four paths are gone (`alphaPaint`, the
   faded inline color, the tint's fade, `mergePaint`'s replacing
   fill), with the "blends only with the page behind the host"
   deviation. The group decision (group-faithful, not per-paint) is
   what the −30 to −45 did not count: a group records its subtree and
   blends it at close, an inline chain folds as nested groups, and the
   engine carries a palette (each color read once, each blend
   memoized), the ground and ink read back through a shadow probe, and
   a color emoji's coverage. Page loads level or better; a fade frame
   costs the browser more paint (the plan's step 9).

## Decisions, not done by default (≈ −300)

- Multicol element children as equal columns, the remainder in padding
  (−30; a new deviation).
- Spanners in paragraph-flow multicol (−100+; a feature cut).
- Engine-driven grid-mode drags (−30; changes cell-model.md's agreed
  design).
- The Firefox pre-157 fallback (−130 source, ~58 test lines): once
  Playwright ships Firefox 157 or later.

## Kept after a look

- The per-element measuring flag: a host-attribute descendant gate is
  the regression performance.md measured; style queries or inherited
  properties invalidate the subtree the same way.
- The dialog and scroll rule pairs split for the ancestor filter.
- The selection-transparency rule restated in three shadow scopes
  (shadow trees share no rules), the `rule-*` mirror properties, the
  top-layer origin calc, the settling pass.
- One flex algorithm for rows and columns (only placement shares), and
  table sizing on grid's `sizeTracks` (different CSS algorithms).
- Public exports only tests use (hooks, composables, `RootProvider`):
  removing them breaks the API.

## Total

Estimated: chunks 1–7 ≈ −1,000 to −1,400 lines with no behavior change
beyond the bug fixes; chunk 8 ≈ −250 more. The two biggest safe wins
were layout (chunk 4) and Vue/Svelte (chunk 3).

Against v0.3.2, the day's new features included: core source measured
at commit, styles.css counted (the opacity model alone +263); the UI
adapters −400 and scripts −38 (measured 2026-09-24).
