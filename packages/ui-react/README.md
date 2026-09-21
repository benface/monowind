# @monowind/ui-react

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
as React hooks: `useMenu`, `useListbox`, `useSelect`, `useDialog`,
`usePopover`, `useTooltip`. Each takes Zag's machine props (`id`
required) and returns Zag's API with the grid's props on the trigger,
the positioner, and the content, the positioner's `ref` inside
`getPositionerProps()` so its place in the top layer follows the
machine. A listbox stands in the flow, so `useListbox` returns the API
alone. Spread the props as Zag's docs show; style the parts with
Tailwind and monowind classes.

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
