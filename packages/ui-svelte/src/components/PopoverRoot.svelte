<script lang="ts">
  import type { Snippet } from "svelte";
  import type * as popover from "@monowind/ui/popover";
  import { createPopover } from "../index.svelte.ts";
  import { propNames } from "@monowind/ui/popover";
  import { bound, splitProps, warnStray, popoverContext } from "./context.ts";

  /** A popover over its own machine, an id generated where the markup
   * gives none, held for the parts under it. */
  let {
    open = $bindable(),
    onOpenChange,
    children,
    ...props
  }: Omit<popover.Props, "id"> & { id?: string; children?: Snippet } = $props();

  const generated = $props.id();
  // What Zag does not name has nowhere to go: this root renders no
  // element of its own.
  $effect(() => warnStray("PopoverRoot", Object.keys(splitProps(props, propNames)[1])));
  // A `bind:` follows the machine: each bound prop is given only
  // when the author names it, and written back when it changes.
  const machineProps = $derived({
    ...props,
    id: props.id ?? generated,
    ...(open === undefined ? {} : { open }),
    onOpenChange: bound("open", (next) => (open = next), onOpenChange),
  } as unknown as popover.Props);
  popoverContext.set(createPopover(() => machineProps));
</script>

{@render children?.()}
