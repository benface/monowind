# Focus navigation implementation plan

Status: **proposed** (2026-09-04). Spec: `.agents/specs/focus-navigation.md`
(normative; this plan only sequences it). Ships as its own patch after
the host-as-a-leaf work (`2026-09-04-host-leaf.md`).

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. `focus.ts` — the pure part

- `nextFocus(direction, current: Rect, candidates: { rect: Rect; element:
Element }[]): Element | null` per the spec's rule: beyond-the-edge
  filter, primary distance, cross-axis overlap, cross-axis distance,
  document order (candidates arrive in tree order).
- `focusableRects(root: LayoutNode): { rect; element }[]` — a full
  walk of the layout tree with scroll offsets applied (the paint walk's
  descent, `tableHidden` skipped), keeping nodes whose `source` has
  `tabIndex >= 0` and is neither `disabled` nor `inert`; rects are
  painted border-box cells, in tree order.
- `arrowIsNative(element, key)`: the control rules from the spec
  (textual inputs keep Left/Right; textarea, contenteditable, radios,
  listbox selects, and non-textual inputs keep all; a single-choice
  select keeps all while `:open`).
- Tests (`focus.test.ts`, Node): the four directions on a hand-built
  layout; the beyond-the-edge filter (a box overlapping the focused
  row is not "below"); overlap beating a nearer offset box only on
  equal distance; document-order tie; no candidate; `arrowIsNative` per
  element kind (happy-dom elements).

### 2. Element plumbing

- `observedAttributes` gains `"focus"`; `DEFAULT_FOCUS = "tab"`,
  reflected on connect and on an unrecognized value with the same
  warning shape as `select`.
- `keydown` listener on the host (the existing DYNAMIC_RELAYOUT
  `keydown` stays separate): return unless `focus="arrows"`, an arrow
  key, no modifier, and a focused element inside the host whose arrow
  is not native. Find its rect and the candidates from the last layout
  (a focused element with no layout node → return), pick with
  `nextFocus`; on a hit: `preventDefault()`, `target.focus({
preventScroll: true })`, `target.scrollIntoView({ block: "nearest",
inline: "nearest" })`.
- Reuse `#openSelectPicker` for the select rule.

### 3. Story, docs, release

- `focus.stories.ts` (hidden, `Test / Focus`): a `focus="arrows"` host
  laid out as a 2×3 button grid beside a column with a text input, a
  textarea, a select, and a scroll container holding buttons below the
  fold; the play focuses elements and dispatches `keydown` on them,
  asserting `document.activeElement` per the spec's rules (including a
  radio group, a listbox select, and a contenteditable staying native)
  and that Down into the scroll container raises its `scrollTop`; a
  default host in the same story ignores arrows. All three engines.
- Playground: an "arrow-key focus" checkbox beside "select text only",
  wired the same way (`focus="arrows"` on the sample host, persisted as
  a `focus` query parameter and restored on load); `smoke.test.mjs`
  asserts it like the select-mode checkbox (checked → attribute →
  query → restored).
- README: a "Keyboard focus" section after "Selection"; spec status →
  implemented; `.agents/specs/cell-model.md` Selection already carries
  the padding rule.
- Version: next patch in the final commit; release notes cover the
  touch-selection fix, the padded rows (already landed), and
  `focus="arrows"`.

## Risks

- **`scrollIntoView` inside a scroll container during a live grid
  press**: none — navigation is keyboard-driven, no press is held.
- **Focus inside a leaf renderer's shadow** (a future interactive leaf):
  the handler sees no layout node and leaves the arrow native.
