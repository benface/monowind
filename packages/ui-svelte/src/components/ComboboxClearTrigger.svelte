<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const combobox = comboboxContext.use();
</script>

<Part tag="button" props={combobox.api.getClearTriggerProps()} {children} {child} {...rest} />
