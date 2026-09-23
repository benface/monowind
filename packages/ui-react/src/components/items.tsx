import type { ReactNode } from "react";
import { itemOf, itemProps, type ItemApi } from "@monowind/ui/framework";
import { defineContext, partsOf, renderPart, type PartProps } from "./part.tsx";

/**
 * The parts a listbox and a select share (specs/ui.md "Component
 * layer"): the items of their collection, the text and the indicator
 * inside one, and the groups around them. Zag gives both the same
 * five getters, so both build their parts here.
 */

/** An item is named either by the collection's own item or by the
 * value that finds it there. */
export interface ItemProps extends PartProps {
  item?: unknown;
  value?: string | undefined;
}

export function defineItemParts<A extends ItemApi>(prefix: string, context: { use: () => A }) {
  /** The item an `Item` holds, for the text and the indicator inside
   * it: whatever the collection holds, which is the author's shape. */
  const held = defineContext<unknown>(`${prefix}.Item`);
  const part = partsOf(prefix, context.use);

  function Item({ item, value, children, ...rest }: ItemProps): ReactNode {
    const api = context.use();
    const own = itemOf(api, { item, value });
    return renderPart(`${prefix}.Item`, "div", itemProps(api, own), {
      ...rest,
      children: <held.Provider value={own}>{children}</held.Provider>,
    });
  }
  Item.displayName = `${prefix}.Item`;

  function ItemText(props: PartProps): ReactNode {
    const api = context.use();
    const item = held.use();
    return renderPart(`${prefix}.ItemText`, "span", api.getItemTextProps({ item }), props);
  }
  ItemText.displayName = `${prefix}.ItemText`;

  function ItemIndicator(props: PartProps): ReactNode {
    const api = context.use();
    const item = held.use();
    return renderPart(
      `${prefix}.ItemIndicator`,
      "span",
      api.getItemIndicatorProps({ item }),
      props,
    );
  }
  ItemIndicator.displayName = `${prefix}.ItemIndicator`;

  return {
    /** The collection's item the part is inside. */
    useItemContext: held.use,
    Item,
    ItemText,
    ItemIndicator,
    ItemGroup: part<"div", { id: string }>(
      "ItemGroup",
      (api, own) => api.getItemGroupProps(own as { id: string }),
      "div",
      ["id"],
    ),
    ItemGroupLabel: part<"div", { htmlFor: string }>(
      "ItemGroupLabel",
      (api, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
      "div",
      ["htmlFor"],
    ),
  };
}
