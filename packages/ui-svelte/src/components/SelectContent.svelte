<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const select = selectContext.use();
</script>

<Part tag="div" props={select.api.getContentProps()} {children} {child} {...rest} />
