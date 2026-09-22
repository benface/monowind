<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { popoverContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const popover = popoverContext.use();
</script>

<Positioner
  tag="div"
  props={popover.api.getPositionerProps()}
  positioner={popover.positioner}
  {children}
  {...rest}
/>
