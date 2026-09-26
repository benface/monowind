<script lang="ts">
  import Part from "./Part.svelte";
  import { listContext, type PartProps } from "./context.ts";

  let {
    id,
    children,
    child,
    ...rest
  }: PartProps & {
    id: string;
  } = $props();

  const list = listContext.use();
</script>

<Part tag="div" props={list.api.getItemGroupProps({ id })} {children} {child} {...rest} />
