# `<mono-ascii>` initiative

Status: **implemented 2026-09-01** (all phases). Beyond the earlier
core note, the full clearly-licensed library shipped (44 fonts:
figlet-dist BSD + toilet-dist WTFPL; community collections stay BYO),
plus the CDN bundle with `monowind.ascii.loadFont` (same-origin
`fonts/` first, jsdelivr fallback, in-flight dedupe) and CDN
AUTO-loading of unknown `font` names — in the playground, which ships
the fonts directory, `font="slant"` just works. The package has a
consumer README (setup per integration + the font list).
Post-plan default: `width: max-content` (replaced-element-like), so
`mx-auto` centers. First npm publish of the NEW package cannot use
trusted publishing — needs a manual publish or a token once.

## Motivation

Banner text is the most TUI thing there is, and the engine can't do it
today (one glyph per cell, one font size). A `<mono-ascii>` element
renders its text as FIGlet-style ascii art on the grid — and
inaugurates the `mono-` component family the architecture doc
anticipates (core-architecture.md D4).

```html
<mono-ascii font="standard" class="text-emerald-400">monowind</mono-ascii>
```

## API

- Children: text only. The element renders its `textContent`,
  NORMALIZED: trimmed, interior whitespace collapsed to single
  spaces, newlines treated as spaces (MVP is a one-line banner;
  multi-line/wrapping is a later opt-in). Element children warn once
  and are ignored — their text still contributes via textContent, so
  used content never silently disappears.
- Font selection is DUAL: the `font` ATTRIBUTE names a REGISTERED
  font, normalized (lowercase, no extension) — for HTML/CDN authors;
  the `font` PROPERTY accepts a font object directly
  (`el.font = slant` with `import slant from
"@monowind/ascii/fonts/slant"`) — typo-proof, tree-shakeable, no
  registry, and what framework wrappers bind to. Property wins over
  attribute. Missing/unknown font warns and falls back to the plain
  text — same content-never-disappears principle.
- No size knob — none exists in the formats: character HEIGHT is
  fixed per font (the header's `height`; TOIlet's mono9/mono12 are
  one face at different sizes) and WIDTH varies per glyph. Bigger art
  = taller font; banners still scale visually with the host's
  `font-size` (cell px). Integer block-upscaling is a non-goal.
  Characters the font lacks render as a blank cell of the font's
  height (warn once per font+char); registry re-registration under an
  existing name last-wins with a warning.
- Styling via ordinary utilities on the element: color, opacity,
  margins, alignment all work because the art is normal grid content.
  The synthesized pointer states and transitions apply for free.
- No wrapping (banner semantics — `nowrap`); overflow follows the
  normal cell-model rules. Layout smushing/kerning follows the font
  header's own default layout mode (MVP; author-facing overrides
  later if wanted).
- Sizing/centering: intrinsic width = longest art line, height =
  line count, and the companion styles it as a REPLACED-like block
  (`display: block; width: max-content` — custom elements default to
  inline): shrink-wrapped to the art, so `mx-auto` centers it,
  `w-full` stretches it, and flex placement behaves like any
  content-sized box. `text-align` on the element moves the art as
  ONE RECTANGLE — per-line centering would shear multi-line art
  (deviation from normal text alignment, by design).

## Font formats: FLF and TLF, one parser

FIGlet `.flf` (`flf2a` magic) and TOIlet `.tlf` (`tlf2a`) are sibling
formats: same header line (hardblank, height, baseline, layout mode),
comment block, glyphs for ASCII 32–126, then code-tagged extras. The
parser accepts both magics; differences to handle:

- TLF glyph art may be UTF-8 (fine — the grid is unicode).
- COLOR IS IN SCOPE, in its two real forms (TOIlet's rainbow/metal
  looks are render-time FILTERS, not font data; colored TLF/ANSI-art
  fonts separately embed SGR escapes in the glyph art itself):
  1. Embedded SGR escape sequences in glyph data parse into per-cell
     PAINT (foreground, background, bold — SGR carries all three; the
     grid already paints per-cell spans, so the leaf emits paint
     runs). The 16-color ANSI palette maps to theme-aware tokens (a
     font's "red" follows the theme and dark mode); true-color
     escapes pass through literally.
  2. TOIlet-style filters as an `effect` attribute (`rainbow`,
     `metal`, …), implemented as per-cell color mapping defined
     against theme tokens — themeable by construction instead of
     hardcoded RGB.
     Cells without font/effect color keep the ELEMENT's `currentColor`,
     so utilities on `<mono-ascii>` style plain fonts as usual and
     coexist with colored ones. The ANSI-16 tokens do not exist yet:
     the package defines `--mw-ansi-*` (16 properties) with sensible
     defaults in its own small companion stylesheet; the future themes
     initiative overrides them — this plan must not block on it.
- Horizontal smushing: implement the controlled-smushing rule set from
  the header (universal + rules 1–6); vertical smushing is out of
  scope for the MVP (fonts render at full height).

Parser and renderer are pure functions (string + font → lines) —
fully unit-testable against known `figlet`/`toilet` CLI output
fixtures for both formats.

## Font delivery

Sizing reality (measured 2026-09-01): the curated xero/figlet-fonts
collection is 400 fonts / 4.3MB raw (~11KB average, 94KB max); the
full contributed corpus pushes toward 5–8MB. "All the fonts" cannot
live in the core tarball.

- Fonts are ES modules exporting the raw font string — explicit
  imports, tree-shaken, nothing bundled by default.
- `registerAsciiFont(name, data)` (also what the font modules call on
  import); the `font` attribute resolves against the registry.
- Everything lives in `@monowind/ascii` (see Packaging): a couple of
  fonts are registered by the package entry itself so the element
  works immediately after install; the rest are imported per font.
- CDN/playground: the package ships its own classic-script bundle
  (defaults baked in) loadable next to core's `cdn.js`; its exports
  merge into `globalThis.monowind` under `monowind.ascii` (the
  `sort.js` global-merge precedent). `monowind.ascii.loadFont(name)`
  lazily fetches a font by name from the published package via
  jsdelivr, registers it, and relayouts — at ~11KB/font the
  playground can offer the whole ~400-font catalog unbundled (a
  toolbar font picker is the natural play-side addition; each swap is
  a normal relayout).
- Licensing: the collections are mixed/unclear (many contributed
  fonts state no license — legally "all rights reserved" no matter
  how freely they've circulated). Audit before redistribution —
  reading each font's comment header, where authors often state
  terms: include the clearly-licensed set (TOIlet's WTFPL fonts, the
  BSD-distributed figlet standards, anything with stated permissive
  terms) with per-font attribution files under `fonts/LICENSES/`.
  Code stays MIT; fonts keep their own licenses — standard practice
  for font-shipping packages, no MIT contamination.
- Gray-zone fonts get NO redistribution path from us at all —
  `loadFont` fetching from our published package via jsdelivr is
  still us redistributing. Their path is bring-your-own-file:
  `registerAsciiFont(name, data)` with data the user sourced
  themselves (already the public registration API above).
- Default font: `standard` — figlet's own universal default, the
  iconic look, clearly licensed. The package entry registers it plus
  a small spread (e.g. `small`, and a TLF representative like
  `mono9`); `<mono-ascii>` with no `font` attribute uses `standard`.

## Packaging

One self-contained package, `@monowind/ascii`: the component, the
renderer, and the font library (per-font modules), with its own
release cadence, licensing files, and CDN bundle. Core ships NO ascii
code or data — instead it gains the small PUBLIC API the component
needs (below). Rationale: anyone using ascii art wants font choice,
so a core-resident component would drag this package in anyway; and
the public API is the investment the whole `mono-` component family
(architecture doc D4: `<mono-textarea>`, `<mono-scroll>`, the planned
React layer) needs — designed here against its first real consumer.

## Core: public leaf-renderer API

Specced in specs/leaf-renderers.md (seeded: locked contract + OPEN
design questions; it becomes the source of truth once implemented).
The one hook `@monowind/ascii` needs from the engine, generalizing
what the tree builder already special-cases for form controls: a
custom element registers as a GRID LEAF and supplies its own cell
content instead of laid-out children —

- register(tagName, renderer) where renderer(el) returns the leaf's
  grid content: text lines (intrinsic width = longest line, height =
  line count) plus optional per-cell color runs. Colors are CSS
  <color> STRINGS, vars welcome (`var(--mw-ansi-red)`), resolved at
  paint time against the host — themes restyle existing art with no
  re-render, which is the theme-proofing contract.
- Scope discipline: this API is about leaf CONTENT only. Themes'
  border-glyph customization is a different extension axis (paint-
  level glyph tables) and gets its own hook later — but all
  registries (fonts here, leaves, future glyph sets) share one idiom:
  name → asset, normalized names, last-wins + warn, post-hoc
  registration relayouts connected hosts.
- The engine treats matching elements as leaves: skips their children
  in the tree walk, sizes the box from the returned content, paints
  it into the grid; the LIGHT DOM stays untouched (a11y + select
  semantics below).
- Re-render triggers: the host's existing observers cover attribute
  and text changes; registration after first layout relayouts
  connected hosts (head-watcher precedent).
- Leaves DECLARE their observed attributes at registration (the
  host's MutationObserver filter is extended from the registry —
  `font` won't trigger relayouts otherwise).
- Renderers are DOM-read-only pure functions of the element, and must
  run in the Node/happy-dom path too: `renderPlainText` /
  `toPlainText` traverse the same tree, so banner hosts stay
  golden-testable and SSR-safe.
- Exact shape (sync vs returns-cached, invalidation API) is the first
  design task of the milestone; keep the surface minimal — it must
  not expose layout internals.

## Engine integration

The element registers through the public leaf API (above): the
engine renders the ART into the grid — intrinsic width = longest art line, height = art line count —
while the light DOM keeps the ORIGINAL text node untouched. That
split does the right thing everywhere:

- Screen readers read "monowind", never glyph soup (the grid is
  aria-hidden as always; the light text stays in the a11y tree).
- `select="text"` copies the semantic string; `select="grid"` copies
  the art. Known UX oddity to document: in text mode the highlight
  geometry is the invisible one-line string inside the larger art
  box — correct semantics, odd pixels; acceptable for MVP.
- Text mutations relayout via the existing host MutationObserver
  (characterData is already observed); a `font` attribute change
  needs observing by the host (extend the attribute filter or let the
  element dispatch its own relayout).
- Registered-after-first-layout fonts: registration triggers a
  relayout of connected hosts (head-watcher precedent).

Open question for implementation: whether `<mono-ascii>` must live
inside a `<mono-wind>` (leaf-only, MVP answer: yes, warn otherwise)
or can stand alone wrapping its own mini-grid later.

## Testing

- Parser/renderer unit tests: FLF and TLF fixtures, output diffed
  against real figlet/toilet CLI output; smushing rules table-tested;
  SGR color parsing (16-color mapping + true-color passthrough) and
  `effect` filters against known cell/color expectations.
- Stories: a showcase (fonts, colors, hover/transition on art) and a
  `!dev` behavior story (fallbacks: unknown font, non-text children;
  a11y: light text intact; text mutation relayout).
- Visual goldens: rest state of the showcase.
- Play smoke: the package's CDN bundle registers the element and a
  default font next to core's `cdn.js`.

## Usage sketches (per consumption path)

Bundler (Vite plugin) — property API preferred: the import ties usage
to the font module (deleting it is a build/type error, not a silent
runtime fallback to plain text), the property is typed so typos die
at compile time, and the registry is bypassed entirely (no name
collisions). It's also what framework bindings naturally set — hence
the property-wins precedence.

```ts
import "monowind";
import "@monowind/ascii";
import slant from "@monowind/ascii/fonts/slant";
document.querySelector("mono-ascii").font = slant;
```

The attribute path works in bundlers too and is the more HTML-first
DX (one side-effect import, everything else in markup):
`import "@monowind/ascii/fonts/slant"` + `<mono-ascii font="slant">`.

CDN (static HTML) — attribute API + lazy loading:

```html
<script src=".../monowind/dist/cdn.js"></script>
<script src=".../@monowind/ascii/dist/cdn.js"></script>
<script>
  monowind.ascii.loadFont("banner3-d");
</script>
<mono-wind>
  <mono-ascii font="banner3-d" effect="rainbow">HELLO</mono-ascii>
</mono-wind>
```

Playground — nothing to wire: play loads both CDN bundles and
lazy-fetches catalog fonts on first use; users just type
`<mono-ascii font="smmono9">play</mono-ascii>`.

## Release process

`release.yml` currently publishes exactly two packages — add
`@monowind/ascii` to the publish matrix, wire it into the playground's
CDN copy step, and decide versioning: lockstep with core (simplest;
matches `@monowind/vite`) vs independent. Default: lockstep, patch
bumps only below 1.0, same as everything else.

## Docs

- cell-model.md (or a new components spec file) section; README
  feature mention with the one-liner example; the playground default
  sample gets a banner (it sells the whole engine in one line).
