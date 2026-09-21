import * as Listbox from "@zag-js/listbox";
import { getInteractionModality } from "@zag-js/focus-visible";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { asMachineProps, omit, withHandlers, type MachineProps } from "./anchor.ts";
import { itemParts, markupCollection, type WithMarkupItems } from "./items.ts";
import { scrollToItem } from "./scroll.ts";
import { mount, part, start, type Mounted } from "./vanilla.ts";

export type Props = Listbox.Props;
export type Api<T extends PropTypes = PropTypes> = Listbox.Api<T>;
export type Service = Listbox.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Listbox.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/listbox";
/** Zag's collections, the items a listbox holds: a list, or a grid of
 * items in `columnCount` columns. */
export { collection, gridCollection } from "@zag-js/listbox";

/** The machine's props as it takes them, `props()`'s return, with the
 * grid's scroll under a props' own. */
export function props(machineProps: Props): GridProps {
  return asMachineProps({ scrollToIndexFn: scrollToItem, ...machineProps });
}

/** Zag's API for a service: `api()` over Zag's `connect`, one import
 * for the framework path. */
export function connect<T extends PropTypes>(
  service: Listbox.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Listbox.Api<T> {
  return api(Listbox.connect(service, normalize), normalize, machineProps);
}

/** The item a value marks, scrolled into view where the reader is not
 * pointing: the machine scrolls a highlight it moves and skips the
 * pointer's own, so this covers the one it holds unchanged. */
function showItem(content: Element | null, value: string, index: number): void {
  if (content === null || getInteractionModality() === "pointer") return;
  const items = content.querySelectorAll<HTMLElement>("[data-part='item']");
  const item = Array.from(items).find((element) => element.dataset["value"] === value);
  if (item) scrollToItem({ index, getElement: () => item });
}

/** Zag's API as the grid takes it: a listbox stands in the flow, so
 * its parts lay out as any box's and the only prop of ours is the
 * content's focus — which starts at the selection, else the first item
 * (ARIA's listbox pattern), and shows there, a composite's own cells
 * staying plain with no focus ring to fall back on
 * (specs/cell-model.md). */
export function api<T extends PropTypes>(
  zag: Listbox.Api<T>,
  normalize: NormalizeProps<T>,
  _machineProps: GridProps,
): Listbox.Api<T> {
  return {
    ...zag,
    getContentProps: () =>
      withHandlers(normalize, zag.getContentProps(), {
        onFocus: (event: { currentTarget: Element | null }) => {
          const value = zag.value[0] ?? zag.collection.firstValue;
          if (value == null) return;
          zag.highlightValue(value);
          showItem(event.currentTarget, value, zag.collection.indexOf(value));
        },
      }),
  };
}

/** The props the mount takes, the marked items its collection where
 * the props name none. */
export type MountProps = WithMarkupItems<Props>;

/** A listbox on markup marked with `data-part` (the parts in the
 * README): the mount's own element is the `root`, and under it `label`,
 * `content`, and per item an `item` carrying its `data-value`, with an
 * `item-text` and an `item-indicator` inside it; `item-group` and
 * `item-group-label` carry the group's id as their `data-value`. The
 * marked items are the collection where the props name none, and
 * `data-highlight-on-hover` on the root moves the highlight to the item
 * the pointer is on. */
export function listbox(root: Element, machineProps: MountProps): Mounted<Api> {
  const gridProps = props({
    ...machineProps,
    collection: machineProps.collection ?? markupCollection(root),
  });
  const label = part(root, "label");
  const content = part(root, "content");
  const wireItems = itemParts<Api>(root, () => ({
    highlightOnHover: root.hasAttribute("data-highlight-on-hover"),
  }));
  return mount(
    start(Listbox.machine, gridProps),
    (service) => connect(service, normalizeProps, gridProps),
    (current, spread) => {
      // The root is the element the mount was given, its id the
      // markup's — the page finds it by that.
      spread(root, omit(current.getRootProps(), "id"));
      spread(label, current.getLabelProps());
      spread(content, current.getContentProps());
      wireItems(current, spread);
    },
  );
}
