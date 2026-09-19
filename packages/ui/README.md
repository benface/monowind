# @monowind/ui

Accessible components on the [monowind](https://github.com/benface/monowind)
grid: a menu, a dialog, a popover, and a tooltip, each a
[Zag.js](https://zagjs.com) state machine wired to the engine. Zag runs
the roles and states, the keyboard, typeahead, focus trapping and
restore, dismissal, and submenus; the engine places each floating part
against its trigger in cells, in the top layer, above everything and
outside any scroller it opened from. Headless: no classes, no
stylesheet — you style the parts with Tailwind and monowind classes, and
a component styled through the theme's tokens wears whatever theme its
host does.

```html
<mono-wind>
  <div id="file-menu">
    <button data-part="trigger" class="border px-1">File</button>
    <div data-part="positioner" popover="manual">
      <div data-part="content" class="border bg-clear">
        <div
          data-part="item"
          data-value="new"
          class="px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)"
        >
          New
        </div>
        <div
          data-part="item"
          data-value="open"
          class="px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)"
        >
          Open…
        </div>
      </div>
    </div>
  </div>
</mono-wind>
```

```ts
import { menu } from "@monowind/ui/menu";

menu(document.getElementById("file-menu")!, { id: "file" });
```

## Setup, by integration

**Vanilla, or a framework without a Zag adapter** — mark the parts
with `data-part` and mount the component on their root: `menu(root,
props)`, `dialog(root, props)`, `popover(root, props)`, `tooltip(root,
props)`. `props` are Zag's machine props (`id` required). Each returns
the live `api` and a `destroy()`. The parts are found once, at the
mount: for markup that changes, destroy and mount again. Give the
positioner `popover="manual"` in the markup, as above: the mount sets
it, but a page parsed before the script runs would show the content in
flow until then.

**React, Vue, or Svelte** — `@monowind/ui-react`, `@monowind/ui-vue`,
and `@monowind/ui-svelte` fold Zag's adapter in: one hook, composable,
or function per component, the positioner's top layer handled inside
(see their READMEs).

**Another framework Zag supports (Solid 1, Preact)** — use Zag's
adapter as you would, on this package's entry alone: `props()` gives
the machine its props with the grid's positioning, `machine` is Zag's,
and `connect()` is Zag's with the grid's props on the trigger, the
positioner, and the content. Spread them as Zag's docs show; here with
React's adapter, which the React package wraps:

```tsx
import { normalizeProps, useMachine } from "@zag-js/react";
import * as menu from "@monowind/ui/menu";
import { useId } from "react";

function FileMenu() {
  const gridProps = menu.props({ id: useId(), positioning: { placement: "bottom-start" } });
  const service = useMachine(menu.machine, gridProps);
  const api = menu.connect(service, normalizeProps, gridProps);
  return (
    <>
      <button {...api.getTriggerProps()}>File</button>
      <div {...api.getPositionerProps()}>
        <div {...api.getContentProps()}>
          <div {...api.getItemProps({ value: "new" })}>New</div>
        </div>
      </div>
    </>
  );
}
```

An API you connected yourself takes the same props through
`api(zagApi, normalizeProps, gridProps)`. A menu with several triggers
(Zag's `getTriggerProps({ value })`; in markup, each `trigger` with its
`data-value`) anchors its positioner to the one the machine's
`triggerValue` names.

**CDN, no build** — one script after monowind's, then `monowind.ui`:

```html
<script src="https://unpkg.com/monowind/dist/cdn.js"></script>
<script src="https://unpkg.com/@monowind/ui/dist/cdn.js"></script>
<script>
  monowind.ui.menu(document.getElementById("file-menu"), { id: "file" });
</script>
```

## The parts

Zag's anatomy, marked `data-part` on ordinary elements: `trigger`,
`positioner`, `content`, and per component the menu's `item` (its
`data-value`), `item-group` and `item-group-label` (their `data-value`
the group's id), `separator`, and for a submenu a `trigger-item`
followed by its `submenu` root (its `data-value` naming the submenu),
mounted as a menu of its own on the parent's behavior props —
`onSelect`, `closeOnSelect`, `loopFocus`, `typeahead`, `composite`,
`navigate`, `dir`, `getRootNode`; the popover's and the dialog's
`title`, `description`, and `close-trigger`. A `data-disabled` on an
item disables it.

States are attributes Zag sets — `data-state`, `data-highlighted`,
`data-disabled`, `data-placement` — so `data-highlighted:bg-(--mw-fg)`
styles a highlighted item, and an enter or exit is a transition on
`data-state`: `transition-opacity data-[state=closed]:opacity-0
starting:opacity-0` on the content fades it both ways, the engine
sampling it. The engine writes the area a floating part took as
`data-mw-area` (`span-right bottom`, `span-right top` after a flip).

## Placement

`positioning.placement` is Zag's (`bottom-start`, `top`, `right-end`,
…), mapped to a `position-area` the engine places the part in against
its trigger; when the part would overflow the host, it flips (block,
inline, then both), and the engine writes the area taken as
`data-mw-area`, Zag's `data-placement` staying the placement asked
for. Zag's own pixel positioning is off; the light element sits on the
cells the grid shows it on, so native clicks and focus land there.

`positioning.gutter` (or `offset.mainAxis`), the gap to the trigger,
and `positioning.offset.crossAxis`, the shift along it from the edge
the part aligns to (from its center for a placement without `-start`
or `-end`), count cells here — the same props in every integration,
`menu(root, { id, positioning: { gutter: 1 } })` as `useMenu({ id,
positioning: { gutter: 1 } })` — and become margins on the positioner,
on the anchor's side and the aligned edge's, which the engine mirrors
with a flip: `offset: { crossAxis: -1 }` puts a submenu's first item
level with the item that opened it, past the submenu's border, and a
flip upward puts its last item there. A margin utility on a positioner
is the same margin (`mt-1` under a trigger is a gap, `-mt-1` on a
submenu's positioner that shift, `ml-1` its gap), the route for a
vanilla submenu, whose positioning the mount sets. A submenu on the
framework path names its placement, `right-start` (`left-start` in a
right-to-left menu).

A positioner is a surface in the host's colors by default (the
engine's, in place of the browser's canvas colors); `bg-clear` on the
content cuts the grid's cells beneath it out instead, showing what
lies behind the host through it. The dialog's positioner is centered
by the platform and carries the `::backdrop` (`backdrop:bg-black/50`),
which the engine draws beneath it; without the class the backdrop is
invisible and the dialog still modal, Zag's trap and `aria-hidden`
being its own.

## Components

Each entry exports the mount, `machine`, `connect`, `props`, and
`api`, with Zag's `Props`, `Api`, and `Service` types and `GridProps`,
`props()`'s return.

- `@monowind/ui/menu` — Zag's menu: items, groups, separators,
  submenus, typeahead, `onSelect`.
- `@monowind/ui/dialog` — Zag's dialog: focus trap, the page hidden
  from assistive technology, Escape and outside click.
- `@monowind/ui/popover` — Zag's popover.
- `@monowind/ui/tooltip` — Zag's tooltip; `openDelay` and `closeDelay`
  are its.

`@monowind/ui/top-layer`'s `syncTopLayer(positioner, open)` keeps a
positioner in the top layer while the machine is open and through its
exit, blurring a focused element inside it as the machine closes; the
vanilla path calls it, and a framework runs it after commit where it
renders the parts itself. Its `Component` and `Anchored` types
are the shape of an entry, which the framework packages build on.
