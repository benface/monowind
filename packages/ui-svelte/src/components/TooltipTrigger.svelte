<script lang="ts">
  import Part from "./Part.svelte";
  import { tooltipContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const tooltip = tooltipContext.use();
</script>

<Part tag="button" props={tooltip.api.getTriggerProps()} {children} {child} {...rest} />
