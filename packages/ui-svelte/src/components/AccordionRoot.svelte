<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/accordion";
  import type * as accordion from "@monowind/ui/accordion";
  import { createAccordion } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { accordionContext, binding, splitProps } from "./context.ts";

  /** An accordion over its own machine, an id generated where the
   * markup gives none. Zag gives it a root part, so the root is an
   * element of its own and takes attributes. */
  let {
    value = $bindable(),
    onValueChange,
    children,
    child,
    ...props
  }: Omit<accordion.Props, "id"> & {
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
  } as unknown as accordion.Props);
  const created = createAccordion(() => machineProps);
  accordionContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
