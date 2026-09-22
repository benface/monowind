<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let {
    id,
    children,
    child,
    ...rest
  }: PartProps & {
    id: string;
  } = $props();

  const select = selectContext.use();
</script>

<Part tag="div" props={select.api.getItemGroupProps({ id })} {children} {child} {...rest} />
