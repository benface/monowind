import type { ReactNode } from "react";
import { itemOf, itemProps, type ItemApi } from "@monowind/ui/framework";
import { defineContext, definePart, renderPart, type PartProps } from "./part.tsx";

/**
 * The item parts a listbox, a select and a combobox share (specs/ui.md
 * "Component layer", `ItemApi`): the items, the text and the indicator
 * inside one, and the groups around them.
 */

/** An item is named either by the collection's own item or by the
 * value that finds it there. */
export interface ItemProps extends PartProps {
  item?: unknown;
  value?: string | undefined;
}

const list = defineContext<ItemApi>(
  "List",
  "an item part must be inside <Listbox.Root>, <Select.Root> or <Combobox.Root>",
);

/** The item an `Item` holds, for the text and the indicator inside
 * it: whatever the collection holds, which is the author's shape. */
const held = defineContext<unknown>("Item", "an item's text and indicator must be inside its Item");

/** A list component's context, whose root provides the item parts'
 * list as well. */
export function defineListContext<V extends ItemApi>(name: string) {
  const own = defineContext<V>(name);
  return {
    ...own,
    Provider: ({ value, children }: { value: V; children?: ReactNode }): ReactNode => (
      <own.Provider value={value}>
        <list.Provider value={value}>{children}</list.Provider>
      </own.Provider>
    ),
  };
}

const useItem = () => ({ api: list.use(), item: held.use() });

export function defineItemParts(prefix: string) {
  function Item({ item, value, children, ...rest }: ItemProps): ReactNode {
    const api = list.use();
    const own = itemOf(api, { item, value });
    return renderPart(`${prefix}.Item`, "div", itemProps(api, own), {
      ...rest,
      children: <held.Provider value={own}>{children}</held.Provider>,
    });
  }
  Item.displayName = `${prefix}.Item`;

  return {
    /** The collection's item the part is inside. */
    useItemContext: held.use,
    Item,
    ItemText: definePart(
      `${prefix}.ItemText`,
      useItem,
      ({ api, item }) => api.getItemTextProps({ item }),
      "span",
    ),
    ItemIndicator: definePart(
      `${prefix}.ItemIndicator`,
      useItem,
      ({ api, item }) => api.getItemIndicatorProps({ item }),
      "span",
    ),
    ItemGroup: definePart<ItemApi, "div", { id: string }>(
      `${prefix}.ItemGroup`,
      list.use,
      (api, own) => api.getItemGroupProps(own as { id: string }),
      "div",
      ["id"],
    ),
    ItemGroupLabel: definePart<ItemApi, "div", { htmlFor: string }>(
      `${prefix}.ItemGroupLabel`,
      list.use,
      (api, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
      "div",
      ["htmlFor"],
    ),
  };
}
