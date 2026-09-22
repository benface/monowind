<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, useItemContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const select = selectContext.use();
  const item = $derived(useItemContext());
</script>

<Part tag="span" props={select.api.getItemTextProps({ item })} {children} {child} {...rest} />
