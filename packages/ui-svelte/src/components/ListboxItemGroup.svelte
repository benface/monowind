<script lang="ts">
  import Part from "./Part.svelte";
  import { listboxContext, type PartProps } from "./context.ts";

  let {
    id,
    children,
    child,
    ...rest
  }: PartProps & {
    id: string;
  } = $props();

  const listbox = listboxContext.use();
</script>

<Part tag="div" props={listbox.api.getItemGroupProps({ id })} {children} {child} {...rest} />
