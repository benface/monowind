<script lang="ts">
  import type { Snippet } from "svelte";
  import type * as dialog from "@monowind/ui/dialog";
  import { createDialog } from "../index.svelte.ts";
  import { propNames } from "@monowind/ui/dialog";
  import { binding, splitProps, warnStray, dialogContext } from "./context.ts";

  /** A dialog over its own machine, an id generated where the markup
   * gives none, held for the parts under it. */
  let {
    open = $bindable(),
    onOpenChange,
    triggerValue = $bindable(),
    onTriggerValueChange,
    children,
    ...props
  }: Omit<dialog.Props, "id"> & { id?: string; children?: Snippet } = $props();

  const generated = $props.id();
  const machineProps = $derived({
    ...props,
    id: props.id ?? generated,
    ...binding("open", open, (next) => (open = next), onOpenChange),
    ...binding("triggerValue", triggerValue, (next) => (triggerValue = next), onTriggerValueChange),
  } as unknown as dialog.Props);
  const created = createDialog(() => machineProps);
  dialogContext.set(created);
  $effect(() => warnStray("DialogRoot", Object.keys(splitProps(props, propNames)[1]), created));
</script>

{@render children?.()}
