<script lang="ts">
  import Part from "./Part.svelte";
  import { itemContext, itemOf, itemProps, listContext, type PartProps } from "./context.ts";

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

  const list = listContext.use();
  const held = $derived(itemOf(list.api, { item, value }));
  itemContext.set(() => held);
</script>

<Part props={itemProps(list.api, held)} {children} {child} {...rest} />
