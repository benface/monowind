<script lang="ts">
  import Part from "./Part.svelte";
  import { popoverContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const popover = popoverContext.use();
</script>

<Part tag="div" props={popover.api.getContentProps()} {children} {child} {...rest} />
