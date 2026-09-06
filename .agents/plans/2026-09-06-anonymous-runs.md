# Anonymous runs implementation plan

Status: **implemented** (2026-09-06). Spec: `.agents/specs/cell-model.md`
"Inline content" (normative; this plan only sequences it), with
`.agents/specs/host-leaf.md` for the host. Replaces cell-model
deviation 7 (text next to block children was dropped and warned) with
CSS's anonymous block boxes, and drops the dropped-text machinery.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. The tree: anonymous run leaves

- `tree.ts`: a container whose in-flow child nodes mix inline content
  (non-whitespace text, inline and atomic-inline elements) with
  block-level elements builds one anonymous leaf per maximal run of
  consecutive inline-level nodes, through `buildLeaf` over exactly
  those nodes with `source` the container and `anonymous: true`, styled
  by the container's text properties alone (`leafStyleOf`: text
  properties, leading, tracking, and paint, shared with the root leaf;
  the host's runs take the root leaf's style, `hostLeafStyle`, with
  no tracking or gap). Whitespace-only text
  between blocks forms no run; out-of-flow elements in a run are the
  run's positioned children as in any leaf. Blocks and runs keep
  document order in `children`.
- `element.ts` `#buildRootContainer`: the same over the host's child
  nodes (the probe excluded).
- Remove `hasDirectText`'s dropped-text use, `flagDroppedText`,
  `DIRECT_TEXT_DROPPED`, `LayoutNode.droppedText`, the renderer's
  `data-mw-dropped-text` flag, its rules in `styles.css` and the
  shadow's slot rule.
- Node tests (`tree.test.ts`, `anonymous-runs.test.ts`): text before,
  between, and after block children; an inline element and an atomic
  box inside a run, a lone atomic box as a run; an out-of-flow element
  in a run; whitespace-only text forming no run; the host's own text
  beside a block child in the root leaf's style; a flex container's
  runs as items; a mixed multicol container; nested mixed containers
  and a mixed scroller; the transcript (`renderPlainText`) in document
  order; a positioned container's `--mw-z` kept beside its runs; stray
  text in a div-table hidden through its container
  (`data-mw-hidden-runs`, `table.test.ts`).

### 2. Native placement: flow children

- `layout.ts` `layoutBlock`: when the container holds an anonymous run,
  every in-flow block child gets `flow` margins — top from the engine's
  y against a native cursor that advances by a run's native line boxes
  (`lines × (1 + lineGap)` rows) and by a child's engine height, plus
  half the leading on the first child (the container's half-leading
  translate shifts its content); left from the child's x against the
  content box. Reset per pass with the multicol flags.
- `render.ts`: a `flow` child gets `data-mw-flow` and the margin vars
  instead of `data-mw-laid-out`; an anonymous run writes nothing to
  the DOM (its inline elements, boxes, and out-of-flow children render
  as any leaf's).
- `styles.css`: `[data-mw-flow]` — `position: static`, the shared
  engine geometry, the margin vars, text-indent — modeled on the
  multicol spanner rule.
- Consumers of `source`: `selection.ts` decides whether a leaf holds a
  range endpoint by the run's own nodes (`runNodes`: text nodes, inline
  elements, children) or the container itself, not by
  `source.contains`, and gives a run in a `<p>` one break; `pointer.ts`
  skips anonymous nodes in the hit chain (the container is already in
  it); `focus.ts` skips them; the paragraph gesture on a run is the
  run's extent (`#leafContents`); `render.ts` leaves a run's container
  `--mw-z` alone and marks a mixed host as a leaf (`markRoot`) so the
  host locks cover its runs.
- Margins: a flow child is its own formatting context
  (`contain: layout`) and the shadow slot one for the host's, so first
  children's top margins stay inside as the engine placed them.
- Node tests: flow margins for text-first, text-between, text-last and
  a `leading-*` container; selection ranges and copy across an
  anonymous run and its neighbors, inside a run's out-of-flow child,
  and from a point on the container; a run's paragraph extent; the hit
  chain over a mixed container.

### 3. Storybook and docs

- `Test / Host`: the mixed host lays out its text (the dropped-text
  assertions inverted); a visible `Features / Typography / Anonymous
Runs` story with text before, between, and after a block, a link in
  a run — once plain in the container's color, once under
  `leading-loose` with every run and the block wrapping — asserting
  the grid text, the run's paint, the browser's line boxes over the
  runs' and the block's text on the engine's rows (each wrapped line a
  gap row down), the block's native height, and the link's native box
  on its cells, in three engines; its golden in the sweep. A mixed flex
  and grid container probed with a throwaway fixture in three engines:
  the first run's native text on its cells, later runs off them
  (deviation 7), the grid right. `Test / Host` also covers the host
  locked as a leaf, a triple-click on its run, and first-child top
  margins (the host's, a flow child's own) landing natively.
- Along the way: a multi-click gesture the engine takes over now
  cancels the `mouseup` too, since Chromium and WebKit collapse a
  selection the press landed in on release (semantic-selection.md,
  `visual/selection.spec.ts` with a real mouse, a plain click still
  collapsing).
- Specs: cell-model.md "Inline content" and deviation 7; host-leaf.md
  status, decision, deviation, testing, and the deferred section
  resolved; semantic-selection.md's leaf definition.
- README: the mixed-content warning no longer exists; nothing to add.
