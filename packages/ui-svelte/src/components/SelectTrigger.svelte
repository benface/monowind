<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const select = selectContext.use();
</script>

<Part tag="button" props={select.api.getTriggerProps()} {children} {child} {...rest} />
