<script lang="ts">
  import Part from "./Part.svelte";
  import { listContext, type PartProps } from "./context.ts";

  let {
    htmlFor,
    children,
    child,
    ...rest
  }: PartProps & {
    htmlFor: string;
  } = $props();

  const list = listContext.use();
</script>

<Part tag="div" props={list.api.getItemGroupLabelProps({ htmlFor })} {children} {child} {...rest} />
