<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { tooltipContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const tooltip = tooltipContext.use();
</script>

<Positioner
  tag="span"
  props={tooltip.api.getPositionerProps()}
  positioner={tooltip.positioner}
  {children}
  {...rest}
/>
