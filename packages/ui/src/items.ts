import { ListCollection } from "@zag-js/collection";
import type { ItemApi } from "./framework.ts";
import { part, parts, type Spread } from "./vanilla.ts";

/** An item as the markup gives it, in the keys Zag's own collection
 * defaults read. */
interface MarkupItem {
  value: string;
  label: string;
  disabled: boolean;
}

/** A component's props as its mount takes them: Zag's, with the
 * collection optional where the marked items can make one. */
export type WithMarkupItems<P extends { collection: unknown }> = Omit<P, "collection"> & {
  collection?: P["collection"] | undefined;
};

/** An item's label for typeahead and for the value as a string: its
 * `item-text` where it has one, so an indicator's glyph stays out. */
const labelOf = (item: HTMLElement): string =>
  ((part(item, "item-text") ?? item).textContent ?? "").trim();

/** The collection the marked items make, in markup order: the value
 * each carries, its text, and whether `data-disabled` marks it. */
export function markupCollection(root: Element): ListCollection<MarkupItem> {
  return new ListCollection({
    items: parts(root, "item").map((item) => ({
      value: item.dataset["value"] ?? "",
      label: labelOf(item),
      disabled: item.hasAttribute("data-disabled"),
    })),
  });
}

/** The parts a listbox and a select share, found once and wired on
 * each render: every `item` by its `data-value`, the `item-text` and
 * `item-indicator` inside it, and the `item-group`s and
 * `item-group-label`s by the group's id, with the props an item takes
 * past its own, read per render (a listbox's `highlightOnHover`, which
 * its root can gain or lose). */
export function itemParts<A extends ItemApi>(
  root: Element,
  itemProps: () => { highlightOnHover?: boolean } = () => ({}),
): (api: A, spread: Spread) => void {
  const groups = parts(root, "item-group");
  const groupLabels = parts(root, "item-group-label");
  const items = parts(root, "item").map((element) => ({
    element,
    value: element.dataset["value"] ?? "",
    text: part(element, "item-text"),
    indicator: part(element, "item-indicator"),
  }));
  return (api, spread) => {
    const extra = itemProps();
    for (const group of groups) {
      spread(group, api.getItemGroupProps({ id: group.dataset["value"] ?? "" }));
    }
    for (const groupLabel of groupLabels) {
      const htmlFor = groupLabel.dataset["value"] ?? "";
      spread(groupLabel, api.getItemGroupLabelProps({ htmlFor }));
    }
    for (const { element, value, text, indicator } of items) {
      // The collection holds what the component knows: an item the
      // author's own collection leaves out stays plain markup.
      const item = api.collection.find(value);
      if (item === null) continue;
      const props = { item, ...extra };
      spread(element, api.getItemProps(props));
      spread(text, api.getItemTextProps(props));
      spread(indicator, api.getItemIndicatorProps(props));
    }
  };
}
