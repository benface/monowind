# Code removal pass

Status: **planned 2026-09-23**, to run after the follow-ups commit and
before new CSS features. From a survey of the whole tree (five area
surveys, merged and spot-checked). Goal: less code for the same result;
every chunk is independent, keeps behavior (the listed bug fixes
aside), and carries its own tests. Line numbers are approximate —
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
min-content width, the code's shrink mode has no such floor; the
sticky ancestor chain ignores `hostRect` (sticky inside a fixed box or
a scrolling dialog); a table child's static position ignores its
margins.

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
2. **The interactive list as an engine-written flag (≈ −100).** ✔
   styles.css spells INTERACTIVE out twice (cursor rule, pointer
   opt-in) and COMPOSITE a third time (focus invert); element.ts holds
   the source list; interactive.test.ts only keeps them equal. render.ts
   already writes change-checked flags on every box and inline element:
   add `data-mw-interactive` (and a composite flag) and key the rules on
   them. Likely faster style matching too — measure.
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
5. **Paint, positioning, glyphs (≈ −245).** ✔ junction tables as
   lookups (glyphs.ts, −80); ✔ one per-axis `placeByInsets` /
   static-position function, `edges()` for the relative content box,
   fit-content reused (−50 to −65); ✔ a `setVar` that clears on a
   `null` value, exported for element.ts (−40 to −50); (unverified) borders.ts ring loops (−25); ✔ one
   `putRuns(runs, dx, dy)` in the paint walk (−20); (unverified) mirrored scrollbar
   and gradient-join loops, the `CellPaint` field list spelled 4 times,
   one content-box and inset helper (−40).
6. **The style reader and tree builder (≈ −250).** ✔ keyword `switch`
   blocks as tables with one `readKeyword` (−35); ~ one read-source
   object instead of up to 8 positional arguments (−45); ✔ `readSize`
   reusing `viewportLimit` (−30; the shared active-check is in); ✔ one happy-dom display
   fallback (−30; only happy-dom changes); ✔ one `LayoutNode` factory
   (−25); (unverified) one `splitTopLevel(value, separator)`, duplicate
   type shapes, `BuildContext` through the tree builder, the text/ink
   reads written three times (−70); ✔ optionally generated
   `position-area` tables (−38).
7. **The host element (≈ −95).** ✔ one `AbortController` for its 30
   listeners (−27); ~ the `select` and `focus` attributes from one
   table (−17); (unverified) one gesture start for character drags and
   multi-clicks, `#containerScrolled` dropped (−25); ~ small overlaps
   (−15); ~ (medium) the six placement attributes as one valued
   attribute, once asserted exclusive.
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

Chunks 1–7 ≈ −1,000 to −1,400 lines with no behavior change beyond the
bug fixes; chunk 8 ≈ −250 more. The two biggest safe wins are layout
(chunk 4) and Vue/Svelte (chunk 3).
