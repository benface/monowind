# Leaf renderers (public extension API)

Status: **implemented in core** (leaf.ts, tree.ts, element.ts;
2026-09-01) — this file is the source of truth. `<mono-ascii>`
(plans/2026-09-01-mono-ascii.md) is the first consumer.

## Locked contract

- A custom element registers as a GRID LEAF: the engine skips its
  children in the tree walk and the element supplies its own cell
  content — text lines (intrinsic width = longest line, height = line
  count) plus optional PAINT RUNS. Generalizes what the tree builder
  special-cases for form controls today. Only custom-element tag
  names (hyphenated) may register — built-ins are never claimable.
- Paint runs are an extensible subset of what the grid already paints
  per cell — `color`, `backgroundColor`, `fontWeight`, `fontStyle`,
  `textDecorationLine` — every field optional. (Not color-only: SGR
  escapes in ANSI-art fonts carry backgrounds and bold, so the first
  consumer already needs more than foreground color.)
- Registration takes a single OPTIONS OBJECT
  (`registerLeaf({ tag, render, observedAttributes, … })`) — every
  future capability is an added optional field, never a new overload
  or positional parameter.
- Renderers are SYNCHRONOUS — layout runs sync per frame. Asynchrony
  (font loading, fetches) lives outside: load, then invalidate/
  relayout. No promise-returning renderers, ever.
- A throwing renderer must never break layout: the engine guards the
  call, warns once, and the leaf renders nothing that pass (the light
  DOM and the rest of the grid are unaffected).
- The LIGHT DOM stays untouched: the element's real children remain
  in the accessibility tree and in `select="text"` semantics; the
  grid stays `aria-hidden`. A leaf's semantic content is what screen
  readers hear and what text-mode selection copies.
- Colors in runs are CSS `<color>` STRINGS, vars welcome
  (`var(--mw-ansi-red)`), resolved at paint time against the host —
  themes restyle existing content with no re-render.
- Renderers are DOM-read-only pure functions of the element, and must
  run in the Node/happy-dom path: `renderPlainText`/`toPlainText`
  traverse the same tree, so leaf content stays golden-testable and
  SSR-safe. No layout internals are exposed.
- Leaves DECLARE their observed attributes at registration; the
  host's MutationObserver filter extends from the registry.
  `characterData` mutations are already observed.
- Registration idiom, shared by every monowind registry (leaf
  renderers, ascii fonts, future border glyph sets): name → asset,
  normalized names, last-wins with a warning, and post-hoc
  registration relayouts connected hosts.
- Scope discipline: this API covers leaf CONTENT only. Paint-level
  extension (e.g. themes' border-glyph customization) is a separate
  future hook.

## Resolved design (as implemented)

- `registerLeafRenderer({ tag, render, observedAttributes })`;
  renderers are RECOMPUTED each layout pass — caching is the
  renderer's own business. Invalidation for out-of-DOM inputs (a font
  finished loading, …) is `invalidateLeaves()`: relayouts every
  connected host, coalesced per frame by the hosts. (Per-element
  granularity can arrive later, additively.)
- Runs address LINE SPANS: `{ line, start, end }` = cells
  `[start, end)` of `lines[line]`; out-of-range values clamp, overlaps
  last-win per cell. Internally runs ride the leaf's inline-run
  machinery as paint-only entries — no new paint path.
- Content is preformatted BY DEFINITION: the engine forces
  preserve/nowrap semantics on renderer content (`white-space` styling
  does not apply — the lines ARE the contract). Registered tags are
  also always BLOCK participants in the tree walk, so an unstyled
  custom element (computed `inline`) can't fold its semantic text into
  the parent's run; packages should still ship `display: block` for
  sane non-grid fallback rendering.
- Intrinsic size: one cell per code point of the longest line ×
  line count; `line-height`/`tracking` apply like any leaf; authored
  box constraints and overflow follow the normal cell-model rules, no
  special-casing.
- A leaf element outside a `<mono-wind>` host is simply never seen by
  the engine; warning about it is the component package's business.

## OPEN (future, additive)

- The renderer CONTEXT argument (second parameter): future
  wrapping/multi-line leaves need width-dependent output, so content
  may be re-requested at different available widths (intrinsic
  measure vs final render, the CSS two-phase). Today's renderers take
  only the element; adding the context is non-breaking.

## Evolution policy

This surface is public: every change is ADDITIVE (new optional
fields, new optional parameters). Anything else is a breaking change
requiring a major version — below 1.0, it still requires deliberate
sign-off and a migration note, never a drive-by.
