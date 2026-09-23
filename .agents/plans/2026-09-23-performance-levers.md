# Performance levers

Status: **researched 2026-09-23**, prototypes measured, nothing landed.
Prototypes are patched copies of the working tree (Chromium 153
headless, builds interleaved round-robin with a noise control); they
render identically to the base, hovers and typing included. The work
so far tuned how fast a relayout runs, not how much each one does:
every hover, keystroke or attribute change re-reads and restyles every
light element about three times, even when one paragraph changed.

## Where the time goes (per relayout, ms)

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
- A page load runs two full layouts (prose: 145 then 78 ms).

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
2. **Settle only what transitions** — relayout prose 86.0 → 72.6 ms,
   boxes 37.4 → 32.7; load prose 306 → 279. Only elements with a
   non-zero transition duration or delay need the settling round and
   its forced flush (performance.md calls the flag rounds "not
   removable"; one is). Small; check the host's own transitions.
3. **Two style rules that defeat Chromium's cache** — −9.6 ms per
   prose relayout together (style −24%). `anchor-scope: all` on every
   measured element stops Chromium caching any unlocked style (4 cache
   hits instead of 2,407): scope it to elements that carry an anchor
   name (an engine-written flag). The `::selection` lock costs 5.6 ms:
   gate it on a live light-DOM selection, designing out a frame of
   native highlight when a selection starts.
4. **Incremental reads** — the dramatic lever: prose hover 97.8 → 30.1
   ms (style 40.3 → 5.6), typing 98.4 → 28.9, boxes hover 56.7 → 37.2.
   Unlock and re-read only the dirty nodes and their ancestor chains
   (the ancestors must unlock too, or the node inherits their locked
   `pointer-events`), splice the fresh nodes into the cached tree, and
   lay out, render and paint as today. Needs: the dirty set derived from
   what the stylesheets make depend on what (group-/peer-/has- variants,
   `:focus-within`, sibling selectors), node flags carried over when a
   node is replaced, layout safe to re-run on reused nodes, and a full
   read on resize, font or stylesheet changes and `:has()`. Large; a
   spec and plan first.
5. **Incremental paint** (estimated) — paint dirty rows only, a
   typed-array cell store, no paint when nothing changed: −10 to −12 ms
   per unchanged prose relayout, a hover ~15 ms. Medium; pairs with 4.
6. **A canvas grid** (measured, later maybe) — boxes draw in 24 ms (8
   for the viewport) against 49 ms of DOM plus the ~95 ms raster
   performance.md records; prose even. Costs native grid selection and
   copy (a transparent text layer would stay), print quality, redraws
   on zoom and DPR changes, tall-page tiling, a canvas per layer.

1–3 together took prose load from 303 to 198 ms interactive (CPU
through ready + 1 s: 319 → 191).

## Leads

- **Shared block boxes on macOS**: in the TilingGlyphs story, macOS
  Chromium leaves 14 pairs of identical neighboring uniform blocks in
  separate `data-box="center"` spans — boxes painted with no measured
  fit — where Linux Chromium shares one box per run (109 of 135 block
  spans are shared runs on Linux, 31 on macOS). Likely the fit measured
  before the font loaded; worth tracing with lever 1's font work. The
  output looks the same, at more spans.

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
