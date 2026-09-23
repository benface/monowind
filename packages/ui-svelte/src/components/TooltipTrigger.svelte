<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, tooltipContext, type PartProps } from "./context.ts";

  let {
    value,
    children,
    child,
    ...rest
  }: PartProps & {
    value?: string;
  } = $props();

  const tooltip = tooltipContext.use();
  const own = $derived(defined({ value }));
</script>

<Part tag="button" props={tooltip.api.getTriggerProps(own)} {children} {child} {...rest} />
