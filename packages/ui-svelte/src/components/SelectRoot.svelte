<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/select";
  import type * as select from "@monowind/ui/select";
  import { createSelect } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { binding, listContext, selectContext, splitProps } from "./context.ts";

  /** A select over its own machine, an id generated where the markup
   * gives none. Zag gives it a root part, so the root is an element
   * of its own and takes attributes. */
  let {
    open = $bindable(),
    onOpenChange,
    value = $bindable(),
    onValueChange,
    highlightedValue = $bindable(),
    onHighlightChange,
    children,
    child,
    ...props
  }: Omit<select.Props, "id"> & {
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
    ...binding("highlightedValue", highlightedValue, (next) => (highlightedValue = next), onHighlightChange),
  } as unknown as select.Props);
  const created = createSelect(() => machineProps);
  selectContext.set(created);
  listContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
