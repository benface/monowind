<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { selectContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const select = selectContext.use();
</script>

<Positioner
  props={select.api.getPositionerProps()}
  positioner={select.positioner}
  {children}
  {...rest}
/>
