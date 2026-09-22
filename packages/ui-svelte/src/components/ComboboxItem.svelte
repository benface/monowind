<script lang="ts">
  import Part from "./Part.svelte";
  import { comboboxContext, itemContext, itemOf, type PartProps } from "./context.ts";

  /** One of the collection's items, named by the item itself or by
   * the value that finds it there, and held for the text and the
   * indicator inside. */
  let {
    item,
    value,
    children,
    child,
    ...rest
  }: PartProps & {
    item?: unknown;
    value?: string;
  } = $props();

  const combobox = comboboxContext.use();
  const held = $derived(itemOf(combobox.api, { item, value }));
  itemContext.set(() => held);
</script>

<Part props={combobox.api.getItemProps({ item: held })} {children} {child} {...rest} />
