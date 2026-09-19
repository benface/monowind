# Spec: top layer — popovers and modal dialogs

Status: **implemented** (2026-09-13; `top-layer.ts` keeps the stack,
`style.ts` reads the membership and the UA geometry, `plain-text.ts`
and `pointer.ts` take the stack after the tree, `render.ts` places the
light elements in the viewport). Positioning rules live in
`positioning.md` (`fixed` anchors to the host); anchored placement in
`anchor-positioning.md`; the sampling of transitions and animations in
`cell-model.md` "Animation" and `animations.md`; the components that
build on this in `ui.md`.

## Motivation

A menu, a tooltip, a dialog: the platform's top layer is how they
escape their ancestors' clips, stack above everything, and get
dismiss, focus, and inertness for free — `popover` and
`<dialog>.showModal()` are Baseline. Inside a host the light elements
already do all of that natively, but the grid knows nothing of the
top layer: a popover's opening changes no attribute the host
observes, so the grid never shows it; when it does lay out, it paints
in DOM order under later siblings and clipped by its scroller; the
`::backdrop` never shows; and the measuring passes cancel the
discrete `display` transition an exit animation rides on.

## Reading

Per element during the measure pass, `el.matches(":popover-open,
:modal")` marks a **top-layer element**; a non-modal `dialog[open]`
is in flow, as in CSS. The platform's other two top-layer entries — a
fullscreen element and a customizable `<select>`'s picker — are not
read (Deviations). The UA's own geometry for the element is the
reader's default: an inset that reads `auto` is 0, a size that reads
`auto` is `fit-content`, and the margins are `auto` unless a class or
the inline style sets them — the browsers resolve the UA's `auto`
margins to used pixels, and Firefox exposes no computed insets to the
class-and-inline read (probed 2026-09-13), so the cascade cannot
supply them. Its `::backdrop`'s computed
`background-color`, `background-image`, `backdrop-filter`, and
`opacity` (`getComputedStyle(el, "::backdrop")`) are the **backdrop**,
none when nothing of them shows; the companion locks the native
backdrop transparent outside `[measuring]`, as it locks the light
elements' backgrounds, so the page is dimmed once, by the grid's box.

The host listens to `toggle` in the capture phase (the event bubbles
from neither popovers nor dialogs; every engine dispatches it for
both): an `open` records the element at the end of the host's
**top-layer stack**, and either state schedules a layout. Elements
found open at a layout without a record — those open before the host
connected — join the stack in tree order.

## Locked decisions

- **A top-layer element lays out as a fixed box in the host.** Its
  containing block is the host's content box, as for `fixed`
  (positioning.md deviation 1), its position and size the UA's unless
  the author overrides them: `inset: 0` with `fit-content` sizes and
  `auto` margins, which centers a dialog or a plain popover in the
  host (the layout's auto-margin centering, positioning.md), and an
  anchored placement where `position-area` names one
  (anchor-positioning.md). Nothing about its subtree changes: it is
  laid out and painted like any box of the host, scrolls inside it,
  opens layers, holds its own scrollers.
- **The stack paints last, in the order elements entered it.** After
  the rest of the host has painted, each element of the stack paints
  its subtree over the grid in stack order, in host coordinates,
  clipped and moved by nothing of its ancestors — not their
  `overflow` and scroll, as a `fixed` box escapes them
  (positioning.md), and not a layer root's transform above it either
  (it paints on the main grid, as CSS renders it outside its
  ancestors' transforms) — so a menu opened from inside a scrolling
  list paints whole above the list, and a dialog opened from inside
  it above the menu. Each element of the stack, and its backdrop, is
  a stacking context of its own: its `z-index` orders nothing outside
  it. Later ink covers as always: a top-layer element over a layer
  blanks the layer's cells it lands on (layers.md), and a layer root
  inside the top-layer element opens its layer in stack position,
  above every layer beneath.
- **The backdrop is a box the browser draws.** A top-layer element
  with a backdrop paints as a layer root (layers.md): its cells go to
  a box of its own in the shadow viewport, and a backdrop box just
  beneath it, covering the grid, takes the `::backdrop`'s computed
  background, image, filter, and opacity, so `backdrop:bg-black/50`
  dims the page as CSS does, `backdrop:backdrop-blur-sm` blurs it,
  and a gradient shows; the element's cells, its transparent ones
  included, show the backdrop through them. The page's cells stay as
  painted, and a later element of the stack, its own backdrop over
  this one's box, stacks above as CSS stacks them. An element without
  a backdrop paints on the main grid like any later ink.
- **An element stays in the stack until it is no longer displayed.**
  Membership is entered through `:popover-open` or `:modal` and left
  through `display: none`, so a popover whose exit rides a discrete
  `display` transition keeps painting last through its exit, in every
  engine alike, whether or not the engine honours `overlay`. The
  companion's transition mask under `[measuring]` and `[settling]`
  keeps `display` and `overlay` in the list for popovers and dialogs
  — for them alone: the engine's own `display` toggle under
  `[measuring]`, the grid-template read assist, must start no
  transition elsewhere — so the measuring passes leave the discrete
  transition running, and a `transitionend` or `transitioncancel` of
  either lands its state with a layout, as an animation's end does
  (animations.md).
- **The pointer sees the stack.** The engine's own hit-testing —
  text-mode drags, the semantic gestures, the synthesized pointer
  states — takes a point through the stack from the top before the
  grid beneath, on the paint order, so a drag over a menu selects the
  menu's text. Native hit-testing on the light elements already does:
  a modal dialog's backdrop makes the rest inert, a popover's leaves
  it reachable for light dismiss.
- **Everything else is the platform's.** Focus trapping, focus
  restore, Escape, light dismiss, `popovertarget` and `command`,
  nested popovers, inertness under a modal dialog: the light elements
  do these natively, and the host samples the outcome as it samples
  any state.
- **A top-layer element is a surface of the host's.** The UA gives a
  popover and a dialog the canvas's colors (`Canvas`, `CanvasText`);
  the companion gives them the host's instead, `--mw-bg` and `--mw-fg`
  (theming.md), in its base layer, so a floating part is an opaque box
  in the host's colors unless the author says otherwise — `bg-clear`
  to see what is behind the host through it, any utility to restyle.

## Deviations from CSS (summary)

1. The stack's order is the order of the `toggle` events the host saw,
   elements open before it connected first in tree order; the
   document's own top-layer order is not observable.
2. An element with a backdrop paints in a box of its own, so a
   grid-mode drag across it and the page selects in DOM order
   (layers.md deviation 3); under a modal dialog the page is blocked
   anyway.
3. A top-layer element centers in the host, not the viewport, as
   `fixed` anchors to the host, and its backdrop covers the host's
   grid, not the page.
4. An exit that rides a discrete `display` transition runs where the
   browser runs it (Chromium today; WebKit and Firefox drop the
   display at once, probed 2026-09-13); an exit run while the element
   stays shown — `@monowind/ui` keeps its positioner open until the
   exit's transitions end (ui.md) — runs everywhere.
5. A fullscreen element and a customizable `<select>`'s picker are
   not top-layer elements to the grid: fullscreen takes the light
   element out of the host's rendering, and a select's picker is the
   control's native UI, as its other pickers are.
6. A margin set on a top-layer element by a stylesheet rule reads as
   `auto`: only a class or the inline style overrides the UA's.
7. A modal dialog makes the host's grid inert with the rest of the
   page, as the platform blocks everything outside it: nothing selects,
   hovers, or presses through the grid while it is open. Inside the
   dialog, `select="grid"` falls back to the light DOM as `select="text"`
   has it — its controls take the pointer natively, its text selects
   with the highlight over the grid — so the dialog's cells select as
   text, not as grid ink with its borders. A popover blocks nothing.

## Testing

- Node: the read marking a popover and a modal dialog top-layer, a
  non-modal one in flow; the stack painting after a later sibling
  and outside a scroller's clip, two elements in stack order, a layer
  under and inside a top-layer element; the backdrop box over the
  grid beneath the element's own, its look copied, gone with the
  backdrop; the pointer through the stack; an element leaving the
  stack at `display: none`.
- Storybook: a popover opened by `popovertarget` from inside a
  scrolling list, shown whole above it in every engine; a modal
  dialog centered above its backdrop box, the page inert, its own
  light DOM taking the pointer and the selection in grid mode; a
  nested popover above its parent; a popover with an enter transition
  sampled from `@starting-style` and, in Chromium, an exit through a
  discrete `display` transition painting to its last frame; a
  text-mode drag over a popover selecting its text.
- Visual: goldens of the open dialog and the open popover over the
  list, in every engine.

## Touch points on implementation

- style.ts: `topLayer` and `backdrop` on `CellStyle`; the UA geometry
  of a top-layer box, and of a displayed popover through its exit; a
  backdrop's element a layer root.
- top-layer.ts: the stack (`TopLayer`), ranked by the toggles and
  assigned onto each layout's tree (`topLayerRank`, `root.topLayer`).
- element.ts: the capture-phase `toggle` listener; `display` and
  `overlay` among the landing transitions; the grid's client origin
  written as `--mw-ox`/`--mw-oy` for the light elements' placement; a
  grid-mode press inside a modal dialog taken as text mode's.
- styles.css: `display, overlay` in the transition mask for popovers
  and dialogs; the native `::backdrop` locked transparent outside
  `[measuring]`; a `[data-mw-top]` element placed `fixed` in the
  viewport from the grid's client origin, since the top layer resolves
  against the viewport, not the host; the host's surface on
  `[popover]` and `dialog`, in the base layer.
- positioning.ts: a fixed box's `hostRect`; plain-text.ts `walk` and
  pointer.ts `hitStack`: a fixed box from the host's origin outside
  its ancestors' clips, the stack after the tree; paint.ts: the
  backdrop box beneath a layer's; render.ts: a fixed light element
  taking its ancestors' scroll back through the sticky-shift
  variables.
