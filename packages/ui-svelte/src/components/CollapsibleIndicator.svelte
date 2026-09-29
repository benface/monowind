<script lang="ts">
  import Part from "./Part.svelte";
  import { collapsibleContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const collapsible = collapsibleContext.use();
</script>

<Part tag="span" props={collapsible.api.getIndicatorProps()} {children} {child} {...rest} />
