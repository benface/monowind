<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/listbox";
  import type * as listbox from "@monowind/ui/listbox";
  import { createListbox } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { bound, splitProps, listboxContext } from "./context.ts";

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
  }: Omit<listbox.MountProps, "id"> & {
    id?: string;
    children?: Snippet;
    child?: Snippet<[Record<string, unknown>]>;
  } = $props();

  const generated = $props.id();
  // A prop Zag names is the machine's; the rest are the root
  // element's own attributes.
  const split = $derived(splitProps(props, propNames));
  // A `bind:` follows the machine: each bound prop is given only
  // when the author names it, and written back when it changes.
  const machineProps = $derived({
    ...split[0],
    id: props.id ?? generated,
    ...(value === undefined ? {} : { value }),
    onValueChange: bound("value", (next) => (value = next), onValueChange),
    ...(highlightedValue === undefined ? {} : { highlightedValue }),
    onHighlightChange: bound("highlightedValue", (next) => (highlightedValue = next), onHighlightChange),
  } as unknown as listbox.MountProps);
  const created = createListbox(() => machineProps);
  listboxContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
