<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { dialogContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const dialog = dialogContext.use();
</script>

<Positioner
  props={dialog.api.getPositionerProps()}
  positioner={dialog.positioner}
  {children}
  {...rest}
/>
