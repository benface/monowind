<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, popoverContext, type PartProps } from "./context.ts";

  let {
    value,
    children,
    child,
    ...rest
  }: PartProps & {
    value?: string;
  } = $props();

  const popover = popoverContext.use();
  const own = $derived(defined({ value }));
</script>

<Part tag="button" props={popover.api.getTriggerProps(own)} {children} {child} {...rest} />
