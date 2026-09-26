<script lang="ts">
  import type { Snippet } from "svelte";
  import Part from "./Part.svelte";
  import { menuContext } from "./context.ts";

  let { children, ...rest }: { children?: Snippet; [key: string]: unknown } = $props();

  const { menu } = menuContext.use();
</script>

<Part props={menu.api.getPositionerProps()} positioner={menu.positioner} {children} {...rest} />
