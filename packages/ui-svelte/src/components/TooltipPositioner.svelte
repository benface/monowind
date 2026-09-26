<script lang="ts">
  import type { Snippet } from "svelte";
  import Part from "./Part.svelte";
  import { tooltipContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const tooltip = tooltipContext.use();
</script>

<Part
  tag="span"
  props={tooltip.api.getPositionerProps()}
  positioner={tooltip.positioner}
  {children}
  {...rest}
/>
