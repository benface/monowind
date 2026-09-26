# @monowind/ui-svelte

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
for Svelte 5, two ways over the same machines: a **component** per
part — `MenuRoot`, `MenuTrigger`, `DialogRoot`, … — and a
**`create…`** per component — `createMenu`, `createListbox`,
`createSelect`, `createCombobox`, `createDialog`, `createPopover`,
`createTooltip` — called in a component's script. Style the parts with Tailwind and
monowind classes; the engine places each floating part against its
trigger in cells, in the top layer.

```svelte
<script lang="ts">
  import { MenuContent, MenuItem, MenuPositioner, MenuRoot, MenuTrigger } from "@monowind/ui-svelte";

  const item = "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)";
</script>

<MenuRoot positioning={{ placement: "bottom-start" }} onSelect={({ value }) => console.log(value)}>
  <MenuTrigger class="border px-1">File</MenuTrigger>
  <MenuPositioner>
    <MenuContent class="border bg-clear">
      <MenuItem value="new" class={item}>New</MenuItem>
    </MenuContent>
  </MenuPositioner>
</MenuRoot>
```

## The components

`…Root` takes the machine's props — `id` optional, `$props.id()`
standing in — and holds the API for the parts under it. The parts:

- Menu — `MenuTrigger`, `MenuTriggerItem`, `MenuPositioner`,
  `MenuContent`, `MenuItem`, `MenuItemGroup`, `MenuItemGroupLabel`,
  `MenuSeparator`.
- Dialog and Popover — `Trigger`, `Positioner`, `Content`, `Title`,
  `Description`, `CloseTrigger` under each name; the popover also has
  `PopoverIndicator`.
- Tooltip — `TooltipTrigger`, `TooltipPositioner`, `TooltipContent`,
  which render inline, a tooltip belonging in the sentence around its
  trigger.
- Listbox and Select — `Root`, which is an element of its own (Zag
  gives both a root part, so it takes attributes as any part does),
  `Label`, `Content`, `Item`, `ItemText`, `ItemIndicator`,
  `ItemGroup`, `ItemGroupLabel` under each name; the select adds
  `SelectControl`, `SelectTrigger`, `SelectValueText`,
  `SelectIndicator`, `SelectClearTrigger`, `SelectPositioner`,
  `SelectList` and `SelectHiddenSelect`, the native control a form
  submits — its options in the server's render too, so a form sent
  before hydration posts the initial value.
- Combobox — `ComboboxRoot` (an element of its own),
  `ComboboxLabel`, `ComboboxControl`, `ComboboxInput`,
  `ComboboxTrigger`, `ComboboxClearTrigger`, `ComboboxPositioner`,
  `ComboboxContent`, `ComboboxList`, and the item parts above. Its
  list anchors to the control, so it lines up under the input;
  filtering is yours, and the items your collection leaves out are
  hidden.

A root's `open`, `value`, `highlightedValue` and `triggerValue` are
`$bindable()` where its machine has them, so **`bind:`** works as
anywhere else:

```svelte
<SelectRoot bind:open bind:value collection={items}>
```

A menu's, a dialog's, a popover's and a tooltip's root renders
nothing — Zag gives those four no root part, and a wrapper invented
for one would put a box in the grid's layout — so an attribute on
one goes nowhere, and a development build warns and names it. A
listbox's, a select's and a combobox's root renders its part and takes
attributes as any part does.

An item names one of the collection's items, by `item` or by the
`value` that finds it there, and holds it for the text and the
indicator inside; `useItemContext()` reads it. The item parts read
the nearest listbox, select or combobox root, whichever of the three
they are named for. `SelectValueText` shows what is selected, its
children the placeholder until something is.

A `MenuRoot` inside another is that menu's **submenu**: Zag links the
two, and the submenu takes the side it opens on (`right-start`, or
`left-start` in a right-to-left menu) and the behavior its parent
shares — `onSelect`, `closeOnSelect`, `loopFocus`, `typeahead`,
`composite`, `navigate`, `dir`, `getRootNode` — with its own props
over them, exactly as a marked `submenu` root does. Its
`MenuTriggerItem` is the parent's item that opens it, so it goes
inside the nested `MenuRoot`.

Every part merges the API's props under yours with Zag's own
`mergeProps`, so a handler of yours runs before the API's. A snippet
renders DOM rather than describing it, so Svelte's stand-in for
`asChild` is a **`child` snippet**: the part hands it those props and
you spread them on an element of your own.

```svelte
<MenuTrigger class="border px-1">
  {#snippet child(props)}
    <button {...props}>File</button>
  {/snippet}
</MenuTrigger>
```

An attribute written after the spread beats it, Svelte's own rule, so
an element that wants a class of its own as well says both:
`class={[props.class, "mine"]}`. Same for a handler — call
`props.onclick?.(event)` from yours.

The positioner renders its own element, which carries the action that
keeps it in the top layer; reach for `createMenu()` where you want
that element to be yours.

**`…RootProvider`** takes an API you hold, for reaching it from
outside the tree: run the `create…` yourself and hand it over on
`value`. `useMenuContext()`, `useDialogContext()`,
`usePopoverContext()` and `useTooltipContext()` give a part the
component it is in, exactly as its `create…` returns it.

## The create functions

Each takes Zag's machine props (`id` required) — or a getter of them,
so a controlled `open` or `highlightedValue` follows your state — and
returns `api`, Zag's API with the grid's props on the trigger, the
positioner, and the content, live through a getter; `positioner`, an
action for the positioner element that keeps its place in the top
layer with the machine; and `service`, the machine's, for linking two.
A listbox stands in the flow, so `createListbox` returns no
positioner.

```svelte
<script lang="ts">
  import { createMenu } from "@monowind/ui-svelte";

  const menu = createMenu({ id: "file", positioning: { placement: "bottom-start" } });
</script>

<button {...menu.api.getTriggerProps()} class="border px-1">File</button>
<div use:menu.positioner {...menu.api.getPositionerProps()}>
  <div {...menu.api.getContentProps()} class="border bg-clear">
    <div {...menu.api.getItemProps({ value: "new" })} class="px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)">
      New
    </div>
  </div>
</div>
```

The package ships its `.svelte` and `.svelte.ts` source, which your
Svelte plugin compiles as it does your own. The parts, their states,
and `positioning` (placement, gutter, offset, in cells) are
`@monowind/ui`'s — see its README.
