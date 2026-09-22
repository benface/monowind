<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, useItemContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const combobox = comboboxContext.use();
  const item = $derived(useItemContext());
</script>

<Part tag="span" props={combobox.api.getItemTextProps({ item })} {children} {child} {...rest} />
