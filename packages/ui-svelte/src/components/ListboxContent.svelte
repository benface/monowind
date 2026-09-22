<script lang="ts">
  import Part from "./Part.svelte";
  import { listboxContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const listbox = listboxContext.use();
</script>

<Part tag="div" props={listbox.api.getContentProps()} {children} {child} {...rest} />
