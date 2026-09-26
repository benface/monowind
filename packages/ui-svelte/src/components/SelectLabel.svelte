<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const select = selectContext.use();
</script>

<Part tag="label" props={select.api.getLabelProps()} {children} {child} {...rest} />
