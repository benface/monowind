<script lang="ts">
  import Part from "./Part.svelte";
  import { listContext, useItemContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const list = listContext.use();
  const item = $derived(useItemContext());
</script>

<Part tag="span" props={list.api.getItemIndicatorProps({ item })} {children} {child} {...rest} />
