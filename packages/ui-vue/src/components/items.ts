import { computed, defineComponent, type ComputedRef } from "vue";
import type { ItemApi } from "@monowind/ui/framework";
import { defineContext, renderPart, partsOf } from "./part.ts";

/**
 * The parts a listbox and a select share (specs/ui.md "Component
 * layer"): the items of their collection, the text and the indicator
 * inside one, and the groups around them. Zag gives both the same
 * five getters, so both build their parts here.
 */

type Props = Record<string, unknown>;

export function defineItemParts<A extends ItemApi, V extends { api: ComputedRef<A> }>(
  prefix: string,
  context: { use: () => V },
) {
  /** The item an `Item` holds, for the text and the indicator inside
   * it: whatever the collection holds, which is the author's shape. */
  const held = defineContext<ComputedRef<unknown>>(`${prefix}Item`);
  const part = partsOf<A, V>(prefix, context);

  /** An item is named either by the collection's own item or by the
   * value that finds it there. */
  const Item = defineComponent(
    (props: { item?: unknown; value?: string; asChild?: boolean }, { slots, attrs }) => {
      const { api } = context.use();
      const item = computed(() =>
        props.item !== undefined ? props.item : api.value.collection.find(props.value ?? ""),
      );
      held.provide(item);
      return () =>
        renderPart(
          "div",
          api.value.getItemProps({ item: item.value }),
          attrs as Props,
          Boolean(props.asChild),
          slots["default"]?.(),
          `${prefix}Item`,
        );
    },
    { name: `${prefix}Item`, inheritAttrs: false, props: ["item", "value", "asChild"] },
  );

  const inside = (name: string, propsOf: (api: A, item: unknown) => object) =>
    defineComponent(
      (props: { asChild?: boolean }, { slots, attrs }) => {
        const { api } = context.use();
        const item = held.use();
        return () =>
          renderPart(
            "span",
            propsOf(api.value, item.value),
            attrs as Props,
            Boolean(props.asChild),
            slots["default"]?.(),
            name,
          );
      },
      { name, inheritAttrs: false, props: ["asChild"] },
    );

  return {
    /** The collection's item the part is inside. */
    useItemContext: held.use,
    Item,
    ItemText: inside(`${prefix}ItemText`, (api, item) => api.getItemTextProps({ item })),
    ItemIndicator: inside(`${prefix}ItemIndicator`, (api, item) =>
      api.getItemIndicatorProps({ item }),
    ),
    ItemGroup: part(
      "ItemGroup",
      (api, own) => api.getItemGroupProps(own as { id: string }),
      "div",
      ["id"],
    ),
    ItemGroupLabel: part(
      "ItemGroupLabel",
      (api, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
      "div",
      ["htmlFor"],
    ),
  };
}
