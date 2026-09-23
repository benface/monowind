<script lang="ts">
  import type { Snippet } from "svelte";
  import type * as tooltip from "@monowind/ui/tooltip";
  import { createTooltip } from "../index.svelte.ts";
  import { propNames } from "@monowind/ui/tooltip";
  import { bound, splitProps, warnStray, tooltipContext } from "./context.ts";

  /** A tooltip over its own machine, an id generated where the markup
   * gives none, held for the parts under it. */
  let {
    open = $bindable(),
    onOpenChange,
    triggerValue = $bindable(),
    onTriggerValueChange,
    children,
    ...props
  }: Omit<tooltip.Props, "id"> & { id?: string; children?: Snippet } = $props();

  const generated = $props.id();
  // A `bind:` follows the machine: each bound prop is given only
  // when the author names it, and written back when it changes.
  const machineProps = $derived({
    ...props,
    id: props.id ?? generated,
    ...(open === undefined ? {} : { open }),
    onOpenChange: bound("open", (next) => (open = next), onOpenChange),
    ...(triggerValue === undefined ? {} : { triggerValue }),
    onTriggerValueChange: bound(
      "triggerValue",
      (next) => (triggerValue = next),
      onTriggerValueChange,
    ),
  } as unknown as tooltip.Props);
  const created = createTooltip(() => machineProps);
  tooltipContext.set(created);
  // What Zag does not name has nowhere to go: this root renders no
  // element of its own.
  $effect(() => warnStray("TooltipRoot", Object.keys(splitProps(props, propNames)[1]), created));
</script>

{@render children?.()}
