<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/combobox";
  import type * as combobox from "@monowind/ui/combobox";
  import { createCombobox } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { binding, comboboxContext, listContext, splitProps } from "./context.ts";

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
  const split = $derived(splitProps(props, propNames));
  const machineProps = $derived({
    ...split[0],
    id: props.id ?? generated,
    ...binding("open", open, (next) => (open = next), onOpenChange),
    ...binding("value", value, (next) => (value = next), onValueChange),
    ...binding("inputValue", inputValue, (next) => (inputValue = next), onInputValueChange),
    ...binding("highlightedValue", highlightedValue, (next) => (highlightedValue = next), onHighlightChange),
  } as unknown as combobox.Props);
  const created = createCombobox(() => machineProps);
  comboboxContext.set(created);
  listContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
