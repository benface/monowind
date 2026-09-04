# The host as a leaf

Status: **implemented** (2026-09-04; plan
`.agents/plans/2026-09-04-host-leaf.md`). A deferred second half
(anonymous boxes for text between block children) is kept at the end
for the record.

## Why

`<mono-wind>foo</mono-wind>` renders nothing: the host is the one
container whose direct text is never laid out, while `<div>foo</div>`
anywhere inside it is a text leaf. The host's tree is built from its
element children only, its own text is flagged as dropped (cell-model.md
deviation 7) with a warning written for text NEXT TO block children,
and the playground shows a blank preview to anyone who types plain
text. Wrapping the text in the light DOM is not an option: frameworks
reconcile against the nodes they created, and a foreign wrapper breaks
their next render, the author's selectors, and DOM round-trips. The
engine's own tree is the place to fix it, and it needs no new concept:
the host is a container, and a container with no in-flow block child
is a leaf.

## Locked decisions

- **The host is a container like any other.** The child-role test that
  decides leaf-or-container for every element decides it for the host:
  with no in-flow block-level child, the host's inline content — text,
  inline elements, atomic inline boxes as U+FFFC markers — is the ROOT
  LEAF, and its out-of-flow children are positioned nodes as in any
  leaf. With a block-level child the host is the container it is today
  (mixed text stays dropped and warned; the warning's wording is then
  right). The engine's metrics probe is never part of the run.
- **The root leaf's style.** The virtual root's box style — no padding,
  border, margin, or size; the host's own padding and border stay
  outside the grid, as today — plus the host's text properties:
  white-space, tab-size, text-indent, text-align (and its `justify`
  block), text-overflow, overflow (for truncation), and the decoration
  line. Tracking and line gap are zero by definition: the host's
  letter-spacing and line-height ARE the cell. Its paint is bare except
  for the decoration line — the grid inherits the host's color, weight,
  and style natively, and paints the decoration itself because an
  absolutely positioned `<pre>` receives no propagated decoration.
- **The host's native text needs no positioning.** The host is its own
  box: the browser lays its inline content out in the same content box,
  at the cell's line height, wrapping at the same whole-cell width the
  engine laid out, so the text already sits under the glyphs exactly as
  a leaf's text sits under its box (probed: rows match for wrapped,
  indented, and `nowrap` text in all three engines). The invisibility
  locks extend to the host while it is a leaf (`data-mw-leaf`):
  text-fill and decoration color go transparent on the host itself, and
  the shadow grid resets text-fill to `currentColor` because the fill
  inherits across the shadow boundary (probed: every grid span keeps
  its own color in all three engines). The canonical `::selection`
  invert gains the host as a fourth site: Firefox styles slotted text
  from its light parent, Chromium and WebKit from the slot, which the
  shadow sheet's own copy of the rule already covers (probed). The leaf
  typography rules the companion keys on laid-out descendants —
  `nowrap`, `pre`, text-indent in cells, the `justify` block — gain
  host variants, written on the host by the renderer as on any leaf.
- **Gestures and copy see the root leaf.** Hit-testing walks the root's
  children, so the semantic gestures consult the root leaf itself when
  no text leaf is under the cell; its paragraph unit is the run's DOM
  extent — first character or box through the last — never the host's
  whole child list (the probe lives there). The copy serializer already
  treats the root as a node; a root leaf slices like any leaf.

## Mechanics

- The leaf branch of the tree builder becomes a function of (element,
  style, the child nodes to collect from), used twice: an element leaf
  over its child nodes, the root leaf over the host's child nodes minus
  the probe. Run collection already handles inline elements, atomic
  boxes, `<br>`, whitespace collapsing, and the per-character source
  map.
- `element.ts` builds the root leaf in place of the virtual container
  when the host's element children carry no block role and the host
  has inline content; a host with neither is the empty zero-row root it
  is today.
- Renderer, on the host only: `data-mw-leaf`, `data-mw-nowrap`,
  `data-mw-pre`, `--mw-ti`, `data-mw-text-align-blocked`. No geometry
  vars, no `data-mw-laid-out` (that rule absolutizes).
- Companion CSS: host variants of the fill and decoration locks
  (`mono-wind:not([measuring])[data-mw-leaf]`), of the `::selection`
  invert, of the grid-mode selection lock (Firefox takes a slotted text
  node's `user-select` from its light parent), and of the four leaf
  typography rules; in the shadow sheet,
  `#grid { -webkit-text-fill-color: currentColor }`.
- The slot is a positioned block box (`slot { display: block; position:
relative }`). Laid-out elements are absolute and always painted above
  the grid, but the host's own text is in-flow, and in-flow content
  paints BELOW an absolutely positioned sibling — the grid's glyphs
  covered its selection ink (found by the visual fixture; the probes
  had an empty grid). A positioned slot box paints its content in the
  positioned step after the grid, and laid-out elements position
  against it at the same origin as before.
- The unit gesture: after the hit stack yields no text leaf, the root
  leaf is tried at the cell (`charIndexAtCell` with the root's origin).
- `truncate` on the host: the root leaf takes the host's x clip, and
  `layoutRoot` grows the root to its ink extent only along a visible
  axis, so the leaf truncates at the host's columns like any leaf
  (the host's own `overflow: hidden` clips natively; the engine paints
  the ellipsis cell).

## Deviations (documented, like the cell model's running list)

- **The host's centered lines** keep the browser's fractional centering
  in text mode: the half-cell nudge is a transform and would move the
  whole component.
- **Column utilities on the host itself** do not apply (they never
  did); use a wrapper.
- Deviation 7 (text next to block children is dropped) is unchanged.

## Testing

- Node (happy-dom): the root leaf built from a host-like element —
  text, an inline element with padding, an atomic box, an out-of-flow
  child, the probe excluded, a `<br>`; the host with a block child
  still a container with dropped text.
- Storybook (`Test / Host`, extended): a text-only host with an inline
  element — grid text, `data-mw-leaf`, the host's fill transparent, a
  grid span's fill `currentColor`, a programmatic range over the host's
  text copied by the engine, a triple-click on it selecting the run and
  a word gesture selecting a word, `nowrap` and `text-indent` on the
  host reflected in the flags; the mixed host unchanged. All three
  engines.
- Visual: a third selection-invert fixture — a text-only host dragged
  in both modes (the host `::selection` site, and the grid) — and the
  visible "Own Text" story under Root Styles, whose play asserts the
  browser's line boxes over the host's own nodes land on the engine's
  rows in all three engines, and which the story sweep screenshots.

## Touch points on implementation

- cell-model.md: "Host sizing" notes the root leaf; the Inline content
  section references this spec; deviation 7's wording drops the host
  from the dropped-text case.
- semantic-selection.md "The paragraph is the text LEAF": leaves are
  elements or the root.
- README "Selection" or the intro: a sentence that the host's own text
  renders like any element's.

## Deferred: anonymous boxes for text between block children

CSS wraps each run of inline content between block siblings in an
anonymous block box (CSS 2 §9.2.1.1); the engine could do the same in
its tree — an anonymous leaf per run, `source` the container, nothing
written to the DOM. Its bare text can never be positioned natively (no
element), so it would stay hidden as today, and the grid gestures would
treat the run as blank so that the visible highlight always matches the
copy. Its elements could stay live: an inline element or atomic box on
a single row positioned at its cells as a fragment box (absolute, run
padding, `nowrap`, visible) — today's engine lays out such inline
elements as blocks of their own, clickable, which a fragment rule would
preserve — while an element wrapping across rows would hide with the
text (interactive content hidden that way warned once).

Deferred because it trades one deviation for a smaller one at the cost
of a node kind that five modules must respect plus a fragment path,
for a markup shape utility-first code rarely produces, where the
existing warning already names the one-line fix. Revisit if real
content keeps hitting the warning.
