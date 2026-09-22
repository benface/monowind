# @monowind/ui-react

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
for React, two ways over the same machines: a **component** per
piece — `Menu`, `Listbox`, `Select`, `Combobox`, `Dialog`, `Popover`,
`Tooltip` — and a **hook** per component — `useMenu`, `useListbox`,
`useSelect`, `useCombobox`, `useDialog`, `usePopover`, `useTooltip`. Style the parts with Tailwind and monowind
classes; the engine places each floating part against its trigger in
cells, in the top layer.

```tsx
import { Menu } from "@monowind/ui-react";

const ITEM = "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)";

function FileMenu() {
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger className="border px-1">File</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content className="border bg-clear">
          <Menu.Item value="new" className={ITEM}>
            New
          </Menu.Item>
          <Menu.Root>
            <Menu.TriggerItem className={ITEM}>Share ›</Menu.TriggerItem>
            <Menu.Positioner>
              <Menu.Content className="border bg-clear">
                <Menu.Item value="mail" className={ITEM}>
                  Mail
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}
```

## The components

`Root` takes the machine's props — `id` optional, a `useId()` standing
in — and holds the API for the parts under it. The parts:

- `Menu` — `Trigger`, `TriggerItem`, `Positioner`, `Content`, `Item`,
  `ItemGroup`, `ItemGroupLabel`, `Separator`.
- `Dialog` and `Popover` — `Trigger`, `Positioner`, `Content`,
  `Title`, `Description`, `CloseTrigger`; the popover also has
  `Indicator`.
- `Tooltip` — `Trigger`, `Positioner`, `Content`, which render inline,
  a tooltip belonging in the sentence around its trigger.
- `Listbox` and `Select` — `Root`, which is an element of its own
  (Zag gives both a root part, so it takes attributes as any part
  does), `Label`, `Content`, `Item`, `ItemText`, `ItemIndicator`,
  `ItemGroup`, `ItemGroupLabel`; the select adds `Control`,
  `Trigger`, `ValueText`, `Indicator`, `ClearTrigger`, `Positioner`,
  `List` and `HiddenSelect`, the native control a form submits.
- `Combobox` — `Root` (an element of its own), `Label`, `Control`,
  `Input`, `Trigger`, `ClearTrigger`, `Positioner`, `Content`,
  `List`, and the item parts below. Its list anchors to the `Control`,
  so it lines up under the input; filtering is yours — give `Root` the
  collection your input value narrows, and the items it leaves out are
  hidden.

A menu's, a dialog's, a popover's and a tooltip's `Root` render
nothing — Zag gives those four no root part, and a wrapper invented
for one would put a box in the grid's layout — so they take no
attributes, and a `className` on one is a type error and, in a
development build, a warning naming it. A listbox's and a select's
root renders its part and takes attributes as any part does.

An `Item` names one of the collection's items, by `item` or by the
`value` that finds it there, and holds it for the `ItemText` and
`ItemIndicator` inside; `useListboxItemContext()` and
`useSelectItemContext()` read it. `Select.ValueText` shows what is
selected, its children the placeholder until something is.
A `Menu.Root` inside another is that menu's **submenu**: Zag links the
two, and the submenu takes the side it opens on (`right-start`, or
`left-start` in a right-to-left menu) and the behavior its parent
shares — `onSelect`, `closeOnSelect`, `loopFocus`, `typeahead`,
`composite`, `navigate`, `dir`, `getRootNode` — with its own props
over them, exactly as a marked `submenu` root does. Its
`Menu.TriggerItem` is the parent's item that opens it, so it goes
inside the nested `Root`.

A part takes the props of the element it renders, so `Menu.Trigger`
autocompletes a button's and a typo is an error, and a `ref` reaches
the node.

Every part merges the API's props under yours with Zag's own
`mergeProps`: your class comes after the API's, and a handler of yours
runs before the API's. **`asChild`** renders the one child instead of
the part's own element, with those props merged onto it — refs from
both sides reach the node:

```tsx
<Menu.Trigger asChild>
  <MyButton className="border px-1">File</MyButton>
</Menu.Trigger>
```

**`RootProvider`** takes an API you hold, for reaching it from outside
the tree: run the hook yourself and hand it over.

```tsx
function FileMenu() {
  const menu = useMenu({ id: "file" });
  return <Menu.RootProvider value={menu}>{/* the parts */}</Menu.RootProvider>;
}
```

`useMenuContext()`, `useDialogContext()`, `usePopoverContext()` and
`useTooltipContext()` give a part the component it is in, exactly as
its hook returns it.

## The hooks

Each takes Zag's machine props (`id` required) and returns Zag's API
with the grid's props on the trigger, the positioner, and the content,
the positioner's `ref` inside `getPositionerProps()` so its place in
the top layer follows the machine, and the machine's `service` beside
the API for linking two machines. A listbox stands in the flow, so
`useListbox` returns no positioner. Spread the props as Zag's docs
show.

```tsx
import { useMenu } from "@monowind/ui-react";
import { useId } from "react";

function FileMenu() {
  const menu = useMenu({ id: useId(), positioning: { placement: "bottom-start" } });
  return (
    <>
      <button {...menu.getTriggerProps()} className="border px-1">
        File
      </button>
      <div {...menu.getPositionerProps()}>
        <div {...menu.getContentProps()} className="border bg-clear">
          <div
            {...menu.getItemProps({ value: "new" })}
            className="px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg)"
          >
            New
          </div>
        </div>
      </div>
    </>
  );
}
```

The parts, their states, and `positioning` (placement, gutter, offset,
in cells) are `@monowind/ui`'s — see its README.
