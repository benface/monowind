# Performance levers

Status: **researched 2026-09-23**, prototypes measured; levers 1–3
landed 2026-09-23; lever 4 specified and planned 2026-09-24, not
implemented; levers 5 and 6 not started.
Prototypes are patched copies of the working tree (Chromium 153
headless, builds interleaved round-robin with a noise control); they
render identically to the base, hovers and typing included. The work
so far tuned how fast a relayout runs, not how much each one does:
every hover, keystroke or attribute change re-reads and restyles every
light element about three times, even when one paragraph changed.

## Where the time goes (per relayout, ms, 2026-09-23, before levers 1–3)

|                                    | prose 300         | boxes 300       | blocks 40       |
| ---------------------------------- | ----------------- | --------------- | --------------- |
| main-thread CPU                    | 87.6              | 37.8            | 5.5             |
| style recalc: unlock/settle/relock | 11.4 / 17.7 / 9.6 | 3.8 / 4.0 / 2.1 | 0.3 / 0.2 / 0.1 |
| engine reads + tree build          | 23.6              | 12.2            | 0.7             |
| engine layout math                 | 1.5               | 0.7             | 0.2             |
| engine render (var writes)         | 1.8               | 1.1             | 0.0             |
| engine grid paint                  | 12.3              | 4.9             | 1.4             |

- Style recalc leads on prose; the settle and relock rounds each
  restyle 4,811 elements for 2,403 light ones — the extra half is each
  element's `::selection`, which the transparent selection lock makes
  Chromium compute.
- Reads come next: mostly Chromium serializing computed values (~100
  property reads per box).
- The grid paint rebuilds the whole cell store every time (3.8 ms of
  prose's 12.3 is allocating three 2D arrays).
- A page load ran two full layouts (prose: 145 then 78 ms); lever 1
  made it one.

## Levers, ranked

1. **One load layout** — interactive prose 303 → 223 ms, boxes 222
   to 184 ms. Three triggers each force the second:
   `document.fonts.ready`, already resolved, runs its deferred relayout
   unconditionally; the glyph cache's `invalidate()` bumps its
   generation with nothing cached; the ResizeObserver fires on the host
   height the engine just wrote. Skip a relayout when the cell metrics
   and glyph drawings are unchanged, and ignore resizes the engine
   caused. Small; watch
   top-layer placement when content above the host changes height.
   **Done 2026-09-23** (performance.md "One load layout"): one layout
   per load in all three engines; `pnpm bench` interactive prose
   316.5 → 234 ms, boxes 251 → 206.5, blocks (300) 310.5 → 256.5
   (medians of four alternated rounds); CPU through ready + 1 s prose
   328 → 244, boxes 248 → 199. A resize lays out again where the layout
   reads it — the host at a size other than the one its layout wrote,
   a box around it at another width, the probe at another cell — and a
   box around the host that changes height re-syncs the top layer's
   origin only. The second layout had hidden a dependency: a
   textarea's rows wrap at the width the layout before gave it, so a
   host holding one lays out again at the width it gets (WebKit's
   `Wide` story caught it). It had also hidden a race in the stories'
   `readyHosts` (2026-09-24): in WebKit the font a first layout
   requests swaps in with no font event, the probe's resize reported
   the frame it renders and the layout it schedules running in the
   next frame's callbacks, after the helper's own — so a cell steady
   over two frames was still the fallback's, and the first play of
   `qr.stories.ts` (every run) and of `Wide` (under the whole suite)
   checked a grid laid out in it. The helper now also waits for each
   probe to measure the laid-out cell; `LateFont` (host.stories.ts)
   loads a face once the host has settled, red in WebKit without that
   wait — on v0.3.2 too, whose QR and `Wide` plays passed by timing:
   its unconditional second layout landed after the font had loaded.
2. **Settle only what transitions** — relayout prose 86.0 → 72.6 ms,
   boxes 37.4 → 32.7; load prose 306 → 279. Only elements with a
   non-zero transition duration or delay need the settling round and
   its forced flush (performance.md calls the flag rounds "not
   removable"; one is). Small; check the host's own transitions.
   **Done 2026-09-23** (performance.md "Settling only what
   transitions"): per relayout prose CPU 84.1 → 68.8 ms (style 36.7 →
   23.4), boxes 35.1 → 32.3 (9.0 → 6.1); a prose hover 93.4 → 78.4;
   `pnpm bench` interactive prose 228 → 202.5, boxes 190.5 → 177,
   blocks (300) 248.5 → 238.5. Every flag drops before the flush, so a
   settling element snaps against its parent's final locks (the
   prototype dropped the others after it); the transitions are read
   in one pass after the build (1.1 ms on prose), the build reading
   none for most of the elements.
3. **Two style rules that defeat Chromium's cache** — −9.6 ms per
   prose relayout together (style −24%). `anchor-scope: all` on every
   measured element stops Chromium caching any unlocked style (4 cache
   hits instead of 2,407): scope it to elements that carry an anchor
   name (an engine-written flag). The `::selection` lock costs 5.6 ms:
   gate it on a live light-DOM selection, designing out a frame of
   native highlight when a selection starts.
   **Done 2026-09-23** (performance.md "Two style rules Chromium could
   not cache"): per relayout prose CPU 68.7 → 64.6 ms with the anchors
   scoped, 61.7 with both (style 23.2 → 19.8 → 17.3), boxes 30.5 →
   29.0 → 28.2; a prose hover 75.7 → 69.1; `pnpm bench` interactive
   prose 197.5 → 184, boxes 175 → 173.5, blocks (300) 238.5 → 227.5.
   The anchors' flag is `data-mw-anchor`; an anchor named since the
   last layout has the tree read again where a box is anchored by name
   (without it every engine placed by its own fallback in the layout
   that first read the anchor). The selection flag is the host's
   `data-mw-selection`, set at `selectstart` and before the engine's
   own ranges; a script's first selection, or a key carrying one in,
   can still show the native highlight for a frame (wide-characters.md,
   Deviations), since `selectionchange` is a task a frame can precede
   in all three engines — a text-mode drag begun outside the host no
   longer can, per the 2026-09-24 paragraph below.
   **Probed 2026-09-24** (a hold on `selectionchange` keeping the
   frame before it on screen, pixels against a baseline, real input
   through Playwright): Chromium and WebKit inherit the slot's
   transparent highlight, so only an authored `selection:` color shows
   there; Firefox inherits none and shows its default. A drag pressed
   outside now sets the flag at its first move over a text-mode host
   (`#onPointerMove`), which the frame before the drag's
   `selectionchange` showed in Chromium and Firefox; a script's
   selection and a key carrying one in stay (no event precedes them),
   the deviation now stating which engines show what. No rule changed.
4. **Incremental reads** — the dramatic lever: prose hover 97.8 → 30.1
   ms (style 40.3 → 5.6), typing 98.4 → 28.9, boxes hover 56.7 → 37.2.
   Unlock and re-read only the dirty nodes and their ancestor chains
   (the ancestors must unlock too, or the node inherits their locked
   `pointer-events`), splice the fresh nodes into the cached tree, and
   lay out, render and paint as today. Large; a spec and plan first.
   **Specified 2026-09-24**, superseding the research's design (a dirty
   set derived from the stylesheets, full reads on `:has()`): the spec
   reads no stylesheet — a change reads its wider unit, and a selector
   past it is a documented limit (the plan's Decisions 1). Spec:
   `../specs/incremental-reads.md`; plan:
   `2026-09-24-incremental-reads.md`.
5. **Incremental paint** (estimated) — paint dirty rows only, a
   typed-array cell store, no paint when nothing changed: −10 to −12 ms
   per unchanged prose relayout, a hover ~15 ms. Medium; pairs with 4.
6. **A canvas grid** (measured, later maybe) — boxes draw in 24 ms (8
   for the viewport) against 49 ms of DOM plus the ~95 ms raster
   performance.md records; prose even. Costs native grid selection and
   copy (a transparent text layer would stay), print quality, redraws
   on zoom and DPR changes, tall-page tiling, a canvas per layer.

1–3 together took prose load from 303 to 198 ms interactive (CPU
through ready + 1 s: 319 → 191). Landed, they took it from 300 to 183
(CPU 316 → 176), boxes 221 → 170 (233 → 176).

## Leads

- **Shared block boxes on macOS** — **closed** 2026-09-23, not
  reproduced (below). In the TilingGlyphs story, macOS
  Chromium leaves 14 pairs of identical neighboring uniform blocks in
  separate `data-box="center"` spans — boxes painted with no measured
  fit — where Linux Chromium shares one box per run (109 of 135 block
  spans are shared runs on Linux, 31 on macOS). Likely the fit measured
  before the font loaded; worth tracing with lever 1's font work. The
  output looks the same, at more spans.
  Traced with lever 1 (2026-09-23): not reproduced on macOS. Under
  Vitest in Chromium, Firefox and WebKit, and in a standalone page
  before and after lever 1, the tall-rows host paints 135 block spans
  — 31 shared runs, 104 single boxes (QR modules between blanks or
  other glyphs, and the halves, quadrants and shades, which never
  share) — with no `data-box="center"` span and no two identical
  uniform blocks side by side in separate spans. Nor can a fit taken
  before a font loads split a run: a range's fit is one cached object
  per font string (`#fits`, cached even while loading), which every
  block of a run is compared by, and `center` needs `glyphs.box()`
  null for a cluster `boxed` boxed, which only a translucent line
  glyph without a fit gets. Linux's count stays untraced (it needs the
  visual suite's container).

## Measured, and not worth doing

- **Non-inherited `@property` for the per-element vars** — doubles
  Chromium's style recalc (prose 38.7 → 73.8 ms with only x/y/w/h).
  Chromium caches each element's `::selection` style in its matched-
  properties cache under a key that hashes inherited variables but not
  non-inherited ones; each key's bucket only grows and is scanned
  linearly, rejecting entries on a comparison that does include
  non-inherited variables, so elements differing only in non-inherited
  values share one bucket and a full restyle is O(N²). A minimal repro
  (a unique inline registered value per parent, a `::selection` rule)
  goes 1.05 → 44.55 ms from 75 to 600 parents, unregistered linear;
  Firefox and WebKit show nothing. Worth filing with Chromium. The
  existing non-inherited registrations (`--mw-host-w`, the `rule-*`,
  scrollbar and `bg-clear` mirrors) cost nothing measurable — every
  laid-out element's unique inherited inline vars spread the entries —
  and must stay non-inherited for nested containers; lever 3's
  `::selection` gate removes the latent risk.
- The CSS Custom Highlight API for the grid's colors (replaces half of
  prose's spans, none of the weights, italics or boxed glyphs; a row
  recolor costs 13–18 ms against 5 for spans), positions as px from JS
  instead of `calc()` (noise), `content-visibility` on grid rows (the
  engine forces a synchronous layout anyway), a layout worker (reads and
  writes share a frame; 1.5 ms could move), and WebAssembly (only the
  1.5 ms of layout math and the paint's cell store could move — typed
  arrays in JS get most of that — against 100–300 KB of bundle; ~75% of
  the time is Chromium's style work and computed-style reads).

Prototypes, harnesses, the repro and Blink source excerpts:
`scratchpad/dramatic/` of the 2026-09-23 session (not kept in the repo).
