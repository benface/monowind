<script lang="ts">
  import Part from "./Part.svelte";
  import { listboxContext, useItemContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const listbox = listboxContext.use();
  const item = $derived(useItemContext());
</script>

<Part tag="span" props={listbox.api.getItemTextProps({ item })} {children} {child} {...rest} />
