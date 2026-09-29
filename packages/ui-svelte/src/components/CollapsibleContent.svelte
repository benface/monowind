<script lang="ts">
  import Part from "./Part.svelte";
  import { collapsibleContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const collapsible = collapsibleContext.use();
</script>

<Part tag="div" props={collapsible.api.getContentProps()} {children} {child} {...rest} />
