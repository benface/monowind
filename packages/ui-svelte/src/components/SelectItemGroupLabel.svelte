<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let {
    htmlFor,
    children,
    child,
    ...rest
  }: PartProps & {
    htmlFor: string;
  } = $props();

  const select = selectContext.use();
</script>

<Part tag="div" props={select.api.getItemGroupLabelProps({ htmlFor })} {children} {child} {...rest} />
