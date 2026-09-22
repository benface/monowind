<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { menuContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const { menu } = menuContext.use();
</script>

<Positioner
  props={menu.api.getPositionerProps()}
  positioner={menu.positioner}
  {children}
  {...rest}
/>
