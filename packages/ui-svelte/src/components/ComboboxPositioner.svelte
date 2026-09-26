<script lang="ts">
  import type { Snippet } from "svelte";
  import Part from "./Part.svelte";
  import { comboboxContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const combobox = comboboxContext.use();
</script>

<Part props={combobox.api.getPositionerProps()} positioner={combobox.positioner} {children} {...rest} />
