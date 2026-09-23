# Follow-ups and review fixes

Status: **built 2026-09-23**. Follows commit
`fa37b24` (visibility, the anchor functions, and position-visibility);
ships with it as the next patch release. Every fix carries a
regression test, each seen failing without its fix — written before
the fix, or run against a scratch copy of the tree with the fix taken
out — except where noted.

## The three follow-ups

- **A selection from the markup.** `data-selected` on a listbox's,
  select's or combobox's items is the initial value where the props
  name none (`withMarkupItems`, the first alone where one value is
  taken), and every item carries the marker the selection gives it, one
  the collection leaves out included, so a remount reads it back.
  `value` and `defaultValue` are properties of the three elements.
- **The UI stories on the elements**, the menu's alone on the vanilla
  mount.
- **The cascade read for `anchor()` utilities**
  (anchor-positioning.md deviation 1): which utility is in effect is
  read from Typed OM under `anchor-scope`. WebKit reads an `auto`
  minimum as `0px`, which a `min-*-0` reads as too; that engine's
  reading is probed once (`autoMinimum`), so Chromium no longer takes
  an active `md:min-w-0` for the anchor's minimum.

## Fixes

UI (`packages/ui*`):

- An element's attribute removed after the mount drops its prop (the
  machine back at its default), positioning included.
- The hidden select: options rewritten when the collection changes,
  and each option selected as the value says — a value that arrives
  before its option (a collection loaded later) is posted once its
  option does (see "Review of the staged set" for the one
  `syncHiddenSelect` every path now calls).
- Vue and Svelte bind `triggerValue` and `inputValue` (one binding
  table, `BOUND`, in `framework.ts`); Svelte's dialog, popover and
  tooltip roots take `bind:triggerValue`.
- React's `Menu.Root` links a submenu once, not on every commit.
- A combobox's list opened by a keystroke leaves the caret where the
  reader put it: Zag's `setInitialFocus` moves it to the input's end on
  every open (1.44.0 and 2.0.0-next.3 alike), so the machine
  `@monowind/ui/combobox` exports skips that for `INPUT.CHANGE` — the
  mount and all three adapters run it. A real-key test in
  `visual/keyboard.spec.ts`.
- The adapters' published types no longer name `@zag-js/dialog`,
  `menu`, `popover` or `tooltip`, which they do not depend on:
  `@monowind/ui` declares those `Props` as interfaces of its own.
  `check-workspace.mjs` now fails on a built `.d.ts` importing a
  module its package does not depend on.
- The stray-prop warning is said once per root and props, not per
  React render.
- The dialog, popover and tooltip `Trigger` parts take `value` in all
  three adapters, which tells a root opened from one of several
  triggers which (Svelte's menu trigger lost an empty type cast).

Engine (`packages/core`):

- Layout: an explicit height is clamped by its min/max before the
  content lays out against it; a flex item's base is its content, never
  the `min-height` floor a container item fills (column, row, wrapping
  row, grid); `min-w-*`/`max-w-*` keywords hold in a flex row and a
  stretched grid item; auto margins are zero on a box wider than its
  space, in every mode (`autoMarginOffset`, probed in all three
  engines); a table cell's `vertical-align` moves its inline boxes with
  its text. Flex auto margins take what flexing leaves (CSS §8.1,
  probed): the grow-first special case is gone. A flex item's automatic
  minimum is capped by its own width/height and max (a `w-3` item holding
  a longer word stays 3 wide; two `h-15` items shrink to share a `h-20`
  column), a column's intrinsic basis is the content height, and
  `flex-basis: content` reads as `max-content` — all probed in three
  engines.
- Pointer: a key's activation and a label's forwarded click are no
  longer cancelled as covered in grid mode (a covered hit lies in its
  target's own box); a translated layer answers the pointer only where
  it is drawn (`CellHit.layerRoot`); a released scrollbar thumb settles on
  its cell.
- Hosts: a nested host given an attribute before it connects no longer
  lays out; a host straight under a shadow root is no nested one.
- Paint: a boxed glyph that loses its color loses it on screen; a
  leaf renderer's run takes the leaf's own color, weight, style and
  decoration where it sets none; a fixed box's focus rect is where it
  paints; a fixed box's shift vars are no longer cleared and rewritten
  every layout. `opacity` on an inline element fades its text and
  background, nesting as CSS multiplies it.
- Engine-run background fades split the timing-function list on
  top-level commas: every `cubic-bezier(…)` — Tailwind's default easing
  among them — had run linear. `steps()` and `linear()` ease as CSS
  defines them.
- `pointer-events: none` passes the pointer through (cell-model.md
  "Pointer states"): the hit test takes no such box, a descendant set
  back to `auto` still hit; the value read is the one written inside
  the host (the grid-mode locks off under each element's measuring
  flag, the shadow slot stating `auto` — a modal's `none` on the body
  stays the page's); an element whose value is `none` carries
  `data-mw-pointer-none`, which the grid-mode opt-in of interactive
  elements leaves be. The `ClickThrough` story shows it; a real-pointer
  test presses through it in `visual/pointer.spec.ts`.
- Leaks: the layer-transition count resets on disconnect; fired settle
  timers leave their map. (No test: nothing observable.)

Examples, scripts, packages:

- The four enhancer examples' builds shipped a page without its
  scripts: vendor files and fragments now go in `public/`, and the
  shared smoke builds each app and checks every file the page loads.
- Dev ports: `example-tailwind` 5193 (was the playground's 5181),
  `example-svelte` 5194 (htmx's), `example-vue` 5195 (Alpine's); a port
  is declared once. `check-workspace.mjs` guards both.
- Themes: `neutral-*`, `zinc-50` and `mauve-50` were never themed (a
  `none` hue the parser missed); palettes regenerated, and the
  generator now fails on any color token it cannot read. The font check
  follows the theme's imports to the font sheets.
- Ascii: the README's `.font =` takes `parseFont(slant)`; the CDN
  bundle passes over an app's own page served in a font's place (a
  single-page app's 200) on to the published file; font modules no
  longer name a source map they do not ship; `effect="toString"` is
  no effect.
- The example smokes serve their own directory from anywhere.
- The Vite plugin imports the app's own `monowind` where it has one,
  its own copy otherwise, so a leaf renderer registers on the engine
  the host uses (`packages/vite/test/resolve.test.ts`).
- `check-workspace.mjs` (renamed from `check-workspace-deps.mjs`) also
  fails on a built file naming a source map that is not there; its six
  guards share one manifest loader and one file walker.
- The playground smoke checks that a preview's torn-down combobox is
  destroyed while still attached.

## Simplifications

- `autoMarginOffset` replaces five copies of the auto-margin rule;
  `resolveGap` the four intrinsic-gap copies; `edges()` the hand-written
  chrome sums.
- `animate.ts` mixes colors through `color.ts` (a characterization test
  pinned the fade first); `samePaint` compares a paint's lists by value,
  so a repaint no longer rewrites every gradient span.
- `itemOf`, `splitProps` and `defined` live once in `framework.ts`.
- `layerGridAt` (dead) is gone; the pointer's glyph and focus lookups
  take the `CellHit` directly. The two comma splitters in `style.ts`
  are one.
- The vanilla mount takes `live` as required; `framework-smoke`'s dead
  `ui` option is gone; the playground's and the HTML example's bundle
  chains are one `cdn` script each.

## Review of the staged set

A four-part review of the staged change set (layout, pointer and paint,
UI, apps and scripts), its findings each verified — most in all three
engines — and fixed with a regression test seen failing first:

Layout:

- A flex or grid item's content height, as its flex parent reads it (an
  intrinsic basis, the automatic minimum), is its content's natural
  extent whatever its own height or `min-height`: two `h-15` container
  items share an `h-20` column 10/10.
- A flex/grid text leaf's alignment padding stays out of its content
  height, so a `flex items-center` leaf's `min-h-*` or `h-*` no longer
  skews its flex base or blocks its shrink.
- A column's `min-height` floor never shrinks items below their
  hypothetical sizes, and an auto-height column's auto margins get no
  space beyond them.
- A percent `flex-basis` against an auto-height or min-height-only
  column is the content height (CSS §7.2.3).
- Fixed cross-axis margins count in a line's height and in the item's
  alignment; one `alignedOffset` serves flex rows, flex columns and grid
  areas.
- Grid: under a `min-height` floor, rows size as if the height were
  indefinite, and against the floor only when they come out smaller.
  A stretched item's automatic minimum is capped by its max-width and
  max-height; one `automaticMinimum` serves flex and grid.
- Grid's automatic minimum follows the spanned tracks (css-grid §6.6):
  content-based only over an `auto`-minimum track (never several with a
  flexible one), capped at a fixed-maximum area; the same rule sets the
  items' minimum contributions to track sizing and the container's
  min-content width, and a non-`auto` minimum's base raises its fixed
  maximum. A `grid-cols-N` item keeps its track while a long word
  overflows, and a `col-span-2` item keeps `1fr 1fr` even, as in all
  three engines; no golden moved.
- Anchor functions: every utility for a property is checked; one with a
  fallback is in effect only when the computed value equals it; a
  popover's `anchor(bottom --a)` is checked too. The metrics probe holds
  `min-width: auto !important` against a page's `* { min-width: 0 }`,
  and the per-engine value is read once.

Pointer and paint:

- A transformed element that takes no pointer events passes the pointer
  to what lies beneath where it is drawn; the hit through a layer
  answers only from its root's ancestors and subtree (`cellAtPoint`).
- A `pointer-events-auto` inline element inside a `pointer-events-none`
  leaf holds its own characters' cells.
- A nested host (an explicit `select="grid"`, or one moved into another)
  reads its light DOM's pointer-events under the outer host's measuring
  flag; the host's own text takes the pointer as the slot states.
- A key's activation and WebKit's label-forwarded click (`detail` 0) are
  never cancelled as covered.
- The hover's same-cell skip compares the layer too.
- Inline opacity fades what the element holds (atomic inline boxes,
  out-of-flow boxes, split blocks, `LayoutNode.inlineOpacity`); an inline
  element without its own background fades only its glyph color, the
  block's background beneath staying solid.
- `CellHit.layer` is `layerRoot`; `through` is required; the animation
  tests restore the clock and host in `afterEach`. A real-input spec,
  `visual/pointer-events.spec.ts`, runs the `PassThrough` story.

UI:

- One `syncHiddenSelect` (`@monowind/ui/select`) writes the hidden select
  on every path: options, the selection (none where no option holds the
  value), the initial value as `selected` attributes for a reset, and a
  two-row display size, since a one-row single control picks its first
  option by itself. A stale value, a value before its option, and a
  reset no longer post the first item; the vanilla/element select
  follows its form's reset and a disabled fieldset (Zag's id and `form`
  set before the machine starts).
- A combobox keeps the caret when a controlled `open` opens on a
  keystroke.
- An element's `defaultValue` applies to its first mount only; a
  property set before `defineMonoUi()` is upgraded when it connects.
- Svelte's `bound()` types its value through `BOUND`; `triggerPart` in
  React and Vue; the stray-prop warning is said once per root instance.
- `@monowind/ui-react` peers on React `>=19.0.0`: its parts render
  `<Context value>`, React 19's, and React 18 fails on it (the range
  had said `>=18.0.0`).
- `data-selected` marks a selected item on every path: Zag writes it on
  a listbox's items alone, and `itemProps` (`framework.ts`) adds it to
  the React, Vue and Svelte select's and combobox's, as the mount does.

Apps and scripts:

- The Vite plugin imports the app's own `monowind` by name, adding it to
  `optimizeDeps.include` and `resolve.dedupe`, so the dev server's
  pre-bundled leaf renderers share the engine; an app has its own copy
  by the `node_modules` walk Vite resolves with (pnpm's `NODE_PATH`
  aside). A dev-server test pins it.
- CI builds the packages and runs the built-output guards;
  `check-workspace.mjs` reads nested export conditions, side-effect and
  `reference types` imports, `.d.ts`/`.mjs`/`.css` source maps, and
  `--port=`/`-p` and `server.port` forms. The font modules' types no
  longer name a map; core emits no types for its CDN script.
- The anchor story branches on Typed OM and on how it reads an auto
  minimum, not on the browser's name. Story test hooks are `data-test`;
  one `moveTo` serves the pointer moves. The combobox caret test waits
  for the list to open. The enhancer smoke checks Vite's assets too and
  cleans up on failure. The playground's Tidy hands the focus back; its
  sample round-trip runs on the sample. `example-stylex` and
  `example-unocss` dropped devDependencies they did not use.

## Second review, fresh eyes

A second five-part review of the whole set (layout, pointer and paint,
UI, apps and scripts, and a cross-cutting pass on performance,
accessibility and consistency), its findings verified and fixed with a
regression test seen failing first:

Performance (HEAD / before / after, interleaved medians, details in
performance.md "Pointer events and the hit through a layer"):

- The modal-dialog and coarse-pointer opt-ins are plain descendant
  selectors again: an `:is()` holding `dialog:modal *` defeated
  Chromium's ancestor filter, which was the whole prose style
  regression; prose is back at HEAD's (per relayout 85.4 / 88.0 / 85.8
  ms CPU).
- The light DOM's pointer-events read under a static
  `:host([select="grid"]) ::slotted(*)` rule and a text-mode shield on
  the slot; no host rule keys on `data-mw-measuring`, and a nested
  host's own `pointer-events: none` reaches its content.
- A hit through a layer walks the layer root's ancestor path and its
  subtree from a per-layout index (no `contains()`), declines where a
  box painted after the layer answers (a stretched link, a transparent
  popover), and ignores the ancestors' laid-out clips (a translated
  carousel track); the same-cell pointer-move skip compares a point key
  with no hit test (a move over a badge layer: 2–5 / 90–145 / 3–6 µs).
- Each computed property is read once per function; JS per relayout is
  at or below HEAD's.

Layout, pointer and paint:

- Grid: an item's specified size or minimum, and a content-based
  minimum, contribute at least its border, padding and gutter, as all
  three engines do; one `boxChrome` replaces five hand-written sums.
  Step 3 caps only the content-grown part of an `auto`-minimum base
  (`minmax(auto, 12)` under a `min-w-20` item is 20). Percent rows under
  an indefinite height resolve against the height their content gives
  the grid.
- An absolutely positioned box between two insets solves a single auto
  margin, negative included; two split, clamped horizontally only.
- Anchor fallbacks compare in px; WebKit's `autoMinimum` read has a
  test.
- Faded inline line glyphs are boxed like translucent ones
  (`CellPaint.faded`); a faded span inside `bg-clip-text` fades its
  tint, as Firefox renders it; the `detail` claims are corrected.
- The editables' selection locks use plain descendant rules and one
  swap selector per element kind: style recalc −2 ms per prose relayout
  (page load 126.9 → 120.4 ms), behavior identical in all three engines
  for an editable region inside a host (the `EditableRegion` story); an
  editable host, or a host inside an editable, is unsupported
  (wide-characters.md).
- Simplifications: `alignedOffset` for static offsets, the carried
  `hypothetical`, anchor arguments parsed once, one `splitCommas` (in
  `color.ts`; animate's regex split broke on nested parentheses),
  `readOpacity` reused, `isTextSegment`, `naturalContentHeight`
  required. flex.md: the base unclamped, the stretch clamped by
  min/max-height, the percent-height child a deviation (3).

UI:

- Svelte's `HiddenSelect` selects again a microtask after each write
  (Svelte 5.20–5.56.7 deselected a single select as its options
  changed).
- A framework's `HiddenSelect` renders its first options as markup
  (`hiddenSelectOptions`), so a server-rendered form posts the initial
  value before hydration; hydration stays clean.
- An element starts every later mount at its first mount's value (the
  reset target, a value whose item arrives later) and puts the reader's
  selection back without announcing it; a menu's removed shared
  attribute reaches its submenus; a fresh equal array or object prop is
  no change.
- svelte-check's 13 errors fixed (it stays out of `typecheck` under
  TypeScript 7); `itemProps` reads `data-state`; `warnStray`'s `root`
  is optional; the README lists every `@monowind/ui/framework` export;
  test helpers and trigger types live once.
- `@monowind/ui-react` peers on React `>=19.0.0` (its parts render
  `<Context value>`).

Apps and scripts:

- The Vite plugin imports `monowind` by name in both cases, aliasing
  it to its own copy where the app has none, so a leaf package pnpm
  installs without `monowind` beside it shares the page's engine (a
  pnpm-shaped dev-server test); its typecheck no longer writes a
  build-info file into `dist`.
- `check-workspace.mjs --built` runs the built-output guards, in CI and
  before a release's publish; `pnpm check` no longer reads a stale
  local `dist`.
- The playground's Tidy hands the focus back in WebKit too (a pressed
  button there takes none); a smoke check covers both.
- Docs call a `pointer-events-none` link disabled only with
  `aria-disabled` and no `href`, which keyboards cannot reach either.
- Visual specs share `hook`, `rectOf` and `datasetOf`; stories use
  `gridOf` and `testHooks`; the LayerHit story tests where the box is
  drawn rather than a fixed column.
- core-architecture.md: descendant combinators stay outside `:is()` and
  `:not()` on hot rules, and no `::slotted` rule keys on a flipping host
  attribute.

## Before the commit

- Fades back to HEAD's values: `color.ts` keeps colors unclipped
  (extended sRGB, sign-preserving transfer functions, an extended
  `rgbToHsl` that keeps a negative saturation as Chromium and Firefox
  do) and clips only where it composites or serializes; gradients with
  out-of-sRGB stops mix unclipped too, within a level of Chromium and
  Firefox in oklab, oklch and hsl (gradients golden regenerated).
- Four older bugs a survey found: `h-screen md:h-auto` at `md` (one
  `activeUtilityPx` active-check for `readSize`, `authoredCalcCells`
  and `viewportLimit`); `--mw-base` going stale (`sameMetrics` compares
  every metric); `--mw-ink` meaning two things (the host's overhang is
  `--mw-overhang`); a plain background ignoring `background-clip`
  (`backgroundInset` clips both fills).
- Comments added in the batch trimmed to their constraint, two that
  misdescribed the code corrected; `pxSum` for the host's pixel sums;
  the keyboard spec's no-hold budget at 450 ms of a hold's 500.
- AGENTS.md: a Git section (the user stages as agents work; commits
  need explicit approval per batch; no index baselines) and a Testing
  section (narrow runs while working, full suites once).

## Reported, not changed

- **Authored translucent colors on line glyphs in a scaled layer**
  (`text-black/50` on `│` under `scale-150`) seam at row joins as faded
  ones did; boxing them may move goldens — for the color-blending pass.

- **Engine-run fades of out-of-sRGB colors**: `color.ts` clamps each
  endpoint on parse, where the older fade clamped only its output, so
  mid-fade values drift for such colors (emerald-400 → gray-800 at
  t 0.25: rgb(0 166 124) then, rgb(34 166 124) now). Mixing unclamped,
  as CSS interpolates, changes gradients too (gradients.md deviation 7) — its own pass.
- **Two anchor utilities without a fallback** for one property cannot
  be told apart (Typed OM reads both as `auto`); the first in the class
  attribute is read.
- **`pnpm build` rebuilding the same packages in parallel app builds**
  — one concurrent run of the four enhancer builds did not reproduce a
  race; left as is.
- **Svelte's fifteen item-part files**: a shared body would add five
  generic components and a prop hop per part, each wrapper still typing
  its props (Svelte cannot mint a component from a factory); left as
  is.
- **Deviations with no stated reason** (audit of every spec,
  2026-09-23), cheapest first — candidates for their own pass:
  - an ancestor anchoring its descendant (anchor-positioning.md 3;
    all three engines refuse it, re-probed);
  - `scroll-smooth` locked to `auto` (scrolling.md 4) and authored
    `scroll-padding` discarded (scrolling.md 3);
  - text indent: negative and percentage values, and its share of the
    intrinsic widths (cell-model.md "Text indent");
  - percent insets on inline relative elements (positioning.md 2);
  - margins on inline-blocks (cell-model.md 5);
  - mixed light/heavy and single/double junction glyphs, which Unicode
    has (only heavy/double lacks them);
  - an absolute box's static position in a text run (positioning.md 3);
  - baseline alignment where first lines sit on different rows;
  - gradient stops clipped to sRGB, `color(display-p3 …)` read as sRGB;
  - `pre-line`/`pre-wrap`/`break-spaces` collapsing whitespace;
  - UAX #14 breaks (CJK, em dash, ZWSP, `<wbr>`, soft hyphen);
  - stacking sorted among siblings only;
  - `text-align: justify` (whole-space justification fits the grid);
  - `aspect-ratio`.
