import * as Select from "@zag-js/select";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { anchoredApi, omit, positionedProps, type MachineProps } from "./anchor.ts";
import { itemParts, markupCollection, type WithMarkupItems } from "./items.ts";
import { scrollToItem } from "./scroll.ts";
import { liveProps, mountAnchored, part, start, type Mounted } from "./vanilla.ts";

export type Props = Select.Props;
export type Api<T extends PropTypes = PropTypes> = Select.Api<T>;
export type Service = Select.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Select.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/select";
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/select";
/** Zag's collection, the items a select holds. */
export { collection } from "@zag-js/select";

/** The machine's props, `props()`'s return, with Zag's placement off
 * and the grid's scroll under a props' own. */
export function props(machineProps: Props): GridProps {
  return positionedProps<Props, GridProps>({ scrollToIndexFn: scrollToItem, ...machineProps });
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Select.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Select.Api<T> {
  return api(Select.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the trigger named as the anchor,
 * the positioner placed against it, the content shown by it. */
export function api<T extends PropTypes>(
  zag: Select.Api<T>,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Select.Api<T> {
  return anchoredApi(zag, normalize, machineProps, "bottom-start");
}

/** The props the mount takes, the marked items its collection where
 * the props name none. */
export type MountProps = WithMarkupItems<Props>;

/** The native control behind the widget, filled with an option per
 * item. A select is a trigger and a listbox, not a form control, so
 * this real `<select>` beside it is what carries the value into a
 * form and a reset; Zag gives it `aria-hidden` and `tabIndex: -1`,
 * the visible widget owning every semantic.
 *
 * Hidden HERE, not left to Zag's own visually-hidden style, because
 * that style arrives with the first spread, which is a microtask
 * late: an in-flow `<select>` is a box as wide as its longest option
 * (7 cells for "release"), so the grid would jump. Either hiding
 * suits the grid — measured, an absolutely positioned clipped
 * control takes no cells — and `display: none` is the shorter one to
 * write, and the one a browser will not try to autofill behind the
 * machine's back. */
function prepareHiddenSelect(root: Element, values: string[]): HTMLSelectElement | undefined {
  const element = part(root, "hidden-select");
  if (!(element instanceof HTMLSelectElement)) return undefined;
  element.style.display = "none";
  element.replaceChildren(
    ...values.map((value) => {
      const option = element.ownerDocument.createElement("option");
      option.value = value;
      return option;
    }),
  );
  return element;
}

/** A select on markup marked with `data-part` (the parts in the
 * README): the mount's own element is the `root`, and under it a
 * `label`, a `control` holding the `trigger` — with a `value-text` and
 * an `indicator` inside it — and a `clear-trigger`, then the
 * `positioner` and its `content` of `item`s, as a listbox's, with an
 * optional `list` around them and a `hidden-select` for a form. The
 * marked items are the collection where the props name none, and the
 * text the markup gives the `value-text` is its placeholder. */
export function select(root: Element, machineProps: MountProps): Mounted<Api> {
  const live = liveProps(
    { ...machineProps, collection: machineProps.collection ?? markupCollection(root) },
    props,
  );
  const label = part(root, "label");
  const control = part(root, "control");
  const indicator = part(root, "indicator");
  const valueText = part(root, "value-text");
  const clearTrigger = part(root, "clear-trigger");
  const list = part(root, "list");
  const wireItems = itemParts<Api>(root);
  const placeholder = valueText?.textContent ?? "";
  const hiddenSelect = prepareHiddenSelect(root, live.machine.collection?.getValues() ?? []);
  const mounted = mountAnchored(
    root,
    start(Select.machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    (current, spread) => {
      // The root is the element the mount was given, its id the
      // markup's — the page finds it by that.
      spread(root, omit(current.getRootProps(), "id"));
      spread(label, current.getLabelProps());
      spread(control, current.getControlProps());
      spread(indicator, current.getIndicatorProps());
      spread(clearTrigger, current.getClearTriggerProps());
      spread(valueText, current.getValueTextProps());
      // Written only where it differs: a text change lays the grid
      // out again, and every machine change renders here.
      const value = current.valueAsString || placeholder;
      if (valueText && valueText.textContent !== value) valueText.textContent = value;
      spread(list, current.getListProps());
      wireItems(current, spread);
      spread(hiddenSelect, current.getHiddenSelectProps());
      // The adapter assigns Zag's `defaultValue` as the element's
      // `value`, which one taking several ignores: there the options
      // carry the selection.
      if (hiddenSelect?.multiple) {
        for (const option of hiddenSelect.options) {
          option.selected = current.value.includes(option.value);
        }
      }
    },
    [],
    live,
  );
  return {
    get api() {
      return mounted.api;
    },
    updateProps(partial) {
      mounted.updateProps(partial);
    },
    destroy() {
      mounted.destroy();
      // The placeholder goes back, so a mount on the same markup
      // reads it again rather than the value it showed.
      if (valueText) valueText.textContent = placeholder;
    },
  };
}
