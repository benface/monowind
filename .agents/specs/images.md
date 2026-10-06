# Spec: images

Status: **implemented 2026-10-01**; its decisions taken with the user
the same day ("Decisions"). Sizing builds on
`cell-model.md` "Aspect ratio"; the paint on `layers.md`.

## Why

An `<img>` is the most ordinary HTML there is. Left to the browser,
an inline one takes no cells while its pixels still draw, and a sized
one draws natively inside its cells, smooth photographic pixels in a
page of glyphs. An image belongs on the grid as a terminal draws one: a box of whole
cells, its picture sampled to the cells' resolution and, where the
theme says so, reduced to the theme's own colors — a photo on a DOS
page looks like a DOS photo.

## What the engine reads

- Per `<img>` (a `<picture>`'s too, through its `<img>`, the source
  the browser chose): `currentSrc`, `complete`, `naturalWidth` and
  `naturalHeight`, and its computed `object-fit` and `object-position`.
- Per image, inherited: `--mw-image-palette`, `--mw-image-match`,
  `--mw-image-levels` and `--mw-image-dither` ("Color"), each a
  registered property, so the engine reads its computed value.
- A `load` or `error` event from an image under the host lays the host
  out again, as an attribute change does; `srcset` and `sizes` join the
  attributes that do (`observed.ts`), since they change `currentSrc`.

## Sizing

An `<img>` is a replaced box, as in CSS: an atomic inline box at its
line where its `display` is inline, a block one where block, a flex or
grid item as such. A replaced native region sizes as an image does
(`native-regions.md` "Layout").

- **Its intrinsic size is its natural size, as any px length is
  read**: the natural width on the spacing scale (a cell a quarter
  rem), the height derived from the natural ratio, physical as every
  ratio is (`cell-model.md` "Aspect ratio"), so an unsized image sizes
  exactly as `w-[<natural width>px] aspect-[<natural ratio>]` would.
  The HTML `width` and `height` attributes reach the engine as the
  computed px they map to, on the same scale, so an image with them
  and one without are the same size. An image with no natural ratio
  (an SVG with one dimension) takes each natural size on the scale.
- **Its box resolves as CSS resolves a replaced box's**: both sizes
  auto, the intrinsic size; one set, the other from the ratio; then
  the min and max sizes, Tailwind's preflight `max-width: 100%` and
  `height: auto` among them, so an image wider than its column
  narrows with it. A percentage width or max width makes it give way
  to its container, loaded or not: its min-content contribution is
  zero, then its min width, as a compressible replaced box's
  (css-sizing-3), so a shrink-to-fit container narrows below it.
- **Its baseline is its bottom edge**, a replaced box's: inline on its
  line, the line's text sits on its last row where it aligns to the
  baseline, its middle row where `middle` (Tailwind's preflight), its
  first where `top`.
- **A loading image** whose size the attributes or CSS give takes its
  box at once; one they leave unsized takes none until it loads, and
  one that fails draws its `alt` as inline text, as browsers do.

## The picture

The picture is drawn at **one column by two rows of pixels per cell**
— the half-block resolution of a terminal's image viewers, square
pixels in a 1:2 cell — sampled from the image across the box's
physical size, so the image keeps its shape whatever the font's cell.
Each pixel is the average of the source area it covers, within a few
levels of the exact average in every engine.

- **`object-fit` and `object-position` place it**, as in CSS
  (`object-cover`, `object-contain`, `object-[25%_75%]`), with one
  grid rule: **rounding never distorts a picture.** A box within half
  a cell of the image's ratio is the rounding's shape — the intrinsic
  size, a size the ratio derived — and there `fill`, which would
  stretch the picture by what the rounding added, draws as `cover`,
  cropping at most half a cell on an edge instead; the other fits,
  which never distort, apply as written. A box further off is the
  author's shape — both sizes, an `aspect-ratio` of their own, a min
  or max size clamping it — and `fill` (CSS's default) stretches the
  picture to it, as in CSS (`pictureFit`). An `auto <ratio>`, the
  attributes', gives way to the image's natural one once it loads.
- **The pixels are the picture's alone.** The image's cells hold no
  glyph and no fill of its own (its alt is a copy's alone, "The light
  DOM"); `image-rendering` is not read, the
  grid's pixels being the look.

## Color

By default an image draws in full color. A theme, or any author,
reduces it:

- **`--mw-image-palette`**: the colors the image may use, a
  space-separated list in any color syntax (registered as
  `<color>+ | none`, so the browser computes each one, a `var()`
  included). Each theme with a system palette sets it to that palette
  (DOS, DOS blue and BBS the VGA sixteen, C64 Pepto's sixteen, green
  phosphor and amber their ramps, teletype its paper tones), generated
  with the theme's `--color-*` map. `image-palette-none` sets it back
  to `none`, full color.
- **`--mw-image-match`**: how a pixel finds its palette color —
  `color`, the nearest in OKLab, as the themes' token maps are (the
  default); or `lightness`, by OKLab lightness alone, as a monochrome
  theme's tokens are mapped (green phosphor, amber and teletype set
  it), so a picture keeps its light and shade in the phosphor's own
  hue.
- **`--mw-image-levels`**: posterized, each channel reduced to so many
  even levels (`image-posterize-<n>`, 2 or more, and
  `image-posterize-[n]`). With a palette as well, the levels apply
  first.
- **`--mw-image-dither`**: how a reduced image hides its steps —
  `ordered` (a 4×4 Bayer matrix offsetting by a whole step between
  neighboring colors — a level, a lightness ramp's average gap, or a
  palette's average channel step from each color to its nearest: the
  classic look, and stable, so a picture repainted at the same size
  never shimmers; the default where the image is reduced),
  `diffusion` (Floyd–Steinberg: smoother gradients, a noisier
  texture), or `none` (each pixel the nearest color). Utilities
  `image-dither-ordered`, `image-dither-diffusion`,
  `image-dither-none`.

## Paint

**An image's picture paints as a layer does** (`layers.md`): a surface
of its own — a canvas over its content box, its pixels scaled up
unsmoothed — whose box opens where CSS paints a replaced element's
content (CSS 2.1 Appendix E): after every block's ink, among the
inline content, in tree order; the image's own fill and border are the
grid's cells, in the block phase, as any box's. It forms no stacking
context, as an image doesn't in CSS. So the ancestors' fills and
borders lie beneath the picture, later ink over its cells covers them
whole (`layers.md` "Later ink covers a layer", the cells cleared in
the canvas), an ancestor's clip clips it, and an image inside a layer
root sits in that layer's box, transformed and filtered with it — an
image that is itself a layer root in its own. Its `opacity` is its
box's, as its cells' is; a hidden image (`visibility`) draws none.

- **The place snaps to whole pixels**: the picture's edges in its box
  round to the nearest pixel, so no pixel is covered in part — at the
  grid's resolution a part-covered pixel is a stray translucent band
  along a contained picture's edge.
- **A cross-origin image** whose server shares it over CORS is read from
  its bytes, which the engine fetches itself, so it needs no
  `crossorigin` on the `<img>` (without which the page may not read the
  element's own pixels), and read again where its box asks another scale
  than the one it was read at. One its server doesn't share can be drawn
  but not read — the engine's fetch fails, which the browser logs as a
  CORS error: it draws in full color, its palette, levels and dither
  left out, the pixels still the grid's resolution — the look an image
  has on a page with no theme, and on a themed one with
  `image-palette-none`.
- **An animated image animates** where the browser decodes its frames
  for the engine (`ImageDecoder`, each engine probed) and the page may
  read it (same-origin, or shared over CORS):
  each frame drawn at its own time — one of 10 ms or less held for
  100 ms, as browsers do — through a still one's palette, levels and
  dither, as many times as its loop count says, while its picture is
  on screen — off screen, or under a hidden host, it holds its frame.
  Elsewhere, and under `prefers-reduced-motion`, it draws its first
  frame, and starts when the preference lifts. Its frames stop when its
  box leaves the layout or its host the document, and start again when
  it is back. A still image's bytes are read only as far as the header
  that says so.
- **A selection shows as reverse video**, as selected text does: the
  picture's colors inverted in its selected cells, its bare pixels
  left bare — the whole picture where a light-DOM selection reaches
  the `<img>` (an atomic box), the cells a grid selection spans in
  the grid holding them, from its start or the grid's to its end or
  past the grid's, as a select-all's runs across the viewport's grids
  (`wide-characters.md` "The grid paints the selection";
  `semantic-selection.md` "An image is one unit"). The picture's layer
  holds no text, its grid left empty, so a drag over the picture
  selects the grid's text beneath it.
- **Repaint** happens when the picture's inputs change: its source,
  its box in cells, the cell size, `object-fit` or `object-position`,
  or its color settings. A layout that changes none of them reuses the
  surface, and a new source keeps the picture shown until it loads, as
  browsers keep the image.

## The light DOM

The `<img>` keeps its place and its size — the box's cells, as every
laid-out element's — and its native pixels are locked out
(`content` set to a transparent pixel, under the measuring flag like
every lock, which leaves its opacity, its `naturalWidth` and what
`drawImage` reads the source's), so it stays
the element the pointer, the accessibility tree (its `alt`) and a
link around it answer through; the picture's canvas is hidden from the
accessibility tree, as the grid is. In text mode a copy reads its
alt, white space collapsed, in the flow as any box's text, where
`innerText` gives nothing. In grid mode a copy reads its content
box's cells with its alt written in them — white space collapsed,
wrapped at its words from the first row, cut at the last cell, padded
with blanks to its width, an inline image's on the row its line's text
sits on — as far as its clip shows them, where the grid draws none:
the engine copies a grid selection over a picture, and an element
selection's image, from the same render, so every grid copy agrees
and the text beside stays aligned. An element selection's copy takes
the content box alone, as its highlight does, its border left out. A
hidden image copies nothing.

## Decisions (2026-10-01, with the user)

1. **Native `<img>` and `<picture>`, in core**: ordinary HTML is the
   point; a `<mono-image>` element is not needed.
2. **A pixel surface, not glyphs**: one canvas per image at the
   half-block resolution, rather than a `▀` per cell with its own two
   colors — the same look, one element where a glyph per cell would be
   thousands of spans, and it prints.
3. **The natural size on the spacing scale**, as every px length:
   an image is as wide as `w-[<natural width>px]`, its height from
   its ratio, so its `width` and `height` attributes never change its
   size — chosen over the natural size in physical cells, which the
   attributes, read on the scale, would have contradicted.
4. **CSS's `object-fit`, and rounding covers**: the user's concern that
   `fill` would stretch every unsized image by its rounding is met by
   the rounding rule, which crops at most half a cell instead, while a
   box the author sizes follows `object-fit` as CSS does.
5. **Themes change what images look like**: their system palettes
   reach images through `--mw-image-palette`, with ordered dithering;
   posterizing is a level count beside it.

## Deviations from CSS

1. An animated image draws its first frame where its frames can't be
   decoded (an engine without `ImageDecoder`, or an image the page may
   not read), and under `prefers-reduced-motion`, which a native one
   ignores.
2. An unsized SVG image with a ratio but no natural size (a `viewBox`
   alone) takes the default width its engine reports — 150 px in
   Chromium and WebKit, 300 in Firefox, its ratio kept — where CSS
   fills its line; one with a set size follows its ratio, as CSS does.

## Later

- `background-image: url()` (`gradients.md` deviation 3) through the
  same pipeline, with `background-size`, `background-position` and
  `background-repeat`.
- Inline `<svg>`, `<video>` frames and `<canvas>` as pictures; meanwhile
  `mw-native` makes one a native region (`native-regions.md`), drawn by
  the browser in the cells the grid gives it.

## Testing

- Node: the intrinsic size — the natural width on the spacing scale,
  the height from the ratio — in a 1:2 cell; each sizing case (auto,
  one size, both, `max-w-full` narrowing it, `auto <ratio>`, a
  percentage's min-content); the rounding rule choosing
  cover, and `object-fit` applying where the author shaped the box; the
  sampling of a known bitmap to the pixel grid; each color reduction —
  a palette's nearest colors, levels, each dither — on a known bitmap;
  the attributes and events that lay out again.
- Storybook, in every engine: an image inline in a sentence, the same
  size with the `width` and `height` attributes, `object-cover` and
  `object-contain` in a set box, a caption positioned over an image
  (later ink covering its cells), an image in a scroller (clipped), an
  image in a rotated layer, the same image under the DOS and
  green-phosphor themes and posterized, a cross-origin image its server
  shares and one it doesn't (the stories' servers share a file asked for
  `?shared`), a broken one's `alt`, and one read from its bytes read
  again as its box grows past its scale; a selection's inversion on the
  grid and in text, through a paint rebuilding its rows and across the
  viewport's grids; clicks — a row, the image whole, a clipped row, a
  broken image, Shift on a row; copies in both modes, of a grid
  selection and of a selection reaching in from the page across two
  hosts; a selection the host never hears of painted away; an animated
  image's frames into a second pass, stopping when it is removed, hidden
  or its host leaves the document and running again once it is back, and
  its first frame alone under `prefers-reduced-motion` (the preference
  stood in for, as no page sets it) — not Node's, which has neither
  `ImageDecoder` nor a 2D context.
- Visual: goldens of each story's image, in the pinned Linux image as
  every golden is.

## Touch points on implementation

- packages/core/src/types.ts: an image's record on its node
  (`ImageSource`).
- packages/core/src/tree.ts: the `<img>` as a replaced box
  (`buildImageLeaf`) — its intrinsic size and ratio, its baseline, a
  broken one's `alt` — and an inline one as an atomic inline box.
- packages/core/src/metrics.ts: a px length in cells on the spacing
  scale (`pxInCells`), the natural size's.
- packages/core/src/style.ts: its vertical alignment
  (`readVerticalAlign`).
- packages/core/src/layout.ts: a percentage-sized image's min-content
  contribution of zero (`widthContribution`).
- packages/core/src/image.ts: the picture's fit (`pictureFit`) and
  place (`object-fit`, `object-position`, snapped to the pixel grid),
  the sampling, the color settings and their reduction, its content
  box (`contentCells`), and the alt in its cells (`altText`,
  `cellLines`, `altArea`).
- packages/core/src/color.ts: sRGB to OKLab, for the palette match.
- packages/core/src/stacking.ts: the picture's step in the paint walk.
- packages/core/src/plain-text.ts: that step opening the image's
  surface (`PaintedLayer.surface`), a layer of no cells which later ink
  covers, and writing its alt in its cells for a copy's render alone
  (`copyGrids`, `textRows` as its clip shows them, `screenRows`).
- packages/core/src/paint.ts: the picture's canvas over the content box,
  keyed apart from its image's own layer (`pictureKey`), its cache, its
  covered cells cleared, a tainted image drawn unreduced (its canvas
  replaced once readable pixels come), a grid selection over a picture
  copied from a copy's render (`gridCopy`), and the frames decoded from
  its bytes (`Frames`) — an animated image's, and a still one's the page
  may not read from its element, read again as its box asks another
  scale — stopped with its layer or its host (`stopFrames`), and its
  selected cells inverted (`invertCells`, a grid selection's in each
  grid through `selectPictures`).
- packages/core/src/selection.ts: an image a light-DOM range reaches,
  selected whole (`selectedRanges`), its copy, its alt, or in grid mode
  its alt's cells from a copy's render (`surfaceText`), and a range
  reaching into the host clipped to it (`hostPart`), the page's text
  around it (`pageAround`).
- packages/core/src/element.ts: an image's `load` and `error` laying
  the host out again, its frames stopped as the host disconnects, a
  `selectionchange` handing the grid selection to the pictures, and a
  multi-click's unit an image whole, a broken one's too
  (`#leafContents`), a grid-mode double-click its row (`pictureRow`),
  the light DOM's part of a selection painted (`#lightSelection`), and
  a copy's text written by the engine (`#copyText`, `#reachingCopy`,
  `#partText`).
- packages/core/src/observed.ts: `srcset` and `sizes`.
- packages/core/src/styles.css: the `<img>` content lock.
- packages/core/src/shadow.css: the picture's canvas, unsmoothed, and
  the grid unselectable under a semantic selection.
- packages/core/src/utilities.css: the `image-*` utilities and the
  four registered properties.
- packages/themes/scripts/generate-palettes.mjs: each theme's
  `--mw-image-palette` and, for a monochrome one, `--mw-image-match`.
- apps/storybook/stories/images.stories.ts: `Features / Images`, its
  pictures drawn by `stories/assets/generate.mjs`.
