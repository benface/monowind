<script lang="ts">
  import type { Snippet } from "svelte";
  import { propNames } from "@monowind/ui/collapsible";
  import type * as collapsible from "@monowind/ui/collapsible";
  import { createCollapsible } from "../index.svelte.ts";
  import Part from "./Part.svelte";
  import { binding, collapsibleContext, splitProps } from "./context.ts";

  /** A collapsible over its own machine, an id generated where the
   * markup gives none. Zag gives it a root part, so the root is an
   * element of its own and takes attributes. */
  let {
    open = $bindable(),
    onOpenChange,
    children,
    child,
    ...props
  }: Omit<collapsible.Props, "id"> & {
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
  } as unknown as collapsible.Props);
  const created = createCollapsible(() => machineProps);
  collapsibleContext.set(created);
</script>

<Part props={created.api.getRootProps()} {children} {child} {...split[1]} />
