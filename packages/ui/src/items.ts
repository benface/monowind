import { ListCollection } from "@zag-js/collection";
import { warnUnmarked, type ItemApi } from "./framework.ts";
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
export type WithMarkupItems<P extends { collection?: unknown }> = Omit<P, "collection"> & {
  collection?: P["collection"] | undefined;
};

/** The selection props the markup can stand in for. */
interface Selection {
  value?: string[] | undefined;
  defaultValue?: string[] | undefined;
}

/** An item's label for typeahead and for the value as a string: its
 * `item-text` where it has one, so an indicator's glyph stays out. */
const labelOf = (item: HTMLElement): string =>
  ((part(item, "item-text") ?? item).textContent ?? "").trim();

/** A mount's props with the markup standing in for what they leave
 * out: the marked items as the collection, and those `data-selected`
 * marks as the initial selection — the first alone where one value is
 * taken. */
export function withMarkupItems<P extends WithMarkupItems<{ collection?: unknown }> & Selection>(
  root: Element,
  props: P,
  multiple: boolean,
): P & { collection: NonNullable<P["collection"]> | ListCollection<MarkupItem> } {
  const marked = parts(root, "item")
    .filter((item) => item.hasAttribute("data-selected"))
    .map((item) => item.dataset["value"] ?? "");
  const initial =
    props.value === undefined && props.defaultValue === undefined && marked.length > 0
      ? { defaultValue: multiple ? marked : marked.slice(0, 1) }
      : {};
  return { ...props, ...initial, collection: props.collection ?? markupCollection(root) };
}

/** The collection the marked items make, in markup order: the value
 * each carries, its text, and whether `data-disabled` marks it. */
function markupCollection(root: Element): ListCollection<MarkupItem> {
  return new ListCollection({
    items: parts(root, "item").map((item) => ({
      value: item.dataset["value"] ?? "",
      label: labelOf(item),
      disabled: item.hasAttribute("data-disabled"),
    })),
  });
}

/** The parts a listbox, a select and a combobox share, found once and
 * wired on each render: every `item` by its `data-value`, with its
 * `item-text` and `item-indicator`, and the `item-group`s and their
 * labels by the group's id; `itemProps` read per render (a listbox's
 * root can gain or lose `highlightOnHover`); and the API's `value`
 * marked on the items. */
export function itemParts<A extends ItemApi & { value: string[] }>(
  root: Element,
  /** The component's name, for the warning where it finds no item. */
  name: string,
  itemProps: () => { highlightOnHover?: boolean } = () => ({}),
  /** Whether an item the collection leaves out is hidden rather than
   * left as plain markup: a combobox filters by narrowing the
   * collection, so the items it drops must go. */
  hideUnlisted = false,
): (api: A, spread: Spread) => void {
  const groups = parts(root, "item-group");
  const groupLabels = parts(root, "item-group-label");
  const items = parts(root, "item").map((element) => ({
    element,
    value: element.dataset["value"] ?? "",
    text: part(element, "item-text"),
    indicator: part(element, "item-indicator"),
  }));
  let warned = false;
  return (api, spread) => {
    if (!warned) {
      warned = true;
      warnUnmarked(name, api.collection.size, items.length);
    }
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
      // author's own collection leaves out stays plain markup, or
      // goes entirely where the component filters by collection.
      const item = api.collection.find(value);
      if (hideUnlisted && element instanceof HTMLElement) element.hidden = item === null;
      if (item !== null) {
        const props = { item, ...extra };
        spread(element, api.getItemProps(props));
        spread(text, api.getItemTextProps(props));
        spread(indicator, api.getItemIndicatorProps(props));
      }
      // `data-selected` follows the selection on every item, listed or not,
      // for a remount to read; after the spread, which writes it on a
      // listbox's items.
      element.toggleAttribute("data-selected", api.value.includes(value));
    }
  };
}
