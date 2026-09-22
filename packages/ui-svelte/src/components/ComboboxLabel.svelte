<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const combobox = comboboxContext.use();
</script>

<Part tag="label" props={combobox.api.getLabelProps()} {children} {child} {...rest} />
