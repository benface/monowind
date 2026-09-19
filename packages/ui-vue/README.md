# @monowind/ui-vue

[`@monowind/ui`](https://github.com/benface/monowind/tree/main/packages/ui)
as Vue composables: `useMenu`, `useDialog`, `usePopover`, `useTooltip`.
Each takes Zag's machine props (`id` required) — or a ref or getter of
them, so a controlled `open` or `highlightedValue` follows your state —
and returns `api`, Zag's
API with the grid's props on the trigger, the positioner, and the
content, as a computed, and `positioner`, the ref for the positioner
element that keeps its place in the top layer with the machine. Bind
the props as Zag's docs show; style the parts with Tailwind and
monowind classes.

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
