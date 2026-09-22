<script lang="ts">
  import Part from "./Part.svelte";
  import { listboxContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const listbox = listboxContext.use();
</script>

<Part tag="span" props={listbox.api.getLabelProps()} {children} {child} {...rest} />
