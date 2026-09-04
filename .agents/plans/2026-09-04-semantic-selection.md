# Semantic selection implementation plan

Status: **proposed** (2026-09-04). Spec: `.agents/specs/semantic-selection.md`
(normative; this plan only sequences it). Engine facts the spec marks
_verified_ were established with a throwaway Playwright fixture on the
CDN bundle; the plan re-checks nothing already settled there.

## Shape

Six phases, each ending green (`pnpm check`; the visual sweep is
unaffected until phase 6 adds hidden stories). Phases 1-2 are pure
tree/serialization work testable in Node and ship value on their own
(the copy fix applies to `select="text"` today); 3-5 are the gestures;
6 is stories, docs, and the release.

## Phases

### 1. Tree — character ↔ DOM position map

- During `collectRun` (tree.ts), record per pushed character its source
  `Text` node and offset in two parallel arrays beside `inlineIndex`
  (`null`/`-1` for `<br>` newlines, `OBJECT_REPLACEMENT`, `INLINE_PAD`);
  the normal branch iterates the source string with its index so a
  collapsed whitespace run records its first source character; the
  `white-space: pre` branch is one-to-one. The post-collection pass that
  collapses spaces and trims line ends rebuilds `chars`/`advances`/
  `inlineIndex` in lockstep — the two new arrays go through the same
  push/pop, or the map is wrong by exactly the dropped characters.
- Stored compactly on the node: `LayoutNode.charSource?: { index:
number; node: Text; offset: number; length: number }[]` — one run per
  maximal stretch where character `index + k` maps to `offset + k` in
  the same node (a collapsed run or a marker ends a stretch), built
  from the per-character arrays at the end of the leaf build. Per-
  character objects would be allocated on every tree rebuild (hover
  storms rebuild the tree); runs are proportional to text nodes.
  Renderer leaves (`buildRendererLeaf`) set no map; form-control leaves
  have no text and need none.
- `charIndexAt(node, textNode, offset): number` and
  `positionOf(node, index): { node: Text; offset: number } | null`
  (new `packages/core/src/selection.ts`, pure): binary search over the
  runs. A point inside a collapsed run resolves to that run's
  character; a point past a node's mapped characters resolves to the
  next mapped index, or `text.length`; a point inside an atomic inline
  box's subtree resolves to that box's U+FFFC index in the parent leaf
  (the box's own map handles the point within the box).
- Tests (`tree.test.ts`): plain text; whitespace collapse across two
  text nodes (leading, trailing, inner); `<br>`; nested inline elements
  with padding markers; an atomic inline box's U+FFFC; `pre` text;
  trimmed line-end spaces. Round trip `positionOf` → `charIndexAt` for
  every mapped index.

### 2. Copy — engine-written `text/plain` (both modes)

- Selection location, shared by this phase and phase 3: a helper that
  returns the document selection's first range as seen through the
  host's shadow (`getComposedRanges({ shadowRoots: [shadowRoot] })`,
  legacy `ShadowRoot.getSelection()` fallback — the same API path
  paint.ts `captureSelection` uses; extract it there and reuse) and
  classifies it: `"grid"` (inside `#grid`), `"light"` (both points in
  the host's light DOM), `"leaf-shadow"` (both points in one leaf's
  shadow root), or `"outside"`. Never classify from `getRangeAt(0)`
  alone: a shadow selection retargets its points onto the host, which
  a naive `host.contains` test reads as light DOM.
- `serializeSelection(root: LayoutNode, range, kind): string | null`
  (selection.ts): `null` for `"grid"` and `"outside"` — the browser
  copies those. `"leaf-shadow"`: the `text` of the leaf whose `source`
  is that shadow root's host. `"light"`: walk the layout tree in tree
  order (children as built — confirm DOM order in tree.ts, else order
  by `compareDocumentPosition`; an out-of-flow child comes after its
  parent leaf's text), collecting each text leaf the range intersects
  (a live `Range` in the light tree; a renderer leaf is
  all-or-nothing):
  - Fully contained: `leaf.text`, minus a final `\n` (a trailing
    `<br>`'s break, which the wrap layer drops as well).
  - Partially: the slice between `charIndexAt` of each boundary point
    inside the leaf (a boundary outside it means 0 or `text.length`).
  - Inline boxes: the parent leaf's U+FFFC characters are replaced by
    the corresponding box's serialization (recursively) and the box is
    not emitted as a leaf of its own; `INLINE_PAD` characters are
    dropped.
  - Assemble with the `innerText` required-line-break rules (HTML
    "rendered text collection steps"), walking every node the range
    intersects, not only leaves: a `<p>` contributes 2 required breaks
    before and after, any other block-level box (`style.display` not
    inline; table parts included) 1, a table cell `\t` before it unless
    first in its row and a row `\n` after it; a run of required breaks
    collapses to its maximum; leading and trailing breaks are removed.
    Firefox's native output for two `<p>`s (a blank line between) is
    the reference.
- element.ts: a `copy` listener on the host (connected/disconnected
  with the others). When `serializeSelection` returns a string:
  `clipboardData.setData("text/plain", …)` and `preventDefault()`.
  Nothing else is set (no `text/html`), per spec.
- Tests (`selection.test.ts`, Node, happy-dom Ranges): two `<p>`s
  fully selected → `A\n\nB`, two `<div>`s → `A\nB`; a table row →
  `a\tb`, two rows → `a\tb\nc\td`; partial slices at both ends; a
  `<br>` inside a slice; an inline box mid-paragraph spliced in place;
  a renderer leaf (registered in the test, as `leaf.test.ts` does)
  contributes its lines; `"grid"`/`"outside"` → `null`.
- Manual check (three engines, `select="text"`): drag across two
  paragraphs in the playground and paste — a blank line between them,
  identical in all three.

### 3. Lock lift + gesture plumbing

- Shadow template (element.ts): after the `:host([select="grid"])
slot` rule add `:host([select="grid"][data-mw-semantic-selection])
slot { user-select: text; -webkit-user-select: text; }` (higher
  specificity, no `!important`).
- `document` `selectionchange` listener (added on connect, removed on
  disconnect; returns at once unless the host carries
  `data-mw-semantic-selection`, so idle hosts cost one attribute check
  per event): when the classified selection is not
  `"light"`/`"leaf-shadow"` or is collapsed, remove the attribute. The
  phase-4 `mousedown` listener also removes it synchronously on a
  plain click (`detail === 1`) — the native drag that follows must not
  find the light DOM still selectable before the async
  `selectionchange` lands.
- Record the last primary `pointerdown`'s `pointerType` in
  `#onPointerDown`, before its touch early-return — the mouse/pen guard
  for `mousedown`.
- Leaf hook: `LeafRegistration.selectionTarget?: (el: Element) => Node
| null` (leaf.ts, additive); `@monowind/ascii` returns its `#mirror`.
  `leaf-renderers.md` gains the bullet; the README's leaf section
  mentions it.

### 4. Paragraph gesture

- Confirm by hand first, before building on it: click counting
  survives `preventDefault()` on the second and third `mousedown` in
  all three engines — real OS clicks in the playground with a temporary
  `mousedown` listener that cancels and logs `detail`. Playwright
  cannot probe this (it supplies `clickCount` itself). Expected to
  hold: all three engines take the count from the platform event
  before the renderer sees it; the fallback stays under Risks.
- `mousedown` listener on the host, grid mode only: `composedPath()`
  includes `#grid`; `detail >= 3`; primary button; last pointer type
  mouse or pen. `preventDefault()` (also when there is no layout yet —
  the whole-grid selection must never appear). A canceled `mousedown`
  moves no focus, so blur a focused element inside the host first
  (`document.activeElement`, when the host contains it) — native
  focus movement, and the copy command must not target a control's
  empty selection. Cell from `#cellAt`, leaf from
  `hitStack(this.#lastLayout, col, row)`: innermost entry with `text`
  and no in-flow children. None → `removeAllRanges()`, done.
- Range for a leaf: `selectNodeContents(selectionTarget?.(source) ??
source)`. Apply: set the host attribute, read one computed style to
  flush, then `setBaseAndExtent`. Shift with an existing `"light"` /
  `"leaf-shadow"` selection: keep its anchor, focus at the far
  boundary; anything else behaves as without Shift.
- Gesture state `#semanticGesture: { unit: "word" | "paragraph";
anchor: { start: Point; end: Point } } | null`, set on `mousedown`,
  cleared at the top of `#onPointerUp` (before its thumb-drag and
  press early-returns). `#onPointerMove`, after the touch guard and
  before its existing work: when set and the primary button is down,
  derive the unit under the pointer's cell and `setBaseAndExtent`
  anchor-far-edge → current-far-edge by `compareDocumentPosition`; no
  unit → leave the selection. Points in a leaf's shadow cannot pair
  with light-tree points: any extension involving a shadow-rooted leaf
  uses the host element's light-tree edges for that leaf.

### 5. Word gesture

- `charIndexAtCell(node, col, row): number | null` (plain-text.ts,
  beside the paint walk): the walk's per-line placement —
  `leafLineGeometry` / multicol geometry, indent, alignment offset,
  truncation, per-character advances — extracted into one helper that
  both the walk and this lookup call, so hit and paint cannot drift.
  Returns the index of the character covering the cell (a multi-cell
  advance covers all its cells), or `null` for a blank cell.
- `wordAt(node, index): { start: number; end: number } | null`
  (selection.ts): `Intl.Segmenter(lang, { granularity: "word" })` —
  one instance per `lang`, cached in a module Map (construction is not
  free and extension calls this per `pointermove`) — over the runs of
  `node.text` between U+FFFC/`INLINE_PAD` markers (markers are hard
  boundaries); `lang` from `source.closest("[lang]")`; the segment
  containing `index`. Ends mapped through `positionOf`; an end
  with no position → the leaf's paragraph range instead.
- `mousedown` with `detail === 2` runs the phase-4 gesture with `unit:
"word"`; extension derives the word under the pointer's cell each
  move (no character → leave the selection).
- Tests: `selection.test.ts` — `wordAt` on plain words, punctuation
  runs, blanks, a word adjacent to a marker, a word spanning an inline
  element boundary (one segment). `plain-text.test.ts` —
  `charIndexAtCell` against a rendered leaf with `text-align: center`,
  `text-indent`, tracking, a truncated line, a blank tail, and a
  multicol leaf.

### 6. Stories, docs, release

- `apps/storybook/stories/selection.stories.ts` (already `Test /
Selection`, hidden): a `Semantic` story with the spec's fixture (flex
  row: a column of two `<p>`s beside a third; a `<mono-ascii>`; a
  trailing `<p>`) and the spec's play sequence. Gestures are synthetic
  `mousedown`s dispatched on `#grid` inside the shadow with
  `bubbles: true, composed: true`, `detail`, `button: 0`, and client
  coordinates from `getBoundingClientRect` — dispatching on the host
  would leave `#grid` out of the composed path. (Probed: `userEvent`
  from `storybook/test` is the simulated testing-library one under the
  vitest runner — untrusted events, and it refuses targets with
  `pointer-events: none`, which every light element is in grid mode.)
  `pointermove` with `buttons: 1` and `isPrimary: true`; `pointerup`
  on `window`. Copy assertions via a synthetic
  `ClipboardEvent("copy", { clipboardData: new DataTransfer() })`
  dispatched on the host (the listener classifies the live selection,
  not the event target), reading `getData("text/plain")`. The play,
  in order, each step asserting `getSelection().toString()` (and the
  copy text where named), runs in all three engines under the
  existing story sweep:
  1. A real click on empty page area focuses the document (Firefox
     paints and reports no selection otherwise).
  2. Triple-click (`detail: 3`) on the first stacked `<p>` → exactly
     its `innerText`; host has `data-mw-semantic-selection`; nothing of
     the side `<p>`; copy → that text.
  3. `pointermove` onto the second stacked `<p>` → both, side excluded;
     copy → `A\n\nB`. `pointermove` onto a gap cell → unchanged.
     `pointerup`, then another `pointermove` → unchanged (the gesture
     ended).
  4. Plain `mousedown` (`detail: 1`) on the grid → the attribute is
     gone synchronously, before any `selectionchange`.
  5. Triple-click on a gap cell → empty selection (never the grid).
  6. Triple-click on the trailing `<p>` with `shiftKey` after a
     triple-click on the first → the selection ends at the trailing
     paragraph's boundary; copy → paragraphs, blank line, art, blank
     line, paragraph.
  7. Triple-click on the banner → the art (selection inside the
     `#mirror`); copy → the art.
  8. Double-click (`detail: 2`) inside a known word → that word; on a
     blank cell of the same line → empty; `pointermove` onto a later
     word → first word through second; double-click on the banner →
     the whole art (paragraph fallback).
  9. Focus a text `<input>` placed in the fixture, then triple-click a
     `<p>` → `document.activeElement` is no longer the input and the
     paragraph is selected.
  10. `pointerdown` with `pointerType: "touch"` then `mousedown`
      `detail: 3` → no selection change (the compat-event guard).
  11. `removeAllRanges`, await `selectionchange` → attribute gone.
  12. A grid selection made programmatically inside `#grid` → the
      synthetic copy event leaves `text/plain` unset (the browser's
      path).
- A second story, `Copy`, in `select="text"`: programmatic ranges over
  two `<p>`s, two `<div>`s, and a table row + the synthetic copy event
  → `A\n\nB`, `A\nB`, `a\tb` in all three engines — the text-mode
  regression the serializer fixes, automated rather than manual.
- Manual spot-checks per engine (not automatable): a real ⌘C after
  each gesture pastes what the synthetic event produced; Shift+Arrow
  extends a semantic selection; Firefox/WebKit highlight of the banner
  when an extension crosses it (the spec's remaining "still to check").
- Docs: README grid-mode paragraph (double/triple-click select the
  element's word/paragraph; copies are plain text laid out by the
  standard `innerText` rules); spec status → implemented and "Still to check" resolved into
  verified facts; `leaf-renderers.md` hook bullet; cell-model.md
  "Selection" already points to the spec.
- Version: bump all `packages/*/package.json` to the next patch in the
  final substantive commit (AGENTS.md "Releasing").

## Coverage map

Every locked decision in the spec has a named guard; nothing relies on
the manual spot-checks alone:

| Decision / mechanism                                                                      | Guard                                                                              |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Character ↔ DOM map (collapse, `<br>`, markers, `pre`, trims)                             | `tree.test.ts` (phase 1)                                                           |
| `charIndexAt` / `positionOf`, inline-box marker resolution                                | `tree.test.ts` round trips                                                         |
| Serializer: `innerText` breaks, tabs, slices, inline boxes, renderer leaves, `null` kinds | `selection.test.ts` (phase 2)                                                      |
| Copy listener wiring + classification (grid / light / leaf-shadow)                        | `Semantic` story steps 2, 7, 12; `Copy` story                                      |
| Text-mode copy regression                                                                 | `Copy` story                                                                       |
| Lock lift, sync clear on plain click, `selectionchange` clear                             | story steps 2, 4, 11                                                               |
| Paragraph gesture, extension, gap cells, release                                          | steps 2, 3, 5                                                                      |
| Shift extension, cross-banner range                                                       | step 6                                                                             |
| `selectionTarget` hook (`<mono-ascii>`)                                                   | step 7; `leaf.test.ts` accepts the option                                          |
| Word gesture, blank cells, extension, banner fallback                                     | step 8; `wordAt` in `selection.test.ts`; `charIndexAtCell` in `plain-text.test.ts` |
| Focus movement on a canceled `mousedown`                                                  | step 9                                                                             |
| Touch compat `mousedown` guard                                                            | step 10                                                                            |
| Selection invert paint                                                                    | existing `visual/selection.spec.ts` (unchanged rule)                               |
| Composed-range helper extraction from paint.ts                                            | existing `paint.test.ts` stays green (behavior-preserving)                         |
| a11y                                                                                      | the story sweep's per-story axe pass covers the new stories                        |

Manual only (real clipboard and real OS clicks): ⌘C after each
gesture pastes what the synthetic event produced; click counting
survives `preventDefault()`; Shift+Arrow extends a semantic selection;
Firefox/WebKit highlight of a wholly contained banner.

## Risks and how the plan meets them

- **Click counting under `preventDefault()`**: confirmed by hand first
  in phase 4. If an engine resets the count when a `mousedown` is canceled, the
  engine counts clicks itself from `mousedown` timestamps and cells
  (500ms and the same cell, since the platform interval is not
  readable) — documented as a deviation in the spec.
- **`selectionchange` timing**: it fires asynchronously after our own
  `setBaseAndExtent`; the clear condition is true only for a foreign
  or collapsed selection, so our own never clears the attribute.
  Exercised by the story's `removeAllRanges` step.
- **Stale layout at copy time**: `serializeSelection` reads the last
  layout; if leaf text changed between the selection and the copy (a
  re-rendered `input` value, say), the copy is the new text — the
  browser's own copy would be too. Noted in the spec if it ever shows.
- **happy-dom Range coverage**: the phase-2 tests lean on
  `Range.intersectsNode`/`compareBoundaryPoints`; if happy-dom lacks
  one, the serializer's intersection test is written over
  `compareDocumentPosition` of the boundary containers plus offsets
  (which it does have), not skipped in Node.
- **Cost**: gestures are per click; `charSource` adds runs
  proportional to text nodes per leaf build; the copy listener does one
  composed-range classification per copy and nothing more for grid
  selections.
