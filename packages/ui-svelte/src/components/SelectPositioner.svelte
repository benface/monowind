<script lang="ts">
  import type { Snippet } from "svelte";
  import Part from "./Part.svelte";
  import { selectContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const select = selectContext.use();
</script>

<Part props={select.api.getPositionerProps()} positioner={select.positioner} {children} {...rest} />
