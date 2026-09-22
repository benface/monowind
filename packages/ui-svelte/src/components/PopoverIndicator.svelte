<script lang="ts">
  import Part from "./Part.svelte";
  import { popoverContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const popover = popoverContext.use();
</script>

<Part tag="span" props={popover.api.getIndicatorProps()} {children} {child} {...rest} />
