<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, type PartProps } from "./context.ts";

  let {
    id,
    children,
    child,
    ...rest
  }: PartProps & {
    id: string;
  } = $props();

  const combobox = comboboxContext.use();
</script>

<Part tag="div" props={combobox.api.getItemGroupProps({ id })} {children} {child} {...rest} />
