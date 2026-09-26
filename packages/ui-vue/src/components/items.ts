import { computed, defineComponent, type ComputedRef } from "vue";
import { itemOf, itemProps, type ItemApi } from "@monowind/ui/framework";
import { BOOLEAN, defineContext, definePart, renderPart, type Part } from "./part.ts";

/**
 * The item parts a listbox, a select and a combobox share (specs/ui.md
 * "Component layer", `ItemApi`): the items, the text and the indicator
 * inside one, and the groups around them.
 */

type Props = Record<string, unknown>;

type List = { api: ComputedRef<ItemApi> };

type ItemProps = { item?: unknown; value?: string };

const list = defineContext<List>(
  "List",
  "an item part must be inside <ListboxRoot>, <SelectRoot> or <ComboboxRoot>",
);

/** The item an `Item` holds, for the text and the indicator inside
 * it: whatever the collection holds, which is the author's shape. */
const held = defineContext<ComputedRef<unknown>>(
  "Item",
  "an item's text and indicator must be inside its Item",
);

/** A list component's context, whose root provides the item parts'
 * list as well. */
export function defineListContext<V extends List>(name: string) {
  const own = defineContext<V>(name);
  return {
    ...own,
    provide: (value: V) => {
      own.provide(value);
      list.provide(value);
    },
  };
}

const insideItem = { use: () => ({ api: list.use().api, item: held.use() }) };

export function defineItemParts(prefix: string) {
  /** An item is named either by the collection's own item or by the
   * value that finds it there. */
  const Item = defineComponent(
    (props: ItemProps & { asChild?: boolean }, { slots, attrs }) => {
      const { api } = list.use();
      const own = computed(() => itemOf(api.value, props));
      held.provide(own);
      return () =>
        renderPart(
          "div",
          itemProps(api.value, own.value),
          attrs as Props,
          Boolean(props.asChild),
          slots["default"]?.(),
          `${prefix}Item`,
        );
    },
    {
      name: `${prefix}Item`,
      inheritAttrs: false,
      props: { item: null, value: null, asChild: BOOLEAN },
    },
  ) as unknown as Part<"div", ItemProps>;

  return {
    /** The collection's item the part is inside. */
    useItemContext: held.use,
    Item,
    ItemText: definePart(
      `${prefix}ItemText`,
      insideItem,
      ({ api, item }) => api.value.getItemTextProps({ item: item.value }),
      "span",
    ),
    ItemIndicator: definePart(
      `${prefix}ItemIndicator`,
      insideItem,
      ({ api, item }) => api.value.getItemIndicatorProps({ item: item.value }),
      "span",
    ),
    ItemGroup: definePart<List, "div", { id: string }>(
      `${prefix}ItemGroup`,
      list,
      ({ api }, own) => api.value.getItemGroupProps(own as { id: string }),
      "div",
      { id: null },
    ),
    ItemGroupLabel: definePart<List, "div", { htmlFor: string }>(
      `${prefix}ItemGroupLabel`,
      list,
      ({ api }, own) => api.value.getItemGroupLabelProps(own as { htmlFor: string }),
      "div",
      { htmlFor: null },
    ),
  };
}
