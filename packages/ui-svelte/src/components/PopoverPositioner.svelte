<script lang="ts">
  import type { Snippet } from "svelte";
  import Part from "./Part.svelte";
  import { popoverContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const popover = popoverContext.use();
</script>

<Part props={popover.api.getPositionerProps()} positioner={popover.positioner} {children} {...rest} />
