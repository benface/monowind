<script lang="ts">
  import Part from "./Part.svelte";
  import { listboxContext, type PartProps } from "./context.ts";

  let {
    htmlFor,
    children,
    child,
    ...rest
  }: PartProps & {
    htmlFor: string;
  } = $props();

  const listbox = listboxContext.use();
</script>

<Part tag="div" props={listbox.api.getItemGroupLabelProps({ htmlFor })} {children} {child} {...rest} />
