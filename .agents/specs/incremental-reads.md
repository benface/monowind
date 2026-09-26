# Spec: incremental reads — a relayout re-reads what changed

Status: **proposed** (2026-09-24), not implemented; plan
`../plans/2026-09-24-incremental-reads.md`, lever 4 of
`../plans/2026-09-23-performance-levers.md`.

A full relayout unlocks every light element, reads its computed style
and rebuilds the whole tree, whatever changed: a hover over one link
in prose re-reads 2,400 elements. An **incremental relayout** unlocks
and reads only the elements a change may have restyled, splices their
fresh nodes into the last tree, and lays out, renders and paints the
whole tree as a full relayout does. A host opts in (`updates`).

The engine reads computed styles, never the author's CSS
(core-architecture.md D1), so what a change may restyle is derived
from the tree alone, as the change's wider unit ("Units"). A selector
that reaches past it is a limit ("Limits"): its element shows the
style of its last read until the next full read.

## Terms

- A **full read** is the relayout core-architecture.md "The
  measure/write cycle" describes: every light element flagged, marked
  and read, a fresh tree built.
- A **changed element** is a light element whose computed style, text
  or children may differ from the last read ("Changed elements").
- A **unit** is an element with a node of its own in the last tree,
  read again with its whole subtree; a relayout's units are its
  **dirty set**.
- A changed element's **wider unit** is its subtree, its following
  siblings with theirs (none for a change the pointer alone made), and
  its ancestors below the host ("Units").

## The `updates` attribute

- **Its values, the default first: `full`, `incremental`,
  `incremental recheck`.** It is reflected as `select` and `focus` are
  (focus-navigation.md "Locked decisions"): `full` is written onto the
  attribute when it is absent, removed or unrecognized — `incremental`
  under verify ("The invariant") — and an unrecognized value warns. The value is matched whole, as theirs are:
  `recheck` alone, or `recheck incremental`, is unrecognized. Like
  them, it has no property.
- **`full`**, the default, reads in full at every relayout, exact
  whatever the page's selectors. The host gathers no changed
  elements, states or values.
- **`incremental`** reads incrementally where a relayout's triggers
  name their changes and in full elsewhere ("Full reads"), within the
  limits.
- **`incremental recheck`** adds the recheck ("The recheck").
- **A change of `updates` schedules no layout.** The next relayout
  reads in full, which gives an incremental host the states and values
  its next relayout diffs against.

## What an incremental relayout does

- **It is a full relayout with two differences**: the elements it
  flags, marks and reads, and the tree it lays out. Every other step
  runs as in a full one: the host's tokens, the boxes around the host,
  the fade holds, the cell metrics, the available columns and visible
  cells, the layout of the whole tree, the top-layer stack, the
  render, the sticky shifts, the paint, the grid's and the host's
  size, the settle round, the scroll restore, the drain of the
  engine's records, the found animations and pending background
  fades, and the pointer states after.
- **Each unit's subtree is read.** Its elements are flagged and marked
  (`data-mw-interactive`, `data-mw-composite`), its textareas' widths
  are taken before the flags go on, and the unit is built by the path
  its parent's build takes for a child of its role (tree.ts), what that
  path derives from the elements between them — the opacity of the
  inline elements a block split (`inlineOpacity`) — derived again.
  The fresh node replaces the old one at its index in the parent's
  children.
- **Each unit's ancestors below the host are flagged and read**
  ("Units"). An ancestor whose read differs adds its units in a second
  round of flags and reads before the build.
- **Every other element keeps its locks, its marks and its node**, and
  the settle round covers the flagged elements alone.

## The partial unlock

- **The ancestors unlock with their unit.** An element inherits from
  its parent, and a locked parent hands down its locks: grid mode's
  `pointer-events: none`, `white-space`, `letter-spacing`,
  `line-height`, `text-align` and `text-indent`, all of which the
  reader reads. With the chain from the host flagged, the computed
  styles of a unit and of its ancestors are a full read's, because
  every companion rule that keys on the measuring flag keys it on the
  element it styles: an element's own flag and its ancestors' decide
  what it reads, never a sibling's or a descendant's. A rule keyed on
  another element's flag would break incremental reads.
- **The anchors unlock where a unit holds an anchored box** (a
  `position-area` or an anchor function): every element marked as
  naming an anchor (`data-mw-anchor`) is flagged too, and not read, so
  its `anchor-scope`, which keys on both, holds as in a full read.
  Otherwise its name reaches the box, and the browser resolves the
  box's `anchor()` and tries its fallbacks natively
  (anchor-positioning.md "Reading"). A scope lock that holds on
  anchor-named elements whatever their flag makes this unnecessary.
- **A read may not depend on the browser's layout.** The unlocked
  elements lay out beside locked ones, so a used value differs from a
  full read's. Two sources make a relayout full: the reader's
  used-value sizes without Typed OM, and a container — an element
  read whose `container-type` is other than `normal`, whose size or
  scroll state a query below it asks the browser for. The
  screen-reader-only test (a clipped box of at most 1px, style.ts)
  reads the element's own used size, the one used value left, and
  counts as layout-independent.

## Changed elements

Under `incremental`, the pending set gathers until the relayout runs,
whatever triggers it:

- **Mutation records** the observer counts as rendering (cell-model.md
  "Observation"): an attribute's element, a text's parent element, and
  the parent whose children changed. The relayout takes the observer's
  pending records first, so a relayout in the same task as the
  mutation (a `<select>`'s focus, `toPlainText`) sees it. A record
  whose target has left the host is dropped: the removal is recorded
  on a connected ancestor.
- **The engine's marks**: an element whose `data-mw-hover`,
  `data-mw-active` or `data-mw-covered` flipped, and one whose
  `data-mw-area` the last relayout rewrote, since a style may follow
  the flip.
- **States**: a fixed list of the pseudo-classes whose members change
  with no record — `:hover`, `:active`, `:focus`, `:focus-visible`,
  `:focus-within`, `:target`, `:checked`, `:indeterminate`,
  `:default`, `:placeholder-shown`, `:autofill`, `:valid`, `:invalid`,
  `:user-valid`, `:user-invalid`, `:in-range`, `:out-of-range`,
  `:open`, `:popover-open`, `:modal`, `:fullscreen`,
  `:picture-in-picture`, `:defined`, `:dir(rtl)` (whose complement is
  `:dir(ltr)`: a text edit flips a `dir="auto"` element and what
  inherits its direction), and the media states (`:playing`,
  `:paused`, `:seeking`, `:buffering`, `:stalled`, `:muted`,
  `:volume-locked`) — is matched in the host at every relayout, and an
  element entering or leaving one is changed. The focus's three come
  from the focused element and its ancestors; one query of the host
  finds the rest's candidates: the pointer's, `:target`'s,
  `:dir(rtl)`'s and the top layer's matches, the undefined elements,
  and the form-associated, option, form, fieldset, details, dialog and
  media elements. A pseudo-class the browser does not support is
  dropped, since it matches in no stylesheet either. The events the
  host listens to (pointer, key, focus, `input`, `change`) only ask for
  the relayout; the query says what changed, so native `:hover`'s
  ancestors, a label's control, a radio its neighbour unchecked, a
  form's `:invalid`, a `:target` after a hash change and a state set
  by script all count.
- **Not in the list**, each for a reason: the pseudo-classes HTML
  derives from attributes (`:disabled`, `:enabled`, `:required`,
  `:optional`, `:read-only`, `:read-write`, `:link`, `:any-link`,
  `:lang()`) follow their attribute's records, and what they hand down
  lies in its subtree; the structural ones follow the tree records of
  the parent; `:visited` never shows in a computed style; `:state()`
  takes a name no fixed list holds (limit 9).
- **Control values**: each form control's value, checkedness,
  indeterminacy and selected options are recorded at every relayout;
  a control whose record differs is changed (a textarea's rows, a
  select's label under `field-sizing: content`).
- **Ancestors whose read differs** ("Units").

## Units

- **A changed element's unit is the nearest element at or above it
  with a node of its own** in the last tree: an inline element's is its
  leaf's, and an element inside a form control or a `display: none`
  subtree takes its nearest laid-out ancestor's.
- **The unit rises past what its parent's build recorded about it**:
  an atomic inline box to its leaf, whose run holds the box's marker,
  advance and intrinsic width; an anonymous run to its container; and
  a unit that now reads a role other than the one its parent
  classified it by (shown or `display: none`, inline or block, in or
  out of flow, floated, a leaf renderer's) to its parent.
- **A unit is its whole subtree**, which covers what inherits or
  descends from a changed element: inherited and custom properties,
  the `group-*` and `in-*` variants, every descendant combinator, and
  the structural pseudo-classes of a changed parent's children.
  Counters need nothing, since the engine reads no generated content.
- **A changed element's following siblings are changed too**, since
  `peer-*`, `+`, `~` and `:nth-child(… of S)` reach them, **unless the
  pointer alone changed it**: it entered or left `:hover` or `:active`,
  or its `data-mw-hover`, `data-mw-active` or `data-mw-covered`
  flipped, and nothing else named it. A hover that crosses from one
  block to the next then reads the two blocks, not what follows them
  (limit 5).
- **Each unit's ancestors below the host are read** and compared with
  the read the last tree holds of them: a node's style, or, for an
  inline or `display: contents` element that a block splits or an
  out-of-flow box sits in, the read its nearest node's build kept. An
  ancestor whose read differs is a changed element, with a unit and
  following siblings of its own: a `has-*` on an ancestor, and what
  the ancestor hands down.
- **A unit inside another is dropped**, the outer one reading it.

## Full reads

Under `incremental`, a relayout reads in full when:

- it is the host's first, or its first since `updates` changed, or
  follows a failed one or a reconnection;
- a trigger names no changed elements: a resize of the host or the
  window, fonts, the leaf or glyph registries, a stylesheet the engine
  sees change (a node added, removed or edited in the head, a head
  `<link>`'s load, a record that adds, removes or edits a `<style>` or
  a stylesheet `<link>` in the host), an ancestor's `class` or
  `style`, the host's own, the color scheme, the `select` attribute, a
  `toggle`, a transition's or an animation's event, the sampling
  loop's ticks and the relayout that ends it, a fade hold's end, a
  scroll that moves an anchor or the cells under a centered top-layer
  element, the corrective relayout after an unarmed fade, the relayout
  a held paint waits for, the recheck;
- the cell metrics, the root font size or the available columns
  differ from the last layout's, measured before any read so the flags
  extend to every element;
- a unit is the root, or the units hold more than half of the host's
  light elements;
- an element read is a container ("The partial unlock"): found
  mid-read, the relayout starts over in full;
- the sampling loop runs, since its paint path writes live values into
  the nodes' styles (animations.md);
- the engine has no Typed OM.

A held relayout (an open select picker, a key's scroll) keeps its
changed elements and its full request until it runs.

## The recheck

Under `incremental recheck`, a full relayout runs one second after an
incremental one when no relayout has run since; any relayout restarts
the wait, and a full one ends it. A limit's change then shows at most
a second after the last relayout that follows it, for one full
relayout per burst in idle time.

## Reused and replaced nodes

- **A replaced node carries nothing of the old one.** What its
  parent's build gave it is derived again, and layout writes the rest
  afresh. An ancestor whose read is unchanged keeps its node, and only
  its children take the splices.
- **Layout writes every field it owns on every node it lays out.** A
  field one layout writes and the next might not (the gap rules, the
  lattice, a fixed box's origin, `tableHidden`) is cleared at the
  node's entry. Layout writes none of the build's fields: the atomic
  boxes' laid-out advances live apart from the run's. The root's
  per-layout fields (the anchors' scroll containers, the visible
  cells, the top-layer stack) are set or cleared by each layout. A
  second layout of an unchanged tree, and one after a subtree's
  replacement, equal a fresh tree's in every field.
- **Nothing keyed by a node outlives a relayout**: the node index, the
  scroll containers and the sticky boxes are collected again from the
  spliced tree. What the engine keys by element carries over as it
  does across full relayouts: the anchored boxes' last placements, the
  top-layer stack, the pointer chains, the animated set, the
  synthesized fades and last-read backgrounds, the settle timers, the
  glyph cache.
- **Scroll positions** are captured before the unlock and restored
  after the settle, every scroll container's, as in a full relayout.
- **Focus and selection stay the DOM's**: no element is recreated,
  hidden or moved, and a fresh leaf maps the same text nodes, so a live
  selection and the paint's structural rules (cell-model.md
  "Selection") behave as across a full relayout.

## The invariant

- **Outside the limits, an incremental relayout paints exactly what a
  full relayout of the same state would**: the same cells in the grid
  and the layers, the same writes onto the light DOM, the same host
  size.
- **Verify** is an internal page switch the tests set before any host
  connects, never a value of `updates`. It wins over the reflected
  default: a host that connects under it without the attribute
  reflects `incremental` and checks every relayout that derived a
  dirty set; one that connects with the attribute behaves as it says,
  unchecked, so a test compares hosts itself. After a full relayout
  (a fallback), every node whose build fields differ from the last
  tree's must lie in a unit: the derivation's soundness. After an
  incremental one, a full relayout of the same state runs at once and
  must write nothing onto the light DOM but its flags and repaint no
  cell. A failure throws, naming the units and the first differing
  node, cell or write. A page that hits a limit fails verify, which
  cannot tell a limit from a bug.

## Limits

Deviations from CSS under `incremental`; `full` has none. Each shows
an element the style of its last read until the next full read (the
recheck's, under `recheck`); a relayout between may re-read some of
the elements concerned and show the new style in part.

A change at element E misses an element outside E's wider unit that a
selector ties to E through:

1. a `:has()` anchored at an ancestor of E that is not itself changed,
   its read the same and no listed state entered or left: a
   `group-has-*` target before E or off E's branch (a label ahead of
   its `<input>` that `group-has-invalid:` turns red), a `peer-has-*`
   whose peer holds E, or a `has-*` that sets only what the anchor's
   read does not hold (a custom property a descendant reads through
   `var()`). A pointer or focus state entering or leaving the anchor
   changes its `:hover`, `:active` or `:focus-within`, so only a move
   between two elements inside it can miss;
2. a `:has()` anchored at a preceding sibling of E or of one of E's
   ancestors (`:has(+ …)`, `:has(~ …)`), which is not read;
3. a `:has()` anchored outside the host (`body:has(dialog[open]) .x`,
   `html:has(…)`), where nothing is read;
4. `:nth-last-child(… of S)`: E entering or leaving S re-indexes its
   preceding siblings;
5. `+` or `~` after an E the pointer alone changed ("Units"):
   `peer-hover:`, `peer-active:`, hand-written `:hover ~ …`,
   `:hover + …`, `:active ~ …` and `:active + …`, a `:has()` on a
   pointer state crossing them (`peer-has-hover:`, whose peer, the
   hovered element's ancestor, enters `:hover` and nothing else), and
   `:nth-child(… of S)` whose S holds a pointer state.

A change no trigger reports, which the next relayout of any kind
showed while every relayout read in full, waits for the next full
read:

6. a stylesheet change the engine does not observe: a CSSOM edit
   (`insertRule`, `deleteRule`, a rule's declarations set by script),
   `adoptedStyleSheets` replaced, a sheet's `disabled` or `media` set,
   a `<style>` or `<link>` in neither the head nor the host added or
   removed, and a `<link>` outside the head finishing its load;
7. an attribute the observer does not count (cell-model.md
   "Observation") styled through an arbitrary variant, and an
   ancestor's attribute other than `class` and `style` (`data-theme`
   on `<html>`);
8. a media query other than the width's and the color scheme's
   (`prefers-reduced-motion`, `prefers-contrast`, `forced-colors`,
   `hover`, `pointer`);
9. a custom element's `:state()`, set by script;
10. an animation begun or resumed by script (`animate()`, `play()`) on
    an element no read reaches, a read being its one sure sighting
    (animation.ts).

## Testing

- Node: `dirty.test.ts` — records, marks, the state list (its support
  filter, the focus chain) and control values to changed elements; the
  units' rises (atomic box, anonymous run, role change, root); the
  following siblings and the pointer's exemption; the ancestors'
  comparison (a node's style, a
  node-less element's kept read) and the units a differing one adds;
  nesting; the half rule. `tree.test.ts` — a node rebuilt by its
  parent's path equals the one the parent's build made, in a
  container, beside anonymous runs, and as a leaf's positioned child;
  the reads kept of node-less elements. `layout.test.ts` — a second
  layout of the same nodes, and one after a subtree's replacement,
  equal a fresh tree's in every field. `cascade.test.ts` — every
  companion rule keys the measuring flag on the element it styles.
  `element.test.ts` — `updates`' values, reflection and warning.
- Storybook: `Test / Incremental reads` (`!dev`, `!golden`, `fuzz`), a
  seeded differential fuzz of random trees and mutation streams. Two
  hosts, `updates="full"` and `updates="incremental"`, take the same
  DOM changes and synthesized pointer and are compared cell by cell
  after every step; a verified host takes the native states two hosts
  cannot share (focus, native hover, typing); streams built on the
  limits run on an `incremental recheck` host, equal to the `full` one
  a second after each burst. The story suite passes under verify, but
  for the stories that hit a limit (`!verify`, each naming its limit).
- CI: verify and the fuzz run in Chromium on every push, and in all
  three engines before a release.
- Bench: `pnpm bench --relayout hover|type|toggle` per relayout,
  `--updates full|incremental`, and several `--bundle`s alternated.

## Touch points on implementation

None until implemented: the plan's milestones list the work, and this
section maps the code once it lands.
