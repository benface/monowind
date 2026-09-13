# Spec: `@monowind/ui` — accessible components on the grid

Status: **proposed** (2026-09-13). The engine features it needs are
`top-layer.md` and `anchor-positioning.md`; motion is `animations.md`.

## Motivation

A menu, a dialog, a popover, a tooltip: every application needs them,
and doing them accessibly — roles and states, roving focus, typeahead,
focus trapping and restore, dismissal, nested menus — is where most
hand-rolled components fail. monowind is a custom element that renders
whatever DOM it holds, so its components must be framework-agnostic
and must be plain light DOM. Zag.js is both: state machines per
widget, framework adapters over them (React, Vue, Solid, Svelte, and
vanilla), used by Ark UI and Chakra, covering the accessibility
patterns in depth. `@monowind/ui` is Zag's machines wired to the grid:
the engine places and layers the parts, Zag runs them.

## Shape

- **One package, a subpath per component**: `@monowind/ui/menu`,
  `@monowind/ui/dialog`, `@monowind/ui/popover`, `@monowind/ui/tooltip`
  first; `select`, `combobox`, `tabs` and the rest follow the same
  shape. Versioned in lockstep with `monowind`.
- **A core that touches no DOM**: per component, a function that
  takes Zag's connected API and returns the same API with monowind's
  part props — the trigger's `anchor-name`, the positioner's
  `position-anchor`, `position-area`, and `popover="manual"` — so any
  Zag adapter spreads them in its own idiom: `@zag-js/react`'s `useMachine` and JSX spreads, Vue's,
  Solid's, Svelte's, and Ark UI's components. One effect beside it,
  `syncTopLayer(positioner, open)`, shows the positioner's popover as
  the machine opens and hides it once the closed state's transitions
  and animations under it have finished; a framework runs it after
  commit, as it runs any DOM effect. The package depends on Zag
  alone: it speaks the CSS and the attributes the engine reads, and
  imports nothing from `monowind`.
- **Headless.** A component is behavior, not looks: the library owns
  the functionality, the keyboard and pointer usability, and the
  accessibility of every part, and ships no classes and no
  stylesheet; the author styles each part with Tailwind and monowind
  classes. The parts are Zag's anatomy — `trigger`, `positioner`,
  `content`, `item`, `item-group`, `separator`, and so on per
  component — marked `data-part` on ordinary elements.
- **A vanilla path for markup without a framework**: `menu(root,
props)` is the core plus `VanillaMachine` and `spreadProps`: parts
  found by `data-part` under the root, items and groups by their
  `data-value`, attributes and handlers re-applied on every state
  change; it returns the API and a `destroy`.
- **States are attributes**: `data-state`, `data-highlighted`,
  `data-disabled`, `data-placement`, as Zag sets them, so an author
  styles them with Tailwind's data variants
  (`data-[highlighted]:bg-neutral-700`) and the engine reads the
  computed result.

## Locked decisions

- **The engine positions, Zag does not.** Every floating part is an
  anchored box (anchor-positioning.md): the trigger gets an
  `anchor-name`, the positioner a `position-anchor`, a
  `position-area` mapped from Zag's placement (`bottom-start` is
  `bottom span-right`, `bottom-end` `bottom span-left`, `right-start`
  `right span-bottom`, and so on), and `position-try-fallbacks:
flip-block, flip-inline, flip-block flip-inline`; the gutter is a
  margin in cells. Zag's positioning runs with `applyStyles: false`
  and `flip: false`, its pixel result unused and its `data-placement`
  the placement asked for; the engine's flip shows as `data-mw-area`
  (anchor-positioning.md).
- **Floating parts live in the top layer.** The positioner carries
  `popover="manual"`; `syncTopLayer` shows it as the machine opens
  and hides it once the exit completes, so it paints last and unclipped
  (top-layer.md) and escapes any scroller it was opened from. Zag
  keeps its own dismissal, focus, and inertness (`manual` gives the
  popover none of the UA's).
- **A dialog's backdrop is the `::backdrop`.** The dialog's positioner
  is the top-layer element and styles its backdrop with Tailwind's
  `backdrop:` variant; the engine tints the page under it
  (top-layer.md), and Zag's `backdrop` part goes unused. Zag's dialog
  machine keeps the focus trap, scroll lock, `aria-hidden` on the
  rest, Escape, and outside click.
- **Enter and exit are transitions on `data-state`.** An author
  gives the content `transition-*` classes with its closed look under
  `data-[state=closed]:` (`opacity-0`, `scale-95`) and its entering
  look under `starting:` (Tailwind's `@starting-style` variant), so
  the platform runs the enter as the state turns open and the exit as
  it turns closed, and the engine samples both as it samples any
  transition — a scaling dialog on its layer, a fading menu repainted.
  The positioner stays in the top layer until the exit has finished
  (`syncTopLayer`), so no discrete `display` transition is needed
  (top-layer.md deviation 4) and no keyframes: an author who wants a
  keyframe enter or exit instead animates the same states, and Zag's
  presence, which waits on `animation-name`, serves a framework that
  unmounts closed parts.
- **Accessibility is Zag's, verified on the grid.** Roles, ARIA
  states, keyboard maps, typeahead, roving tabindex, nested menus,
  and focus management come from the machines unchanged; the stories
  assert them through the light DOM, where assistive technology reads
  them.
- **The examples style through the theme's tokens.** The stories and
  the docs show each component styled, and their classes are the
  theme contract's (theming.md) — `bg-(--mw-bg)`, `text-(--mw-fg)`,
  the `--mw-ansi-*` colors for emphasis, borders in `currentColor` —
  so a component styled that way wears whatever theme its host does,
  shipped or custom, and draws its borders in the host's glyph set.
- **State flows as Zag's does.** Every component takes Zag's
  controlled and uncontrolled props unchanged — `open` and
  `defaultOpen` with `onOpenChange`, `highlightedValue`, `ids` for
  composition, an `id` per instance (`useId()` in React) that also
  names the anchor — and adds no state of its own: the monowind props
  derive from the API's `open` and `placement`.

## Testing

- Node: the placement mapping to `position-area`; the vanilla path's
  parts found and wired; the show and hide of the positioner around
  the exit's transitions; a React smoke test of the core through
  `@zag-js/react` and `react-dom`, proving the framework path.
- Storybook, per component, in every engine: open and close by
  pointer and keyboard; the floating part's cells directly under (or
  beside, above) the trigger and the light element's box on them; a
  flip at the host's edge; the part above a later sibling and outside
  the scroller it was opened from; Escape, outside click, and focus
  restore; roving focus, typeahead, and a submenu for the menu; the
  focus trap and the tinted page for the dialog; the enter and exit
  animations sampled to their ends.
- Visual: a golden of each component open.

## Touch points on implementation

- `packages/ui`: the package, `@zag-js/vanilla` and the machines as
  dependencies at their latest versions, `@zag-js/react` with `react`
  and `react-dom` for the smoke test, one entry per component.
- storybook: a `Components` section, one story file per component.
- playground: the sample gains a menu and a dialog.
- README: the components paragraph.
