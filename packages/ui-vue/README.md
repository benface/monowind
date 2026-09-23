# @monowind/ui-vue

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
for Vue, two ways over the same machines: a **component** per part —
`MenuRoot`, `MenuTrigger`, `DialogRoot`, … — and a **composable** per
component — `useMenu`, `useListbox`, `useSelect`, `useCombobox`,
`useDialog`, `usePopover`, `useTooltip`. Style the parts with Tailwind and monowind
classes; the engine places each floating part against its trigger in
cells, in the top layer.

```vue
<script setup lang="ts">
import { MenuContent, MenuItem, MenuPositioner, MenuRoot, MenuTrigger } from "@monowind/ui-vue";

const item = "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)";
</script>

<template>
  <MenuRoot
    :positioning="{ placement: 'bottom-start' }"
    @select="({ value }) => console.log(value)"
  >
    <MenuTrigger class="border px-1">File</MenuTrigger>
    <MenuPositioner>
      <MenuContent class="border bg-clear">
        <MenuItem value="new" :class="item">New</MenuItem>
      </MenuContent>
    </MenuPositioner>
  </MenuRoot>
</template>
```

## The components

`…Root` takes the machine's props — `id` optional, a `useId()`
standing in — and provides the API to the parts under it. A callback
is a listener, so `onSelect` is `@select` and `onOpenChange` is
`@open-change`. The parts:

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
  `ComboboxContent`, `ComboboxList`, and the item parts below. Its
  list anchors to the control, so it lines up under the input;
  filtering is yours, and the items your collection leaves out are
  hidden.

A root emits `update:open`, `update:value`,
`update:highlighted-value` and `update:trigger-value` where its
machine has them, so **`v-model`** works as anywhere else:

```vue
<SelectRoot v-model:open="open" v-model:value="value" :collection="items">
```

A menu's, a dialog's, a popover's and a tooltip's root renders
nothing — Zag gives those four no root part, and a wrapper invented
for one would put a box in the grid's layout — so an attribute on
one goes nowhere, and a development build warns and names it. A
listbox's and a select's root renders its part and takes attributes
as any part does.

An item names one of the collection's items, by `item` or by the
`value` that finds it there, and holds it for the text and the
indicator inside; `useListboxItemContext()` and
`useSelectItemContext()` read it. `SelectValueText` shows what is
selected, its slot the placeholder until something is.
A `MenuRoot` inside another is that menu's **submenu**: Zag links the
two, and the submenu takes the side it opens on (`right-start`, or
`left-start` in a right-to-left menu) and the behavior its parent
shares — `onSelect`, `closeOnSelect`, `loopFocus`, `typeahead`,
`composite`, `navigate`, `dir`, `getRootNode` — with its own props
over them, exactly as a marked `submenu` root does. Its
`MenuTriggerItem` is the parent's item that opens it, so it goes
inside the nested `MenuRoot`.

Every part merges the API's props under yours with Zag's own
`mergeProps`, so a handler of yours runs before the API's.
**`as-child`** renders the one element the default slot gives instead
of the part's own, with those props on it — refs from both sides reach
the node:

```vue
<MenuTrigger as-child>
  <MyButton class="border px-1">File</MyButton>
</MenuTrigger>
```

**`…RootProvider`** takes an API you hold, for reaching it from
outside the tree: run the composable yourself and hand it over on
`value`. `useMenuContext()`, `useDialogContext()`,
`usePopoverContext()` and `useTooltipContext()` give a part the
component it is in, exactly as its composable returns it.

## The composables

Each takes Zag's machine props (`id` required) — or a ref or getter of
them, so a controlled `open` or `highlightedValue` follows your
state — and returns `api`, Zag's API with the grid's props on the
trigger, the positioner, and the content, as a computed; `positioner`,
the ref for the positioner element that keeps its place in the top
layer with the machine; and `service`, the machine's, for linking two.
A listbox stands in the flow, so `useListbox` returns no positioner.

```vue
<script setup lang="ts">
import { useMenu } from "@monowind/ui-vue";

const { api, positioner } = useMenu({ id: "file", positioning: { placement: "bottom-start" } });
</script>

<template>
  <button v-bind="api.getTriggerProps()" class="border px-1">File</button>
  <div ref="positioner" v-bind="api.getPositionerProps()">
    <div v-bind="api.getContentProps()" class="border bg-clear">
      <div
        v-bind="api.getItemProps({ value: 'new' })"
        class="px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)"
      >
        New
      </div>
    </div>
  </div>
</template>
```

Tell Vue's compiler that `mono-wind` is a custom element
(`isCustomElement: (tag) => tag === "mono-wind"` in the Vue plugin's
`template.compilerOptions`). The parts, their states, and `positioning` (placement, gutter, offset,
in cells) are `@monowind/ui`'s — see its README.
