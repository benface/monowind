# One opacity model: the engine blends in the cells

Status: **implemented** — written and implemented 2026-09-23, filed
under 2026-09-24, the follow-ups dated as they landed; each step's
"Done" note below, its measured numbers in step 9. The spec it
proposed is normative in `cell-model.md` "Opacity and translucency"
("The spec" below), amended 2026-09-25 by the transparent main ground
and a group's opacity on its spans where nothing lies beneath
("Follow-ups").

Decided 2026-09-23 (`2026-09-23-css-deviation-reasons.md` "Order"):
opacity becomes one color-blending model. Each translucent glyph color
or background color is composited over what its cell already holds, and
the cell takes the final opaque color. Cell `opacity` stays only where
the browser has to composite anyway. This replaces today's four paths
and the "blends only with the page behind the host" deviation. It is
chunk 8's opacity item in `2026-09-23-code-removal-pass.md`, which
asked for "a decision on group opacity" first. That decision is below
(Decisions 2), and it changes the line estimate (the "Line delta"
section).

Line numbers are the working tree's on 2026-09-23. element.ts was
being edited at the time, so re-grep its numbers before editing.

## Today: four paths and a box (verified in the code)

1. **Span `opacity`.** The walk carries `alpha` (plain-text.ts:725).
   Each child multiplies in its own opacity and its `inlineOpacity`
   (plain-text.ts:956). A top-layer element restarts at its own
   (plain-text.ts:532-536). The host's own opacity is never multiplied
   in: the root walk starts at 1 (plain-text.ts:531).
   `alphaPaint` (plain-text.ts:748-755) stamps `opacity` onto these
   paints:
   - fills (821, 826)
   - glyph runs: borders, shadows, rules, lattice (759)
   - the leaf's text (876)
   - an inline element's backgrounded text and its pad cells (884, 904)
   - bars (973)

   `applyCellPaint` writes it as the span's CSS `opacity`
   (plain-text.ts:329). The browser then composites the span, its
   background and glyph together, over the host's ground and the page,
   never over the cell it covered. Documented at CellPaint
   (plain-text.ts:62-66) and CellStyle (types.ts:611-616).

2. **The faded glyph color.** An inline element without a background
   fades its glyph color alone:
   - `glyphFade` (plain-text.ts:699-701) and `fadedPaint`
     (plain-text.ts:703-708) mix toward transparent in OKLAB and set
     the `faded` flag (plain-text.ts:67-69).
   - The choice is made at plain-text.ts:880-885.
   - An inline element with a background of its own goes the
     span-opacity way instead (884, 904).

   The data comes from tree.ts:
   - `inlineEntry` stores its opacity times its inline ancestors'
     (tree.ts:657). That product is threaded through `collectNodes` /
     `collectRun` (tree.ts:774-778) and the split path
     (`collectRunNodes`, tree.ts:586-588; `splitOpacity`,
     tree.ts:609-618).
   - A box inside faded inline elements gets `inlineOpacity` through
     `fadedBy` (tree.ts:620-625, used at 121, 355, 745, 755).

3. **The clip-text tint's fade.** `glyphTint` (plain-text.ts:337-357)
   composites a glyph's color over the gradient's color at its cell
   (351), then applies the inline fade through `fadedPaint` (353-356).
   It is called at plain-text.ts:912-918.
4. **The translucent fill that replaces.** `mergePaint`
   (plain-text.ts:435-447) keeps the cell's `backgroundColor` only
   when the new paint carries none. So a fill's `bg-*/N`, or a
   translucent gradient cell, replaces the background beneath, and the
   fill's `" "` replaces the glyph (plain-text.ts:454-461). So
   `bg-white/10` on a `bg-slate-800` card shows white at a tenth over
   the host's ground, not over the slate. The blanked glyph is the
   grid's rule, and stays (Decisions 3).
5. **The box.** paint.ts:73-85 boxes a line or block glyph
   (`isLineGlyph`, paint.ts:524-528) whose paint carries `opacity` or
   `faded` into a fitless box, `data-box="center"` (paint.ts:614-618;
   the centering rule is at element.ts:129). The reason: span opacity
   composites each row's overshoot a second time at the join.
   Authored translucent colors (`text-black/50`, `border-white/20`)
   are not in that predicate. The follow-ups plan reported their seam
   in a scaled layer ("Reported, not changed").

These stay native, and stay as they are:

- the `::backdrop` box's opacity (paint.ts:317, read at style.ts:854)
- the host's own opacity (above)
- the light DOM's authored opacity. It is not locked; styles.css only
  puts it on the sampled transition list at 428 and 447.

These stay as they are too:

- the per-frame sampling: `readPaintStyle` (style.ts:1721-1735), the
  per-frame relayout of an opacity transition (element.ts:325 and
  2389-2395), and the repaint of an opacity keyframe (animation.ts:24-32
  and element.ts:2320-2329)
- the tree's opacity data: `inlineOpacity`, `splitOpacity`, `fadedBy`.
  Only the paint-side fade goes.

## The spec

The spec this plan proposed replaced cell-model.md's "Opacity" section
whole and is normative there as "Opacity and translucency" (its
deviations are 13–19 of the running list). The same step rewrote its
neighbors: cell-model.md "Box model"'s fill bullet, layers.md "Opacity
is the box's", gradients.md "It is the box's fill", theming.md's token
contract (the host's background composited down to an opaque one; the
resolved `--mw-bg` and `--mw-fg` the ground and ink every blend
reaches), and animations.md "Testing". The text reviewed here has
since diverged from them (the clip decision, the deviations folded);
the specs are the source.

## Decisions

1. **One model with opaque results on the main grid, against a known
   ground.** This is the user's decision. The ground and ink are the
   resolved `--mw-bg` / `--mw-fg`, the variables theming.md already
   derives from the host. They are read back as numbers through a probe
   in the shadow, so an author's own `--mw-bg` wins as it does for the
   focus invert. That also gives authors the lever for deviation 14.
   **Amended 2026-09-25:** opaque results where an opaque background
   lies beneath; the ground stands only under a group's glyph over its
   own background (Follow-ups, "From the `color-mix()` prototype").
   **Amended again 2026-09-25:** the ground stands under nothing a
   group paints, only under a selected translucent cell's swap
   (Follow-ups, "A group over nothing on its span").
2. **Group-faithful, not per-paint.** Blending each paint at its
   product opacity would take fewer lines, and it is what chunk 8's
   −30 to −45 assumed. But it draws a group's glyph over the group's
   own fill before fading: `disabled:opacity-50` on a `bg-blue-600
text-white` button over a white page puts its label at three
   quarters white on half blue. CSS puts it at white on half blue, and
   today's span opacity does too. So the per-paint model would regress
   the most common opacity idiom. An opacity root therefore paints into
   a grid of its own and blends it at close. It reuses `openLayer`'s
   recorder (the extent, the ordered ops, covering at record time).
3. **A background hides the glyph beneath, whatever its alpha** (the
   user's rule, 2026-09-23: monowind never renders a translucent
   background over a glyph). Its color composites over the cell's
   background alone, so a `bg-black/50` overlay (the `LayerCover`
   story) blanks the page's text under it, as today, over the page's
   dimmed colors. A text run's space covers too (deviation 13).
4. **Layers keep browser compositing.** A layer's pixels are
   transformed or filtered by the browser, so the engine cannot blend
   with them. A layer root's opacity goes on its box natively, with the
   groups above it multiplied in. That is exact, and it keeps the enter
   transition of a dialog or popover (`opacity-0 scale-95`) a box-only
   frame. Inside a layer the ground is transparent, and translucency
   that reaches it keeps its alpha. That is the only place translucent
   colors remain, and the only place the translucency box remains
   (keyed on the final color's alpha, which also fixes the reported
   `text-black/50` seam in a scaled layer).
   **Amended 2026-09-25:** the main grid keeps translucent colors too
   where no opaque background lies under them, and the box with them
   (Follow-ups, "From the `color-mix()` prototype"); a group's cell
   there, in a layer as on the main grid, keeps the group's paint at
   its opacity on its span (Follow-ups, "A group over nothing on its
   span").
5. **Animated opacity re-blends every frame.** A frame already walks
   the whole paint. A transition relayouts per frame (element.ts:2391),
   and a keyframe repaints (element.ts:2320-2329). Blending adds
   arithmetic only for the fading subtree's cells, memoized by input.
   `paintRows` patches styles in place as long as the run structure
   holds, as it did with the `opacity` field; structure changes only at
   the fade's ends, as today. The lever, if measurements say
   otherwise: an element animating its opacity becomes a layer root
   while it animates, as effects do (layers.md "Animation is sampled"),
   so the frame is a box copy and the cells land blended at the settle.
   That is not the default: a layer contains grid-mode drags, maps the
   pointer, and covers in its own way.
   **Amended 2026-09-24:** a transition of opacity (or of a border
   color: what no other node inherits) is now sampled as its keyframe
   animation is — a repaint of the last layout per frame, no relayout,
   a layer root's opacity a box copy — and its end lands with one
   layout (Follow-ups, "Opacity transitions repaint"). The layer lever
   was built and dropped the same day: a layer leaves what ancestors
   painted beneath it on the main grid, so text under a fading box's
   background would show through until the fade ends (against
   Decisions 3), and it made opacity a special case.
6. **`bg-clear` is a wipe, not paint.** It takes no opacity and cuts
   through its groups to the ground, as today's unfaded wipe does. The
   UI popover story fades a `bg-clear` panel in, and it keeps its
   look.
7. **Color emoji fade by alpha.** Their glyph ignores the color's hue
   but, in the engines we know of, not its alpha; the `color:
transparent` tinting idiom relies on that. Step 0 probes all three
   engines. Where one ignores the alpha, emoji there paint whole, as
   today's faded inline path already paints them. **Amended
   2026-09-25:** a group's fade reaches an emoji in WebKit too, on its
   span or on a copy of its glyph; a color's own alpha is drawn as the
   browser draws it (Follow-ups, "A group over nothing on its span").
8. **Unreadable colors resolve through the shadow.** `parseColor`
   reads what engines serialize. A leaf renderer's `var(--mw-ansi-*)`
   (leaf.ts:16-17, ascii's sgr.ts:22) and a shadow's
   `color-mix(… var(--mw-fg))` (borders.ts:121, 130) are read by
   setting them on a hidden probe in the shadow, which inherits what
   the spans inherit. The result is cached per layout. What still
   cannot be read (`lab()`, `lch()`) passes through unblended
   (a deviation, since gone) until `parseColor` reads them (Order
   item 5).
9. **The tree's opacity data stays.** `inlineOpacity`, `splitOpacity`
   and `fadedBy` tell the walk a box's group opacity. The inline entry
   changes from "the product" to "its own opacity and its parent
   entry", so the paint can fold the chain.

## What the compositor needs

- **The ground and the ink per host, per layout.**
  - `#syncTokens` (element.ts:2231-2238) stops at the first background
    that is not fully transparent (`isTransparentColor`, alpha 0 only).
    Instead it composites translucent backgrounds down to an opaque
    one with `compositeColors`, over `Canvas`.
  - A hidden probe in the shadow template (`<i id="probe" hidden>`)
    resolves `Canvas`, then `var(--mw-bg)` and `var(--mw-fg)`, to
    numbers after the sync (element.ts:2586). A `display: none` element
    still computes colors.
  - `#paint` (element.ts:1959-1969) passes `ground`, `ink` and the
    probe-backed `readColor` into `PaintOptions` → `RenderOptions`.
  - The Node renderer defaults the ground to white and the ink to
    black.
- **Colors as numbers, only where a blend needs them.** A per-paint
  cache maps each string to `Rgba | null` (`parseColor`, then
  `readColor`). A cell keeps each of its two colors as the authored
  string until a blend touches it. After that it keeps a premultiplied
  `Rgba` and serializes once, when rows are built (`rowSegments`),
  through a memo. An unblended opaque color keeps its string, so
  Tailwind's `oklch()` reaches the span as today.
- **One operation, `blend(cell, α)`.** A cell of a group's grid is a
  glyph (a cluster, a blank, or none), the glyph's color over the
  group's background, the background, a `clear` mark, a gradient mark
  (so runs still join as per-cell stops), and an emoji's alpha.
  - A fill is `blend({glyph: blank, bg: F}, 1)`.
  - A text put is `blend({glyph, color: C over B, bg: B}, 1)`, where B
    is an inline element's own background.
  - A group's close blends each cell it touched at `α`.
  - An inline chain is folded once per entry per paint (innermost
    first, each ancestor's background beneath) into such a cell and
    blended at 1.

  The store applies the spec's rules: bg over bg; the glyph replaces,
  its color over the old background; a background blanks the glyph beneath;
  `clear` resets to the ground first. The walk's put chain (`clipPut`,
  the layer and group recorders, the store) forwards `blend`. This
  replaces `mergePaint` and every `alphaPaint`.

- **Groups.** `walk` opens a group where `style.opacity ×
(inlineOpacity ?? 1) < 1` and the node is not a layer root. A
  top-layer element uses its own opacity alone. The group's recorder
  becomes `walking.put`, so hoisted (fixed) descendants stay inside
  it. Its puts cover closed layers as they are recorded (the replay
  must not cover again, or text recorded before a layer inside the
  group would cover it). Its close lays the ops into a `cellStore` of
  its extent with a transparent ground and blends each touched cell
  into the enclosing put. `Walk` carries the product of the open
  groups' opacities since the enclosing layer. A layer opened under
  them records it (`PaintedLayer.alpha`), and `placeLayer`
  (paint.ts:327-396) writes `opacity = alpha × the root's live computed
opacity`, added to its `placed` key.
- **Cost per cell.**
  - Nothing blends (the bench pages, most pages): one cache lookup per
    color per put, on top of today's merge; no numbers are written.
  - A blend: a dozen multiply-adds and one memoized serialization per
    distinct result.
  - A group: one more pass over its extent at close.

  How the walk stays fast:
  - Translucent colors blend in place and never open a group.
  - The inline fold is done per entry, not per cell.
  - The caches are keyed by string and cleared per layout.
  - Identical inputs give identical strings, so runs join as before.

  Risk: glyphs blended over a gradient differ cell by cell and cannot
  join a `backgrounds` run (a span can't take both stop lists), so
  faded text over a gradient is a span a cell. It is rare; measure it.

## Steps

0. **Probes, no code** (all three engines, a scratch page): a hidden
   element's computed `color` and `background-color` for `canvas`,
   `canvastext`, `var(--mw-bg)` and `color-mix(… var(…))` come back as
   `rgb()`/`color()`; a color emoji under `color: rgb(0 0 0 / 0.5)`
   draws at half; `bg-red-500/50` (oklch) over white, blended by the
   browser, against the engine's unclamped and clamped blends on an
   sRGB screen, to settle open question 3.
   **Done.** All three engines resolve `canvas`, `canvastext` and a
   `var()` on a hidden probe in a shadow root to `rgb()`, a
   `color-mix(in srgb …)` to `color(srgb …)`, `oklch()` and `lab()` as
   written (`lab()` stays unreadable: a deviation, since gone);
   `color-scheme: dark` on an ancestor gives the dark canvas. A color
   emoji under `color: rgb(0 0 0 / 0.5)` draws at half in Chromium and
   Firefox and WHOLE in WebKit, which draws it only at an alpha of 0
   not at all (deviation 16 says so). An in-gamut `bg-red-500/50`
   blends within a
   unit of the browser's either way; an out-of-gamut one does not: on
   an sRGB screen every engine clips the color before blending, so
   `bg-yellow-400/50` over white is blue 127 in the browser, 128
   clamped, 93 unclamped — a sixth of a channel (deviation 17 now gives
   the number). Every engine displays `color(srgb …)` past sRGB clipped
   per channel, so a gradient cell written that way paints as its
   clipped `rgb()` did. The decision (unclamped) was kept at first,
   then turned to clip when blending (open question 3).
1. **The spec** ("The spec"), after review: cell-model.md, layers.md,
   gradients.md, theming.md, animations.md; types.ts and plain-text.ts
   doc comments follow in the code steps.
   **Done**, as reviewed, and gradients.md deviation 6 kept its hsl half;
   cell-model.md "Animation" says a synthesized fade is written
   unclipped too.
2. **The ground and ink** (element.ts, plain-text.ts `RenderOptions`,
   paint.ts `PaintOptions`). Tests: element.test.ts covers the
   derivation through a translucent host background and an explicit
   `--mw-bg`, which happy-dom can compute. A story covers `Canvas` under
   `color-scheme: dark`.
   **Done.** The probe is `<i id="probe" hidden>` in the shadow, its
   own style reading `var(--mw-fg)`, `var(--mw-bg)` and `canvas`;
   `#syncTokens` reads it back right after writing the tokens, while
   the style is clean, and re-reads there the colors the last paint
   asked `readColor` for (`#probedColors`), so a paint forces a style
   flush only for a color it has not met before. happy-dom resolves a
   `var()` but not a CSSOM rule edited in place, so element.test.ts
   pins the derived token (translucent over opaque) and the paint over
   an author's `--mw-bg`; the `Ground` story (theming.stories.ts) pins
   the derived ground's blend and the dark `Canvas` in the browser.
3. **The store blends** (plain-text.ts `cellStore`), with no groups
   yet: `mergePaint` goes, a translucent fill or gradient cell
   composites over the cell's background and blanks its glyph, and the
   tint's `compositeColors` result is blended like any glyph color.
   Tests written first and seen failing today: a translucent child
   background over a painted parent's (path 4). Then: a translucent
   fill over a glyph blanking it, in the transcript too; a partial
   cover of a wide cluster; `text-*/N` over a
   background coming out opaque; a translucent fill over a gradient
   keeping one run of stops; unblended colors keeping their strings.
   **Done**; each red on the tree before (a scratch copy). A leaf's
   glyphs no longer carry the leaf's own background (the fill painted
   it; carried, a translucent one would composite twice), so a glyph
   overflowing its box shows what lies beneath, as in CSS.
4. **Groups** (plain-text.ts `walk`, `openLayer` generalized). The
   walk's `alpha` and `alphaPaint` go, as do `CellPaint.opacity`, its
   write in `applyCellPaint`, and the field in `samePaint`,
   `joinGradient`, `isBarePaint` and paint.ts `segmentKey`. Tests
   written first, seen failing: the filled button at 0.5 (label white
   on half blue, exact numbers). Then: nested groups; a translucent
   color inside a group; `opacity: 0` (glyphs present, colors beneath);
   the top layer escaping its ancestors (top-layer.test.ts:264,
   rewritten); a fixed descendant faded with its group; `bg-clear` in a
   faded box; a layer closed inside a group covered only by ink walked
   after it.
   **Done**: `recorder` is the shared half of `openLayer` and
   `openGroup`; a group's close lays its puts on a store with a
   transparent ground (`touched` marks the cells, `WIPE` the
   `bg-clear` cells) and `blendInto` emits them through the grid's
   `target`, the put that covers nothing. Every test red before.
5. **Inline elements** (tree.ts entries: own opacity and a parent
   index; plain-text.ts: the per-entry fold). `glyphFade`, `fadedPaint`
   and `faded` go, and `glyphTint` loses its `fade`. Tests: the three
   "opacity" cases in plain-text.test.ts:696-767 rewritten to blended
   colors; gradient.test.ts:532 to the blended tint; and, written
   first and seen failing, an outer inline element's background under
   an inner one's characters ("Found on the way").
   **Done**: `inlinePaint` folds an entry's chain once per paint (per
   cell under a tint). A split owner's entry keeps its own opacity
   times the split ancestors' (they are no entries), exact while they
   have no background. Red before: all four.
6. **Layers** (plain-text.ts `PaintedLayer`, paint.ts `placeLayer` and
   the boxing predicate: `isLineGlyph` and a final glyph color with
   alpha under 1, which only a layer allows). Tests: layer.test.ts
   (box opacity, cells unfaded, alpha kept over the layer's empty
   cells); paint.test.ts:232 rewritten (no box on the main grid; a
   translucent `│` in a layer boxed); the scaled-layer `text-black/50`
   seam from the follow-ups report, seen failing today.
   **Done**, each red before. The predicate reads a color's alpha
   through a per-paint cache; a scaled layer's declined fit still
   clips the translucent glyph, as a faded one's did.
7. **Emoji and unreadable colors** (width.ts exports its
   emoji-presentation test, width.ts:88-105; the store's coverage;
   `readColor`). Tests: an emoji through a group; a fill blanking one; a
   `var()` color in a group blended through a stubbed `readColor`.
   **Done** (`isColorEmoji`: a two-cell emoji cluster; the store asks
   only of a two-cell cluster below full coverage). The emoji and the
   `var()` tests red before; the blanking one guards a behavior the
   tree before shared.
8. **Stories and the blend spec** (below), then the goldens.
   **Done.** The rewritten plays and the `Ground` story red on the tree
   before, green in all three engines (549 story tests). `Test / Blend`
   (blend.stories.ts) and `visual/blend.spec.ts`: 19 samples within
   2/255 in all three engines, in Docker too; on the tree before seven
   fail in each (the nested groups, the translucent shade, the inline
   groups, the veil over a gradient). The fixture's popover sits in a
   blank host of its own: the stack clamps it to its host, where it
   would cover a case. Goldens: see step 9's note and "Tests".
9. **Performance**:
   - `pnpm bench` boxes, blocks and prose must stay unchanged within
     noise. No group opens there, so this is the fast path.
   - Add a `faded` shape to bench.mjs: every other box at `opacity-50`,
     a `bg-white/10` card, and one translucent overlay. Record its
     interactive time, and a fade frame's paint time over 300 boxes, in
     performance.md.

   **Done** (performance.md "One opacity model"). Page loads, four
   rounds alternated against the tree before and a second copy of it:
   boxes 169 against 173.5 / 169.5 ms, blocks 214.5 against 217 / 216
   (its runs land on two frames in every build), prose 180.5 against
   183 / 183, faded 188 against 192.5 / 193; style recalc level. The
   paint alone in Node: faded 3.80 against 3.79 ms, blocks 2.53 against
   6.52 (the store's rows copied from a blank one, a run of one paint
   asking its opacity once). A fade frame (twenty opacity steps, a
   relayout each): main-thread CPU 181.1 against 173.4 / 173.1 ms, the
   engine's script 66.8 against 75.2 and style 61.2 against 65.4, the
   browser's `Paint` 19.0 against 2.1 ms a step: a recolored span is
   recorded again where an `opacity` was a property. So the faded
   page loads no slower and a fade frame costs about 8 ms more of
   main thread at 150 faded boxes; Decisions 5's lever (a layer while
   the opacity animates) is the fix, not taken.

10. **Close-out**: layers.md, gradients.md and cell-model.md touch
    points; chunk 8's opacity item in the removal plan marked done
    with the measured delta; the reasons plan's "Order" note.
    **Done.**

## Follow-ups (2026-09-23)

- **Clip when blending** (open question 3). `compositeColors` clips
  each color to sRGB per channel before it blends; an opaque color, or
  one over transparent, is no blend and passes unclipped, so a
  gradient's stops still mix and paint as `color(srgb …)`.
  cell-model.md deviation 17 and gradients.md deviation 6 say so. Red
  first: `bg-yellow-400/50` over the ground, and an `oklch()` fill and
  glyph far past sRGB in an `opacity-50` group, added to the blend
  fixture — off in all three engines before (blue 91 against the
  browser's 125, the group's fill 149,0,84 against 128,0,99), within
  2/255 after; unit tests in gradient.test.ts (the composite) and
  plain-text.test.ts (a translucent fill, a group). The Opacity
  story's cyan-400 border now expects the clipped blend. Goldens:
  `features-effects--gradients` back on its bytes before the opacity
  model (the render is within a unit of them: 86,860 pixels by 1, a
  gradient cell past sRGB written `color(srgb …)` rounding a unit
  apart from the clipped `rgb()` it was); `features-overflow--styled`
  updated, 375 pixels up to 34 from its bytes before the model — the
  track's `░` in `scrollbar-track-yellow-400/25` is an opaque blended
  color now, where the translucent one composited twice where rows'
  glyphs overlap (227 against a single composite's 237);
  `features-effects--opacity` updated again, the cyan-400 border's
  blend clipped (up to 49) and fuchsia-400's (up to 2). The other
  goldens of the effects, interactive, overflow, top-layer, theming,
  ui and themes stories held.
- **The inline padding leak.** styles.css resets `--mw-ipl`/`--mw-ipr`
  to 0 on every light element, plainly, as `--mw-sx`/`--mw-sy` are, so
  only the engine's inline value pads an element and a span inside a
  padded one takes none. The `NestedInlinePadding` story (typography)
  was red in all three engines before: the inner span's box five cells
  wide for its one, the text after it four cells off. `pnpm bench`,
  four rounds alternated with a second copy of the build before: prose
  style recalc 53.2 / 52.7 → 53.0 ms, boxes 25.1 / 25.1 → 25.2 ms;
  interactive level.
- **Trimmed** plain-text.ts, with no change of behavior: the palette's
  `blend` keeps an opaque color's string itself and takes the ground as
  a written color like any cell's background (the store's wrapper, the
  inline fold's `over`, the tint's check and `covered` go); the store's
  `clear` is the group's wipe; a group's close blends its store inline;
  a layer and a group each open a `Scope` with its walk; `clipPut`
  takes the clip; the clip-text tint reads the gradient's cells in the
  leaf's paint; the pad cells' paint is made where it is put. paint.ts
  forwards its render options in one destructure; width.ts's
  `isColorEmoji` loses a fast exit its callers never needed. Lines:
  plain-text.ts −101, paint.ts −5, width.ts −1 ("Line delta"). Checked
  by a differential fuzz: 5,000 random trees from HTML (groups nested
  and at 0, translucent and out-of-gamut and `var()` colors, gradients
  and their text clip, inline chains with padding and backgrounds,
  emoji, `bg-clear`, layers, the top layer, fixed boxes, scrollbars,
  selections, boxed fits), each built, laid out and painted by the core
  before the trim and after — cells, segments, layers, the DOM rows,
  the hit maps — zero differences; four faults planted in the core
  before showed up in 2 to 131 trees of 300 (the tint's, 5 of 600).
  The paint in Node (paintbench, faded,
  three sittings): 3.76 / 3.70 / 3.76 ms against 3.86 / 3.76 / 3.80
  and a second copy's 3.79 / 3.69 / 3.84; blocks 2.47 against 2.51 /
  2.52 — the store's rows built with `Array.from` had cost 0.2 ms, so
  they stay a loop. `pnpm bench`, four rounds alternated (load
  4.1–5.4), interactive against before and a second copy: boxes 168.5
  against 170 / 168.5, prose 181 against 180.5 / 181, blocks 227.5
  against 224.5 / 233 (its two frames), faded 187 against 187 / 188.5
  over six more rounds, style recalc level.
- **Opacity transitions repaint** (2026-09-24, Decisions 5 amended).
  A transition of a paint-only property no other node inherits —
  `opacity`, a border color — on a light element is sampled as its
  keyframe animation is: the element joins the animated set at its
  `transitionrun` (element.ts `#animatedBy`, animation.ts
  `sampledAsAnimation`), each frame repaints the last layout at its
  live value, and its end or cancel lands with one layout. `color`
  stays on the per-frame relayout (its children's and inline runs'
  snapshots), as do the host's own transitions and a pseudo-element's.
  A layer root's opacity, transitioned or animated, takes the box path
  (`animationPath`), so an `opacity-0 scale-95` enter is box-only, as
  Decisions 4 said it would be. With 150 boxes fading, each element's
  own `getAnimations()` per tick was 41% of a frame (Chromium scans the
  document's animations per call); the tick asks the host once with
  `subtree: true` (`animatedPropertiesUnder`), and `#follow` leaves the
  path to it. Tests, each red on the tree before: `OpacityTransitions`
  (effects.stories.ts) — an opacity fade, and one beside a scale back
  to the identity, move no layout between their first frames and
  their ends (27 layouts each before), landing blended exactly; one
  beside a color change still relays out each frame (a guard, green
  before too); animation.test.ts — the transitions collected as
  animations (opacity and border colors, not color), the subtree query
  by element, a layer root's opacity on the box path. The fade frame
  on the faded shape (performance.md "Opacity transitions repaint",
  per frame of a 2 s fade's middle): v0.3.2 145.2 ms, blended with
  fades relaying out 139.7, blended with fades repainting 52.1, frames
  9 / 9 / 24; the browser's `Paint` 2.1 / 17.0 / 17.9 ms a frame.
  Page loads level. Lines: animation.ts +39, element.ts +21.
- **The host's transitions, a layer root's start, one layout a frame**
  (2026-09-24). The host's own opacity and border-color transitions
  are the browser's, as its animation is (`#animatedBy` names the
  host, which nothing follows); its `color` still relays out. A
  pseudo-element's stay on the relayout: `::backdrop`, the one the
  engine draws, fades through it in Chromium and Firefox (probed: the
  backdrop box took 38 and 40 opacities over a 600 ms transition;
  WebKit fires it no transition), and the other paths read no
  pseudo-element. An effect's `transitionrun` lays out only for an
  element not yet a layer root. Any layout cancels a pending
  scheduled one, and the sampling tick skips a frame a scheduled
  layout ran in (the probe first: 38 of 39 frames of a color
  transition laid out twice with a timer changing text, tick first;
  every other frame with a frame callback changing it, scheduled
  first; and the transition's first frame in either). Tests, red on
  the tree before: host.stories.ts `Transitioned` (28 layouts over the
  host's fade), effects.stories.ts `LayerRootTransition` (a rule
  outside the host starting it: 1 layout) and `OneLayoutAFrame` (28
  doubled frames without the cancel, 1 without the tick's skip).
  performance.md "The host's fades, and one layout a frame".
- **Review fixes** (2026-09-24). A color emoji in a layer faded twice
  (α², α(α+β−αβ) over a translucent fill): the store's `final` flag
  goes, every store keeps a faded emoji's coverage apart, and the main
  grid and a layer write it into the color's alpha once they are done
  (`fadeEmoji`). A zero-alpha color is no paint (cell-model.md
  "Painting a cell"): `compositeColors` gives the color beneath as it
  is, the palette's `blend` its string, and `merge` keeps the cell's
  background under a zero-alpha one, so an `opacity-0` fill neither
  clips an `oklch()` beneath to sRGB nor writes the ground over an
  unpainted cell, and `text-transparent` over a gradient is unclipped.
  `touched` is a group's alone; the covering put, the cluster walk
  (`forEachCluster`, but `rowSegments` keeps its own loop: 0.13 ms of
  a 3.4 ms blocks paint) and the boxing predicate's alpha read (the
  palette's, told by `rowSegments`) are one each. width.ts: a lone
  regional indicator is no color emoji, and a text-presentation
  pictograph in the East Asian Wide blocks (〰, ㊗) is two cells. The
  first-writer read-back is kept and documented (under a unit of 255);
  reading every written string back as its own value is deterministic
  but moves 1,490 of 3,000 fuzz trees by a unit. Tests red on the tree
  before: plain-text.test.ts (the layer emoji, the `opacity-0` box over
  green-500 and over no ground), gradient.test.ts (the composite, the
  tint), width.test.ts. Differential fuzz, 3,000 trees: the refactors
  alone 0 differ; with the fixes 1,266, each with a zero-alpha color or
  an emoji in a layer. Paint in Node level (faded 3.86 → 3.79 ms,
  blocks 2.64 → 2.60).
- **From the `color-mix()` prototype** (2026-09-25). A prototype
  writing every blend as a `color-mix()` string for the browser to
  compute was rejected on performance (fade frames at 1.3 to 2.3 times
  the CPU), but a rendered-color comparison of it against this model
  showed four improvements, ported here with short `rgb()` output:
  1. **A layer composited a translucent glyph over a translucent
     background twice.** `merge` composited a glyph's color over the
     cell's background as it was; in a layer, with no ground, a
     translucent background stays translucent, so the span drew the
     glyph, its color holding that background, over the background
     again (`text-white/50` over `bg-black/50` wrote
     `rgb(170 170 170 / 0.75)`; up to 64/255 off, 2,554 cells in 67 of
     400 fuzz trees). A glyph's color is now drawn over the cell's own
     background: blended into it where that background is opaque, kept
     over a translucent one or none. A glyph faded with its own
     background (a group's) is one color over the two, which a group's
     cell marks (`PIXEL`) so an enclosing group does not blend the
     background into it again.
  2. **A transparent main ground** (Open question 2 amended). What no
     opaque background lies under keeps its alpha on the main grid too,
     so the browser composites it over what is behind the host — an
     image, a gradient, page content — and deviation 14 is left with
     one case: a group's glyph over its own background with nothing
     opaque beneath composites over `--mw-bg`, as does that background
     at the glyph's cell. Selection's swap composites a translucent
     cell over `--mw-bg` first. The boxing predicate, keyed on the
     final color's alpha, now boxes on the main grid what it boxed in
     a layer. Found on the way: the tiling fits overdraw
     (wide-characters.md), so a translucent shade's lattice copies
     tripled its ink over the glyph (the box-shadow rings, the styled
     scrollbar's track) and a translucent band's shared box doubled its
     joints. A translucent shade with no background of its own is now
     one group, its color opaque and its alpha on its box, and a
     translucent band is boxed cell by cell; a shade over a translucent
     background keeps its lattice doubled (wide-characters.md
     "Deviations"). A transparent `scheme-dark` host's translucent
     colors now composite over the page's light canvas, as CSS does
     (the `Ground` story).
  3. **A color emoji keeps an authored translucent color's alpha.** Its
     coverage is its color's alpha times its groups', never blended
     into the background beneath (the model had drawn it whole where
     it blended the color opaque); over a group's own fill, its cell
     keeps the group's translucent background, as an emoji has no
     color for the ground. WebKit's whole emoji stays deviation 16.
  4. **`parseColor` reads `color()` in a98-rgb, prophoto-rgb and
     rec2020** (css-color-4's transfer functions and matrices,
     prophoto's D50 white adapted by Bradford), so deviation 18 is
     gone and 19–23 are 18–22. Every form the three engines compute
     now reads (probed: `color-mix()` and relative colors over
     `currentcolor`, `light-dark()`, `hwb()`, `contrast-color()`, the
     system colors), so `colorAlpha` drops its text fallback: a color
     the parser cannot read is taken as opaque, as the palette takes
     it. That can still happen only without the shadow's probe (Node:
     a `var()`, a `color-mix()`, a name) or for a string the probe
     rejects.

  Tests, each red on the tree before (a scratch copy) or, for the
  guards, with its mechanism taken out of a copy: layer.test.ts (the
  layer's glyph over its translucent fill, and a faded one); in
  plain-text.test.ts the translucent colors kept over no opaque
  background, the fit told a translucent color on the main grid, a
  faded box's blank cells translucent and its label over the ground,
  the emoji's alpha over any background and over its group's fill,
  and the expectations the transparent ground turned translucent
  (nested groups, a fixed descendant, `bg-clear`, `opacity-0`, a
  `lab()` and a `var()` color, an inline element's held boxes);
  element.test.ts (an author's `--mw-bg` under a faded box's label),
  gradient.test.ts (the three spaces against Firefox's and WebKit's
  conversions, an unreadable form's alpha, a translucent gradient and
  a tint over nothing), top-layer.test.ts, paint.test.ts (the main
  grid's boxes, the shade's group, the band's boxes); guards: the
  selection's swap over the ground, and a group's glyph carried
  through nested groups (`PIXEL`). The blend fixture gains 16 samples
  (the three spaces, `lab()`, a system color, a glyph over nested
  groups' fills, a glyph blanked by an overlay, a layer's glyph over
  its translucent fill, and a transparent host over an image: a veil,
  a translucent glyph, a faded glyph, a faded button's fill, and one
  whose host names the image's color with `--mw-bg` for its label):
  all 38 within 2/255 in all three engines, where the tree before
  missed 8 in each (the three spaces, the four image cases, the
  layer's glyph). Stories: the `Ground`, `Opacity`,
  `StaggeredTransitions` and `TransitionSampling` plays expect the
  translucent colors, red on the tree before. The paint fuzz: 3,000
  trees with nothing translucent paint byte for byte alike; the
  rendered-color comparison (400 trees, every string resolved in each
  engine) differs only in the classes above. Goldens, each diff read:
  `features-effects--opacity` (9,808 pixels, up to 14) and
  `features-interactive--click-through` (652, up to 14), faded text
  and borders drawn translucent where they were blended over the
  ground, at their antialiased edges; `features-effects--box-shadow`
  (22,469, up to 11), its rings' shades drawn as groups;
  `features-effects--layers` (4,448, up to 127), the translated
  layer's `shadow-md`, whose translucent shades tripled their lattice
  in a layer before. `features-overflow--styled` moved (375, up to 34:
  the track's lattice tripled) until the shades' group, and is back on
  its bytes. Performance, alternated against the tree before and a
  second copy of it: the paint in Node, faded 4.04–4.09 ms against
  3.98–4.06 and 3.99–4.07, the same page over no background 3.67–3.74
  against 3.67–3.71 and 3.65–3.81, blocks 2.63–2.66 against 2.61–2.67
  and 2.60–2.65, the prose page 5.89 against 5.89 and 5.95 (splitting
  `merge`'s blending half off its fast path won back 2% it had cost);
  page loads, six rounds at a load average of 7, faded 202.5 ms
  against 197.5 and 207.0, prose 192.5 against 187.0 and 189.0 (the
  paint level, the spread the machine's); a fade frame over 150 boxes,
  main-thread CPU 52.1 ms against 52.7 and 52.3, the browser's `Paint`
  16.8 against 18.0 and 17.8. Lines: core src +139 (plain-text.ts
  +101, color.ts +35, paint.ts +3), unit tests +215, the blend fixture
  and spec +100, the plays +22.

- **A group over nothing on its span** (2026-09-25). Two regressions
  against v0.3.2 closed by one rule. A faded group's glyph over its
  own fill with nothing opaque beneath composited over `--mw-bg`,
  wrong over an image (deviation 14), where v0.3.2's span `opacity`
  was CSS exactly; and WebKit drew a color emoji whole inside a faded
  group, ignoring its color's alpha. The rule: a group's cell over an
  opaque background is blended as before; one over nothing keeps the
  group's own paint and takes the group's opacity as its span's
  `opacity` (`CellPaint.opacity`, nested groups multiplying, an
  authored translucent color keeping its alpha inside); one over a
  translucent background blends, and where the group's glyph lies
  over the group's own background the two are one opaque color at the
  alpha they reach, their background under it at the same — exact,
  where the ground had stood. A later paint lands over such a cell's
  colors at their opacity. So `PIXEL`, the store's ground and its
  `--mw-bg` fallback, the emoji coverage map and `fadeEmoji` go: the
  main grid's store and a layer's are one, a group over a layer's
  unpainted cells takes its span's opacity too (deviation 15's first
  case gone), and the palette's `composite` is the one rule the store's
  `merge` and the inline fold share. A color emoji keeps its color for
  the browser: a group over nothing fades it on its span in every
  engine, and one over a blended cell by `emojiOpacity`, drawn through
  the shadow's `[data-emoji]` copy of the glyph at that opacity, the
  span's own glyph transparent — small (22 lines with the field) and
  cheap (`attr()` on those spans alone), so taken; WebKit draws the
  copy transparent like the span's glyph unless its font size differs,
  so the copy's is a hair off. A color's own alpha stays the browser's
  to draw, whole in WebKit on macOS as Safari draws it; WebKit in the
  Playwright image honors it. The selection swap keeps the span's
  opacity, as CSS draws a selection in a faded element, and swaps a
  blended emoji's color at its opacity. A frame of a fade over nothing
  writes each span's `opacity` alone (`paintRows`). Deviations: 14
  gone, 15's first case gone (the second is 14), 16 narrowed to an
  emoji over a blended cell (15), 17–22 renumbered 16–21. Tests, each
  red on the tree before (a scratch copy): 22 unit tests (plain-text, layer, element, top-layer,
  gradient, paint), the rest of the rewritten expectations; the blend
  fixture's new samples — a faded button's label over an image, a
  veiled button's (over `bg-black/50` over the image), an emoji in a
  group over the image, with an authored alpha, over its group's fill,
  and over a fill — red in Docker in all three engines for the two
  labels and the emoji over its fill, and in macOS WebKit for all four
  emoji, beside a guard, a veil over a faded fill; after, all 44 samples within 2/255 in all three engines, in
  Docker and on macOS. Mutants of each mechanism (the flattening, the
  inline fold's emoji, the one-color composite, the store's emoji, the
  new `samePaint`, `joinGradient` and `segmentKey` fields, the bare
  span check, the boxing's opacity, the emoji copy, the span opacity
  itself) each fail a unit test. The paint fuzz: 3,000 trees with
  nothing translucent paint byte for byte alike; of 186 with no
  opacity, 14 differ, each only by an emoji's color (the authored
  string, where the blended hue was, the same alpha). The
  rendered-color comparison (400 trees, three engines) differs only
  in: a layer's group glyph over its own fill (2,733 cells in 58
  trees, up to 64/255), selected cells at their span's opacity (7
  cells), a selected blended emoji keeping its fade (1), and an
  `opacity: 0` inline element with its own background over a
  translucent inline ancestor's, whose glyph had drawn in the
  ancestor's color (16 cells in 1 tree). Stories: `Opacity`,
  `OpacityTransitions`, `AnimationPaths` and `Ground` rewritten, red
  before; the rest read a span's color at its opacity (`shown`). 597
  story tests green in three engines. Goldens: `features-effects--opacity`
  (9,886 pixels, up to 8) and `features-interactive--click-through`
  (728, up to 5), faded text at its antialiased edges, now 836 and
  728 pixels (up to 5) from v0.3.2's, only the inline spans'. Lines:
  core src −23 (plain-text.ts −42 — `PIXEL`, the ground, the emoji
  coverage out, the emoji copy's field in — paint.ts +14, the copy and
  the one-property patch, element.ts +5), unit tests +217.
  Performance: architecture/performance.md "A group over nothing on
  its spans": a fade over nothing 50.0 → 34.6 ms CPU a frame, 25 →
  36 frames in its middle, the browser's `Paint` 17.2 → 7.8; over an
  opaque background level; the paint in Node and page loads level.

## Tests

- **Unit** (packages/core/test): the step lists above. Assert exact
  blended numbers against a given `ground` and `ink`. Tests that blend
  nothing keep passing untouched; that is the fast path's contract.
- **Stories** (apps/storybook/stories). Assertions reading
  `span.style.opacity` move to blended colors. The expected colors come
  from the browser's own `color-mix(in srgb, A p%, B)` on a probe,
  which equals source-over for opaque B.
  - effects.stories.ts `Opacity` (54-77): no span carries `opacity`,
    and no translucency box on the main grid.
  - `TransitionSampling` (833-844): the snap is two colors, not
    `""`/`"0.25"`.
  - `Animations` (1012, 1039-1045): the pulse's colors change; `leave`
    holds its box at `opacity: 0.25`, its cells unfaded.
  - `AnimationPaths` (1105).
  - top-layer.stories.ts `Transitions` (286-303): the popover's blended
    color moves, then lands.
- **Against the browser.** Add a hidden fixture story, `Test / Blend`,
  plus `visual/blend.spec.ts`, goldenless, in all three engines (added
  to playwright.config.ts's webkit and firefox `testMatch`, like
  `agreement`).
  - Each case renders twice, with the same classes: inside
    `<mono-wind>`, and natively in a plain `font-mono` div beside it on
    a flat page.
  - Glyph colors are sampled from a `█`; backgrounds from a padding
    cell. The sample is the center pixel of a `data-test` element's
    rect. That works for both twins, because the light element sits on
    its cells.
  - The screenshot is decoded as `selection.spec.ts:152-166` decodes
    it.
  - Within 2/255 per channel, for:
    - a filled box at 0.5
    - nested 0.5 × 0.5
    - `bg-black/50` over a painted parent
    - `text-*/50` over a fill
    - a faded span without and with a background, and a nested one
    - `bg-white/30` over a gradient
    - `opacity-0`
    - a popover at 0.5 over the page
    - `grayscale-0 opacity-50` (a layer that changes nothing, so its
      box opacity alone is compared)

  In-gamut `rgb()` arbitrary colors throughout, plus one Tailwind
  oklch case at the tolerance step 0 sets. Not compared: deviations 13–16
  and the clip-text fade, which the engines draw three ways.

- **Goldens.**
  - Expected to move: `features-effects--opacity` (the boxes go, colors
    blended).
  - May move by a unit: `features-effects--layer-cover` (the overlay's
    color blended by the engine), `features-interactive--click-through` (the
    faded link), `features-effects--box-shadow` (ring colors blended by
    the engine), `features-effects--layers` (a translucent line glyph
    in a scaled layer, if any).
  - Any other golden that moves is a fast-path bug. The full run is
    once, at the end.
  - **Moved** (2026-09-23, every Chromium golden run once; as they
    stand after the clip decision, "Follow-ups"):
    `features-effects--opacity` (the boxes gone, colors blended, up to
    49/255, the cyan-400 border's blend clipped);
    `features-interactive--click-through` (the faded link, up to 14);
    `features-effects--box-shadow` (up to 53 at the shade glyphs'
    edges: the rings' ink is opaque now, where the lattice's
    overlapping copies composited a translucent color twice);
    `features-overflow--styled`, not predicted (375 pixels, up to 34:
    the track's `░` in `scrollbar-track-yellow-400/25` is an opaque
    blended color, where the translucent one composited twice where
    rows' glyphs overlap). `features-effects--gradients` moved with the
    unclamped blend and is back on its bytes since the clip.
    `layer-cover`, `layers` and the UI stories did not move.

## Risks

- **The ground mismatches what is painted.** A translucent host
  background paints three times: the host itself, then `#viewport`
  and `.grid` inherit it (element.ts's shadow template). The derived
  ground composites it once. Either composite it as the shadow paints
  it, or stop the repaint first. Themes paint opaque grounds, so this
  is rare. **Open**, documented as cell-model.md deviation 18.
- **Wide gamut.** Settled by open question 3: blends clip to sRGB as
  every engine does on an sRGB screen, so on a wide-gamut one a
  translucent color outside sRGB blends duller than the browser's own
  (cell-model.md deviation 17).
- **Covering inside groups.** A group's ops must cover at record time
  and not again on replay (see "Groups" above).
- **Stacking.** An opacity root is a stacking context. Order item 4
  (lifting z-indexed descendants through `z-index: auto` ancestors)
  must stop at one, and the group recorder is where a lifted
  descendant would escape. Whichever lands second handles it.
- **Selection preservation.** Blended strings change at a fade's two
  ends, where today's `opacity` field appeared and went: structural
  rebuilds there, style patches between, as now.
- **Editables.** render.ts:96-132 still writes an editable's authored
  `--mw-ground`/`--mw-ink`. Under a translucent fill, its native
  selection swaps authored colors, not blended ones. Its native ink
  fades natively over the blended cells, as today. Left as is: an
  accepted gap in the editables' own swap, which no spec lists (its
  gradient case is gradients.md deviation 5).
- **Rounding.** Engines composite in 8 bits, and the engine blends in
  floats then rounds, hence the 2/255 tolerance.

## Found on the way

- **Nested inline backgrounds.** An outer inline element's background
  is not painted under an inner inline element's characters:
  - each entry reads its own element's computed background
    (tree.ts:651)
  - a character belongs to its innermost entry (`collectOwned`,
    tree.ts:596-607)
  - the paint uses that entry's alone (plain-text.ts:880-884)

  So `<span class="bg-yellow-200">a <b>b</b></span>` shows no yellow
  under "b". CSS paints the outer's background across its whole inline
  box. Step 5's fold paints each ancestor's background beneath, which
  fixes it, with a test seen failing first. It is a behavior change
  beyond opacity, called out here for review.

- **A translucent host background makes `--mw-bg` translucent**
  (element.ts:2233 stops at alpha > 0), so the focus invert's text is
  translucent. Step 2's derivation fixes it.

## Found while implementing

- **A padded inline element's padding reaches its inline children's
  light boxes.** `--mw-ipl`/`--mw-ipr` are custom properties, so a
  span inside `<span class="px-2">` inherits them and takes the
  padding too (verified in Chromium: both spans compute the outer's
  `--mw-ipl` and its padding), so the light line runs wider than the
  grid's, and every light box after it on the line sits off its
  cells. The blend fixture avoids the shape. **Fixed** 2026-09-23 (see
  "Follow-ups").

## Line delta (estimate)

- **Removed**, about −80 core source lines:
  - the `opacity`/`faded` fields and their six readers
  - `mergePaint`
  - `alphaPaint` and its call sites
  - `glyphFade` and `fadedPaint`
  - the tint's fade
  - the old predicate's comment
- **Added**, about +150 to +200:
  - the store's `blend` and cell state, +50
  - groups over the shared recorder, +35
  - the inline fold, +20
  - the ground, ink and probe, +30
  - the layer box's opacity, +8
  - emoji coverage, +12
  - color.ts premultiplied helpers and a `color(srgb …)` writer, +15
- **Net** core source: about +60 to +120. Tests: +150 to +250 (the
  blend spec and its fixture about +160, unit rewrites the rest). The
  per-paint model would be about −30 net, at the cost Decisions 2
  describes.
- **Measured** (2026-09-23): core source +370 — plain-text.ts +263
  (the palette, the store's blend and its fast path, groups on the
  shared recorder, the inline fold, emoji coverage), element.ts +61
  (the probe, the derived ground, `readColor`), paint.ts +18, width.ts
  +11, tree.ts +9, color.ts +6, types.ts +2. Unit tests +408, the blend
  fixture and spec +162. Over the estimate by the palette and the
  perf work (neither estimated) and the probe's refresh.
- **Trimmed** (2026-09-23, "Follow-ups"): plain-text.ts −101
  (1523 → 1422), paint.ts −5, width.ts −1, so the model stands at core
  src +263 against the tree before it (plain-text.ts +162, element.ts
  +61, paint.ts +13, width.ts +10, tree.ts +9, color.ts +6, types.ts
  +2), the clip decision's +5 in color.ts aside.

## Open questions

1. **Group-faithful blending, at about +60 to +120 lines rather than
   chunk 8's −30 to −45?** Decided 2026-09-23: group-faithful, on
   the condition that it costs no performance. Step 9 must show the
   bench pages unchanged and the `faded` shape no slower than today.
2. **A transparent host over a page image.** Should a blend that
   reaches the ground use the resolved `--mw-bg` (authors name it when
   the derivation can't see it)? The alternative: keep alpha where a
   cell's stack reaches the ground, and let the browser blend. That is
   exact for a lone translucent layer over the page, but the main grid
   then keeps translucent colors and the line-glyph box, and a group's
   fill-and-glyph cell still needs a ground color. Decided
   2026-09-23: the resolved `--mw-bg`. **Amended 2026-09-25:** the
   alternative, the ground keeping only the fill-and-glyph cell
   (Follow-ups, "From the `color-mix()` prototype"), then none: the
   fill-and-glyph cell carries the group's opacity on its span
   (Follow-ups, "A group over nothing on its span").
3. **Unclamped or clipped blends?** First decided unclamped, written
   as `color(srgb …)` past sRGB. Decided 2026-09-23: clip when
   blending, the user's call after step 0's probes — every engine
   clips a color to sRGB before compositing it, so an unclamped blend
   lands far off the browser on an sRGB screen (`bg-yellow-400/50`
   over white: blue 93 against 127). `compositeColors` clips each
   color per channel where it blends (an opaque color, or one over
   transparent, passes as it is), and `color(srgb …)` stays the
   writer for what no blend touches: a gradient's stops mix
   unclipped, as CSS interpolates. Its `lab()`/`lch()`/`display-p3`
   parsing stays in Order item 5.
