<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const combobox = comboboxContext.use();
</script>

<Part tag="div" props={combobox.api.getContentProps()} {children} {child} {...rest} />
