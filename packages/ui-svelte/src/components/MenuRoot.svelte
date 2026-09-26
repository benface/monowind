<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { asSubmenuOf, propNames } from "@monowind/ui/menu";
  import type * as menu from "@monowind/ui/menu";
  import { createMenu } from "../index.svelte.ts";
  import { binding, splitProps, warnStray, menuContext } from "./context.ts";

  /** A menu over its own machine, an id generated where the markup
   * gives none. Nested in another, it is that menu's submenu. */
  let {
    open = $bindable(),
    onOpenChange,
    highlightedValue = $bindable(),
    onHighlightChange,
    triggerValue = $bindable(),
    onTriggerValueChange,
    children,
    ...props
  }: Omit<menu.Props, "id"> & { id?: string; children?: Snippet } = $props();

  const parent = menuContext.useOptional();
  const generated = $props.id();
  const own = $derived({
    ...props,
    id: props.id ?? generated,
    ...binding("open", open, (next) => (open = next), onOpenChange),
    ...binding("highlightedValue", highlightedValue, (next) => (highlightedValue = next), onHighlightChange),
    ...binding("triggerValue", triggerValue, (next) => (triggerValue = next), onTriggerValueChange),
  } as unknown as menu.Props);
  const machineProps = $derived(
    parent ? asSubmenuOf(parent.props ?? { id: own.id }, own) : own,
  );
  const menuCreated = createMenu(() => machineProps);
  $effect(() => warnStray("MenuRoot", Object.keys(splitProps(props, propNames)[1]), menuCreated));

  menuContext.set({
    menu: menuCreated,
    parent: parent ?? null,
    get props() {
      return machineProps;
    },
  });

  // Linked once the machines are running — Zag starts a service in an
  // effect, so the API is not connectable during init — and once
  // only: a service outlives every render.
  $effect(() => {
    if (!parent) return;
    untrack(() => {
      parent.menu.api.setChild(menuCreated.service);
      menuCreated.api.setParent(parent.menu.service);
    });
  });
</script>

{@render children?.()}
