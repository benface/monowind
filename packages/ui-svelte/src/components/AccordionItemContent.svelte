<script lang="ts">
  import Part from "./Part.svelte";
  import { accordionContext, accordionItemContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const accordion = accordionContext.use();
  const item = accordionItemContext.use();
</script>

<Part tag="div" props={accordion.api.getItemContentProps(item())} {children} {child} {...rest} />
