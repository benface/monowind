<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/listbox";
  import type * as listbox from "@monowind/ui/listbox";
  import { createListbox } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { binding, listboxContext, listContext, splitProps } from "./context.ts";

  /** A listbox over its own machine, an id generated where the markup
   * gives none. Zag gives it a root part, so the root is an element
   * of its own and takes attributes. */
  let {
    value = $bindable(),
    onValueChange,
    highlightedValue = $bindable(),
    onHighlightChange,
    children,
    child,
    ...props
  }: Omit<listbox.Props, "id"> & {
    id?: string;
    children?: Snippet;
    child?: Snippet<[Record<string, unknown>]>;
  } = $props();

  const generated = $props.id();
  const split = $derived(splitProps(props, propNames));
  const machineProps = $derived({
    ...split[0],
    id: props.id ?? generated,
    ...binding("value", value, (next) => (value = next), onValueChange),
    ...binding("highlightedValue", highlightedValue, (next) => (highlightedValue = next), onHighlightChange),
  } as unknown as listbox.Props);
  const created = createListbox(() => machineProps);
  listboxContext.set(created);
  listContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
