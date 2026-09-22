# @monowind/ui

Accessible components on the [monowind](https://github.com/benface/monowind)
grid: a menu, a listbox, a select, a combobox, a dialog, a popover,
and a tooltip,
each a
[Zag.js](https://zagjs.com) state machine wired to the engine. Zag runs
the roles and states, the keyboard, typeahead, focus trapping and
restore, dismissal, and submenus; the engine places each floating part
against its trigger in cells, in the top layer, above everything and
outside any scroller it opened from, and lays a listbox out in the flow
like any other box. Headless: no classes, no
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

**Markup alone** — register the elements once and write
`<mono-menu>`, `<mono-dialog>` and their kin around the parts: each
roots its own mount, its attributes the machine's props and its
callbacks events (see [Elements](#elements)). Any framework can render
them, and the CDN bundle registers them for you.

```ts
import { defineMonoUi } from "@monowind/ui/elements";

defineMonoUi();
```

**Vanilla, or a framework without a Zag adapter** — mark the parts
with `data-part` and mount the component on their root: `menu(root,
props)`, `listbox(root, props)`, `select(root, props)`,
`combobox(root, props)`, `dialog(root, props)`, `popover(root,
props)`, `tooltip(root, props)`. `props` are Zag's machine props
(`id` required; a list's `collection` optional, the marked items
making one). Each returns the live `api`, an `updateProps(partial)`
that merges into them, and a `destroy()`. The parts are found once,
at the mount: for markup that changes, destroy and mount again — a
template that fills the root after handing it over leaves a mount
with nothing to wire, and a development build says so where a list's
collection holds items its markup never marked. Give the positioner
`popover="manual"` in the markup, as above: the mount sets it, but a
page parsed before the script runs would show the content in flow
until then.

**React, Vue, or Svelte** — `@monowind/ui-react`, `@monowind/ui-vue`,
and `@monowind/ui-svelte` fold Zag's adapter in: one hook, composable,
or function per component, the positioner's top layer handled inside
(see their READMEs).

**Solid 2** — the elements, which need no adapter: Zag's own reaches
`solid-js/web`, which Solid 2 no longer exports
([chakra-ui/zag#3211](https://github.com/chakra-ui/zag/issues/3211)).
`apps/example-solid` is built that way. Attributes are the props and
events the callbacks; a listener goes on through a `ref`, this
release candidate compiling `on:itemselect` to a listener for
`":itemselect"`.

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

**CDN, no build** — one script after monowind's. It registers the
elements, so markup alone is enough; `monowind.ui` holds the mounts
for markup you would rather wire yourself:

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

A listbox has no floating part: the element you mount it on is its
`root`, and under it go a `label` and a `content` holding the `item`s,
each with an `item-text` and an `item-indicator` inside it, in
`item-group`s with their `item-group-label`s. Its items are its
collection where the props name none — the `data-value` each carries,
the words of its `item-text`, and `data-disabled` — so a list of static
items is markup alone. `selectionMode: "multiple"` takes several values
at once (`"extended"` for the modifier keys), each keeping its own
indicator. `data-highlight-on-hover` on the root moves the
highlight under the pointer; `data-highlighted` stays the keyboard's
focus, as Zag sets it, so style the pointer's feedback with `hover:`.
An unselected item's indicator is hidden, so a box of its own width
around it keeps the text on its column
(`<span class="inline-block w-2">`), and `overflow-y-auto` with a
`max-h-*` on the content scrolls it, the highlight scrolling into the
content box clear of the border's cells. Its focus shows through that
highlight, the grid drawing no ring around the content: tabbing to it
highlights the selected item, or the first where nothing is selected,
and scrolls to it, so the focus always lands somewhere the reader can
see.

A combobox is a listbox under an input: its `root` holds a `label`
and a `control` with the `input` inside it, a `trigger` beside it and
a `clear-trigger`, then the `positioner` and the `content` of `item`s,
marked as a listbox's, with an optional `list` around them. It anchors
to the `control`, not the trigger, so the list lines up under the
text. Its items are the markup's where the props name none, and
filtering is the page's: give `updateProps` a narrower `collection`
from `onInputValueChange`, and the items outside it are hidden rather
than left standing.

A select is a listbox on a trigger: its `root` holds a `label` and a
`control` with the `trigger` inside it — a `value-text` and an
`indicator` inside that, and a `clear-trigger` beside it — then the
`positioner` and the `content` of `item`s, marked as a listbox's are,
with an optional `list` around them. The markup's own `value-text` is
the placeholder; the mount writes the selection there as it changes.
A select is a trigger and a listbox, not a form control, so a
`<select data-part="hidden-select">` beside it carries the value into
a form under the machine's `name`, and into a reset. The mount fills
it with an option per item and hides it with `display: none` as it
mounts, rather than waiting for Zag's own visually-hidden style,
which arrives a microtask later with the first spread: an in-flow
`<select>` is a box as wide as its longest option, so the grid would
jump. Zag gives it `aria-hidden` and `tabIndex="-1"` either way. With `multiple: true` the trigger names every chosen item
(Zag's `valueAsString`) and the form control carries them all.

States are attributes Zag sets — `data-state`, `data-highlighted`,
`data-disabled`, `data-placement` — so `data-highlighted:bg-(--mw-fg)`
styles a highlighted item, and an enter or exit is a transition on
`data-state`: `transition-opacity data-[state=closed]:opacity-0
starting:opacity-0` on the content fades it both ways, the engine
sampling it. The engine writes the area a floating part took as
`data-mw-area` (`span-right bottom`, `span-right top` after a flip).

## Elements

`defineMonoUi()` registers `<mono-menu>`, `<mono-submenu>`,
`<mono-listbox>`, `<mono-select>`, `<mono-combobox>`,
`<mono-dialog>`, `<mono-popover>` and `<mono-tooltip>`. An element is the root the mount would take, the
parts marked inside it as ever:

```html
<mono-wind>
  <mono-menu placement="bottom-start" gutter="1">
    <button data-part="trigger" class="border px-1">File</button>
    <div data-part="positioner" popover="manual">
      <div data-part="content" class="border bg-clear">
        <div data-part="item" data-value="new" class="px-1">New</div>
        <div data-part="trigger-item" class="px-1">Share ›</div>
        <mono-submenu value="share">
          <div data-part="positioner" popover="manual">
            <div data-part="content" class="border bg-clear">
              <div data-part="item" data-value="mail" class="px-1">Mail</div>
            </div>
          </div>
        </mono-submenu>
      </div>
    </div>
  </mono-menu>
</mono-wind>
```

**Attributes are the props**, kebab-cased: a boolean by presence
(`false` written out turns one off), a number parsed, a string as
written; `placement`, `gutter`, `offset-main-axis` and
`offset-cross-axis` fold into `positioning`, the dialog's
`content-role` is the machine's `role`, the element's own being the
element's, and `aria-label` — which names the content — is written as
Zag spells it. An attribute absent says nothing, so the machine keeps its
default. A change reaches the machine and the parts are spread again.
`id` is optional — one is generated where the markup gives none — and
changing it roots the mount again.

**Callbacks are events** that bubble: the name without `on`, lower
cased as one run (`onOpenChange` is `openchange`, `onValueChange` is
`valuechange`), the argument the `detail`. `onSelect` is `itemselect`,
a native `select` event bubbling from inputs. Where the argument
carries a `preventDefault`, cancelling the event calls it.

**`open` runs both ways**: present at the mount it is the initial
state, set or removed after it opens and closes the component, and the
machine writes it back as the reader opens or dismisses it.

**A prop no attribute carries** — `ids`, `translations`, a menu's
`navigate` and `anchorPoint`, a listbox's and a select's
`collection`, a dialog's `initialFocusEl` — is a property on the
element: `element.ids = {…}`,
or `element.setProp(name, value)` by name. `getRootNode` takes the
second form only, the DOM owning that name on every node. React sets a property it finds, so `<mono-select collection={…}
/>` hands the value over whole rather than stringified, and setting
the same value again does nothing, which matters because React sets
one on every render.

`element.api` is the live API and `element.destroy()` stops the mount.
The element mounts when its parts are there — at the end of the parse
for markup the browser is still reading, and as they arrive for markup
a framework fills in — and mounts again as they are replaced. Leaving
the document destroys it.

An element has no display of its own, so it is inline, as a custom
element is — which is what a `<mono-tooltip>` in a sentence wants,
and no obstacle to one that wraps blocks: the engine splits an inline
box around a block inside it, as CSS does, so the blocks lay out as
the parent's own. Give it a display where you want one
(`class="block"` to make it a box of its own, `flex` to lay its parts
out); none is needed for it to work.

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
vanilla submenu, whose positioning the mount sets. A submenu opens on
the reading side by default — `right-start`, `left-start` in a
right-to-left menu — however it is written: the mount gives a marked
`submenu` root that placement, and `asSubmenuOf(parent, own)` gives it
to a framework's nested root, along with the behavior a parent shares.

A positioner is a surface in the host's colors by default (the
engine's, in place of the browser's canvas colors); `bg-clear` on the
content cuts the grid's cells beneath it out instead, showing what
lies behind the host through it. The dialog's positioner is centered
by the platform and carries the `::backdrop` (`backdrop:bg-black/50`),
which the engine draws beneath it; without the class the backdrop is
invisible and the dialog still modal, Zag's trap and `aria-hidden`
being its own.

## Modules

One entry per component. Each exports the mount, `machine`, `connect`,
`props`, and `api`, with Zag's `Props`, `Api`, and `Service` types and
`GridProps`, `props()`'s return.

- `@monowind/ui/menu` — Zag's menu: items, groups, separators,
  submenus, typeahead, `onSelect`.
- `@monowind/ui/listbox` — Zag's listbox: single, multiple, and
  extended selection, groups, typeahead, `onValueChange`; Zag's
  `collection` and `gridCollection` come with it.
- `@monowind/ui/select` — Zag's select: a listbox anchored to its
  trigger, opening on click, one value or several, with a form value
  and a clear button; Zag's `collection` comes with it.
- `@monowind/ui/combobox` — Zag's combobox: a listbox under an input,
  anchored to the control so it lines up under what the reader types;
  filtering is yours — hand `updateProps` a `collection` narrowed by
  what `onInputValueChange` gives you, and the items it leaves out are
  hidden. Zag's `collection` comes with it.
- `@monowind/ui/dialog` — Zag's dialog: focus trap, the page hidden
  from assistive technology, Escape and outside click.
- `@monowind/ui/popover` — Zag's popover.
- `@monowind/ui/tooltip` — Zag's tooltip; `openDelay` and `closeDelay`
  are its.

`@monowind/ui/elements` exports `defineMonoUi()` and the classes it
registers, plus `defineElement()` and the `MonoElement` base, for an
element of your own over a mount.

`@monowind/ui/framework` holds what the framework packages share:
`ItemApi`, what a listbox's, a select's and a combobox's item parts
read of the API above them; `warnStray`, which names a prop given to a
root that renders no element; and `warnUnmarked`, which names a mount
that found none of the items its collection holds.

`@monowind/ui/top-layer`'s `syncTopLayer(positioner, open)` keeps a
positioner in the top layer while the machine is open and through its
exit, blurring a focused element inside it as the machine closes; the
vanilla path calls it, and a framework runs it after commit where it
renders the parts itself. Its `Component` and `Anchored` types
are the shape of an entry, which the framework packages build on.
