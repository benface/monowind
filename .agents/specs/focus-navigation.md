# Focus navigation (`focus="arrows"`)

Status: **proposed** (2026-09-04) — spec first, implementation to follow.

## Why

A terminal UI moves focus with the arrow keys: Down goes to the field
below, Right to the button beside. On the web only Tab moves focus, in
DOM order. The engine already knows where every box sits in cells, which
is the hard part of spatial navigation, so a `<mono-wind>` can offer
arrow-key focus as an opt-in on top of Tab.

## Locked decisions

- **Opt-in through a host attribute, reflected like `select`.**
  `focus="tab"` (the default, written onto the attribute when absent or
  unrecognized, so every consumer keys on an explicit value) leaves
  keyboard focus entirely to the browser. `focus="arrows"` adds arrow-key
  navigation; Tab and Shift+Tab keep their native order alongside it.
- **Spatial, from the engine's geometry.** From the focused element,
  an arrow moves focus to the nearest focusable element in that
  direction, judged on painted cells (scroll offsets applied, as
  hit-testing does): a candidate must lie entirely beyond the focused
  box's edge in the arrow's direction (Down: its first row below the
  focused box's last row; Right: its first column past the focused
  box's last column; mirrored for Up and Left). Among
  candidates, the smallest edge-to-edge distance along the arrow's axis
  wins; ties prefer a box whose extent overlaps the focused box across
  the other axis, then the smaller cross-axis distance, then document
  order. No candidate → focus stays; nothing wraps (terminals don't).
- **Focusable means focusable to the browser.** Candidates are the
  host's laid-out elements whose `tabIndex` is non-negative — the DOM's
  own answer, which covers `a[href]`, `button`, form controls,
  `summary`, `contenteditable`, and authored `tabindex` alike, and is
  `-1` for everything else — minus `disabled` and `inert` ones, hidden
  ones (no laid-out box), and the focused element itself. Same set Tab
  visits; the engine invents no focusability.
- **Controls keep the arrows they use.** Inside an `<input>` of a
  textual type (text, search, url, tel, email, password, or no type),
  Left and Right stay the caret's; Up and Down navigate. All four
  arrows stay native inside a `<textarea>` or a `contenteditable`
  (they move the caret between lines), on a radio button (the group
  moves its own checked state with arrows — an accessibility contract),
  on a `<select multiple>` or one with `size > 1` (a listbox), and on
  inputs of other types (`number`, `range`, `date`, `color`, …), whose
  arrows have meaning. A single-choice `<select>` keeps every arrow
  while its picker is open and navigates on every arrow while closed —
  TUI dialogs open a list with Space or Enter and move between fields
  with arrows; the native "change the value with Up/Down while closed"
  is the surprise here. Any modifier (Shift, Alt, Ctrl, Meta) makes an
  arrow native — Shift+Arrow is selection.
- **The target is revealed.** Focus moves with `focus({ preventScroll:
true })` followed by `scrollIntoView({ block: "nearest", inline:
"nearest" })`, so a scroll container (native scrolling, mirrored on
  the grid — specs/scrolling.md) and the page bring the element into
  view the way a terminal keeps its cursor on screen.
- **Only while focus is inside the host.** The engine listens for
  `keydown` on the host: an arrow reaching it has a focused descendant.
  A navigated arrow is `preventDefault()`ed; an arrow the engine leaves
  native is not touched at all. The synthesized focus invert
  (cell-model.md) shows the result, as it does for Tab.

## Mechanics

- Attribute plumbing mirrors `select`: `observedAttributes`, a
  `DEFAULT_FOCUS`, reflection on connect and on an unrecognized value
  (with the same warning shape).
- `keydown` handler: ignore unless `focus="arrows"`, the key is an
  arrow, and no modifier is held. The focused element is the event's
  target (a control inside a nested shadow root arrives retargeted to
  its light host, which is the laid-out element anyway). Decide
  "native" by that element's kind (above) before doing any geometry.
- Candidates and rects come from the last layout: a full walk with
  scroll offsets applied (as the paint walk descends), keeping nodes
  whose `source` is focusable per the rule above; the focused
  element's own rect from the same walk. A focused element the
  layout does not know (focus inside a leaf renderer's shadow, say) →
  native.
- Selection of the target is a pure function
  `nextFocus(direction, current: Rect, candidates: { rect, element }[])`
  in a new `packages/core/src/focus.ts`, testable in Node; the
  element handler is plumbing around it.

## Deviations (documented, like the cell model's running list)

- **No wrapping** at the host's edges, and no movement across hosts:
  a page with two `<mono-wind>`s navigates within the focused one.
- **A closed single-choice `<select>` navigates on every arrow** instead
  of changing its value (Space/Enter open it; the picker keeps the
  arrows).
- **Geometry, not DOM order**: Tab and arrows can disagree about
  "next", as they do in any spatially navigated UI.
- **Overlapping candidates** (positioned boxes stacked on one another)
  resolve by the distance rule alone; the engine does not consult paint
  order for focus.

## Testing

- Node (`focus.test.ts`): the direction rule and the tie-breaks on
  hand-built rects — nearest wins, overlap beats a nearer-but-offset
  box only on equal distance, no candidate behind the edge, document
  order as the last tie-break.
- Storybook, hidden: a `focus="arrows"` host with a grid of buttons, a
  text input, a textarea, a select, and a button inside a scroll
  container; `keydown` events on the focused element move
  `document.activeElement` as the rules say (Down from the input
  navigates, Right in it stays; a textarea keeps all four; a select
  closed navigates; a modifier stays native; Down into the scroll
  container scrolls it — `scrollTop` grows); the default host ignores
  arrows, and both hosts keep Tab. Runs in all three engines.
- Visual: none.
