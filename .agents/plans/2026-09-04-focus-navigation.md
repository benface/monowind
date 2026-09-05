# Focus navigation implementation plan

Status: **done** (2026-09-04). Spec: `.agents/specs/focus-navigation.md`
(normative; this plan only sequences it). Ships as its own patch after
the host-as-a-leaf work (`2026-09-04-host-leaf.md`).

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. `focus.ts` — the pure part

- `nextFocus(direction, current: Rect, candidates: { rect: Rect; element:
Element }[]): Element | null` per the spec's rule: beyond-the-edge
  filter, cross-axis overlap first, then primary distance, cross-axis gap,
  document order (candidates arrive in tree order).
- `focusableRects(root: LayoutNode): { rect; element }[]` — a full
  walk of the layout tree with scroll offsets applied (the paint walk's
  descent, `tableHidden` skipped), keeping nodes whose `source` is
  focusable — `tabIndex >= 0`, not `disabled`, no `[inert]` ancestor
  (`closest`) — at their painted border-box cells, plus each text
  leaf's focusable inline elements, one rect per line they cover
  (`forEachLeafCell` + `charInline`, exported from plain-text.ts as
  `inlineElementRects` or reused directly); tree order, the root
  included when it is a leaf (host-leaf.md).
- `arrowIsNative(element, key)`: the control rules from the spec
  (textual inputs keep Left/Right; textarea, contenteditable, radios,
  listbox selects, and non-textual inputs keep all; a single-choice
  select keeps all while `:open`).
- Tests (`focus.test.ts`, Node): the four directions on a hand-built
  layout; the beyond-the-edge filter (a box overlapping the focused
  row is not "below"); an aligned box beating a nearer offset one;
  document-order tie; no candidate; `focusableRects`
  per the spec's list (a built tree in happy-dom: laid-out button,
  atomic box, links in a wrapped paragraph, disabled and inert skipped,
  a scrolled child's shifted cells); `arrowIsNative` per element kind.

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
  laid out as a 2×3 button grid beside a column with a paragraph of
  links (two on one line, one wrapped to the next), a text input, a
  textarea, a select, and a scroll container holding a list of buttons
  past the fold; the play focuses elements and dispatches `keydown` on
  them, asserting `document.activeElement` per the spec's rules
  (including a radio group, a listbox select, and a contenteditable
  staying native) and that Down from the list's last visible button
  reaches the next and raises `scrollTop`; a default host in the same
  story ignores arrows. All three engines.
- Playground: an "arrow-key focus" checkbox beside "select text only"
  (both in an options popover behind one header button), wired the
  same way (`focus="arrows"` on the sample host, persisted as a `focus`
  query parameter and restored on load); `smoke.test.mjs` asserts it
  like the select-mode checkbox (checked → attribute → query →
  restored).
- README: a "Keyboard focus" section after "Selection"; spec status →
  implemented; `.agents/specs/cell-model.md` Selection already carries
  the padding rule.
- Version: the next patch's bump is the user's call; its release notes
  cover everything since v0.2.6 — the touch-selection fix, full-width
  rows, the playground editor fill, the empty-host fix, the host as a
  leaf, and `focus="arrows"`.

## Risks

- **`scrollIntoView` inside a scroll container during a live grid
  press**: none — navigation is keyboard-driven, no press is held.
- **Focus inside a leaf renderer's shadow** (a future interactive leaf):
  the handler sees no layout node and leaves the arrow native.
