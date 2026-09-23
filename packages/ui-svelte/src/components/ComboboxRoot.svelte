<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/combobox";
  import type * as combobox from "@monowind/ui/combobox";
  import { createCombobox } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { bound, comboboxContext, splitProps } from "./context.ts";

  /** A combobox over its own machine, an id generated where the
   * markup gives none. Zag gives it a root part, so the root is an
   * element of its own and takes attributes. */
  let {
    open = $bindable(),
    onOpenChange,
    value = $bindable(),
    onValueChange,
    inputValue = $bindable(),
    onInputValueChange,
    highlightedValue = $bindable(),
    onHighlightChange,
    children,
    child,
    ...props
  }: Omit<combobox.Props, "id"> & {
    id?: string;
    children?: Snippet;
    child?: Snippet<[Record<string, unknown>]>;
  } = $props();

  const generated = $props.id();
  // A prop Zag names is the machine's; the rest are the root
  // element's own attributes.
  const split = $derived(splitProps(props, propNames));
  // A `bind:` follows the machine: each bound prop is given only when
  // the author names it, and written back when it changes.
  const machineProps = $derived({
    ...split[0],
    id: props.id ?? generated,
    ...(open === undefined ? {} : { open }),
    onOpenChange: bound("open", (next) => (open = next), onOpenChange),
    ...(value === undefined ? {} : { value }),
    onValueChange: bound("value", (next) => (value = next), onValueChange),
    ...(inputValue === undefined ? {} : { inputValue }),
    onInputValueChange: bound("inputValue", (next) => (inputValue = next), onInputValueChange),
    ...(highlightedValue === undefined ? {} : { highlightedValue }),
    onHighlightChange: bound(
      "highlightedValue",
      (next) => (highlightedValue = next),
      onHighlightChange,
    ),
  } as unknown as combobox.Props);
  const created = createCombobox(() => machineProps);
  comboboxContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
