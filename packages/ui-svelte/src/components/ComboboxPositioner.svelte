<script lang="ts">
  import type { Snippet } from "svelte";
  import Positioner from "./Positioner.svelte";
  import { comboboxContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const combobox = comboboxContext.use();
</script>

<Positioner
  props={combobox.api.getPositionerProps()}
  positioner={combobox.positioner}
  {children}
  {...rest}
/>
