<script lang="ts">
  import type { Snippet } from "svelte";
  import type * as popover from "@monowind/ui/popover";
  import { createPopover } from "../index.svelte.ts";
  import { propNames } from "@monowind/ui/popover";
  import { binding, splitProps, warnStray, popoverContext } from "./context.ts";

  /** A popover over its own machine, an id generated where the markup
   * gives none, held for the parts under it. */
  let {
    open = $bindable(),
    onOpenChange,
    triggerValue = $bindable(),
    onTriggerValueChange,
    children,
    ...props
  }: Omit<popover.Props, "id"> & { id?: string; children?: Snippet } = $props();

  const generated = $props.id();
  const machineProps = $derived({
    ...props,
    id: props.id ?? generated,
    ...binding("open", open, (next) => (open = next), onOpenChange),
    ...binding("triggerValue", triggerValue, (next) => (triggerValue = next), onTriggerValueChange),
  } as unknown as popover.Props);
  const created = createPopover(() => machineProps);
  popoverContext.set(created);
  $effect(() => warnStray("PopoverRoot", Object.keys(splitProps(props, propNames)[1]), created));
</script>

{@render children?.()}
