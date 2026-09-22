<script lang="ts">
  import Part from "./Part.svelte";
  import { itemContext, itemOf, listboxContext, type PartProps } from "./context.ts";

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

  const listbox = listboxContext.use();
  const held = $derived(itemOf(listbox.api, { item, value }));
  itemContext.set(() => held);
</script>

<Part props={listbox.api.getItemProps({ item: held })} {children} {child} {...rest} />
