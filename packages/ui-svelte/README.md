# @monowind/ui-svelte

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
for Svelte 5: `createMenu`, `createDialog`, `createPopover`,
`createTooltip`, called in a component's script. Each takes Zag's
machine props (`id` required) — or a getter of them, so a controlled
`open` or `highlightedValue` follows your state — and returns `api`,
Zag's API with the
grid's props on the trigger, the positioner, and the content, live
through a getter, and `positioner`, an action for the positioner
element that keeps its place in the top layer with the machine. Spread
the props as Zag's docs show; style the parts with Tailwind and
monowind classes.

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

The package ships its `.svelte.ts` source, which your Svelte plugin
compiles as it does your own. The parts, their states, and `positioning` (placement, gutter, offset,
in cells) are `@monowind/ui`'s — see its README.
