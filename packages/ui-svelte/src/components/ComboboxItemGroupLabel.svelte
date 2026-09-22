<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, type PartProps } from "./context.ts";

  let {
    htmlFor,
    children,
    child,
    ...rest
  }: PartProps & {
    htmlFor: string;
  } = $props();

  const combobox = comboboxContext.use();
</script>

<Part tag="div" props={combobox.api.getItemGroupLabelProps({ htmlFor })} {children} {child} {...rest} />
