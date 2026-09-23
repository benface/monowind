import * as Select from "@zag-js/select";
import { VanillaMachine, normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { anchoredApi, omit, positionedProps, type MachineProps } from "./anchor.ts";
import { itemParts, withMarkupItems, type WithMarkupItems } from "./items.ts";
import { scrollToItem } from "./scroll.ts";
import { liveProps, mountAnchored, part, type Mounted } from "./vanilla.ts";

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

/** The native control that carries the value into a form and a reset
 * (specs/ui.md "A select is a listbox on a trigger"). Hidden here, as
 * Zag's visually-hidden style arrives with the first spread, a
 * microtask after the grid first measures the control; `display: none`
 * keeps it out of the layout and of a browser's autofill. Zag's id and
 * form go on here too: the machine looks the control up by that id as
 * it starts. */
function prepareHiddenSelect(
  root: Element,
  zagProps: { id?: string; form?: string },
): HTMLSelectElement | undefined {
  const element = part(root, "hidden-select");
  if (!(element instanceof HTMLSelectElement)) return undefined;
  element.style.display = "none";
  if (zagProps.id !== undefined) element.id = zagProps.id;
  if (zagProps.form !== undefined) element.setAttribute("form", zagProps.form);
  return element;
}

/** A value as a double-quoted attribute's text; a carriage return as a
 * reference, as HTML's parsing turns a literal one into a line feed. */
const quoted = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;");

/** The options `syncHiddenSelect` writes, as markup, for a framework's
 * `HiddenSelect` to render once, at its first render, so a server's page
 * posts the initial value; `syncHiddenSelect` owns them from then on. */
export function hiddenSelectOptions(
  api: Pick<Select.Api, "collection">,
  service: Pick<Select.Service, "context">,
): string {
  const initial = service.context.initial("value") ?? [];
  return api.collection
    .getValues()
    .map(
      (value) =>
        `<option value="${quoted(value)}"${initial.includes(value) ? " selected" : ""}></option>`,
    )
    .join("");
}

/** The native control a form posts, as the machine has it: an option
 * per value the collection holds, rewritten when the values change; the
 * machine's initial value, Zag's reset target, as the options a form's
 * reset selects; and the value selected. The mount and every
 * framework's `HiddenSelect` call this after each render. */
export function syncHiddenSelect(
  element: HTMLSelectElement,
  api: Pick<Select.Api, "collection" | "value">,
  service: Pick<Select.Service, "context">,
): void {
  // Two rows exempt the control from HTML's selectedness setting, which
  // gives a one-row single control its first option wherever none is
  // selected; the control is never displayed.
  if (element.getAttribute("size") !== "2") element.setAttribute("size", "2");
  const values = api.collection.getValues();
  const { options } = element;
  if (options.length !== values.length || values.some((value, i) => options[i]!.value !== value)) {
    element.replaceChildren(
      ...values.map((value) => {
        const option = element.ownerDocument.createElement("option");
        option.value = value;
        return option;
      }),
    );
  }
  const initial = service.context.initial("value") ?? [];
  for (const option of options) {
    const isDefault = initial.includes(option.value);
    if (option.hasAttribute("selected") !== isDefault)
      option.toggleAttribute("selected", isDefault);
  }
  if (element.multiple) {
    for (const option of options) {
      const selected = api.value.includes(option.value);
      if (option.selected !== selected) option.selected = selected;
    }
    return;
  }
  const index = api.value.length === 0 ? -1 : values.indexOf(api.value[0]!);
  if (element.selectedIndex !== index) element.selectedIndex = index;
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
    withMarkupItems(root, machineProps, machineProps.multiple === true),
    props,
  );
  const label = part(root, "label");
  const control = part(root, "control");
  const indicator = part(root, "indicator");
  const valueText = part(root, "value-text");
  const clearTrigger = part(root, "clear-trigger");
  const list = part(root, "list");
  const wireItems = itemParts<Api>(root, "select");
  const placeholder = valueText?.textContent ?? "";
  const machine = new VanillaMachine(Select.machine, () => live.machine);
  const hiddenSelect = prepareHiddenSelect(
    root,
    Select.connect(machine.service, normalizeProps).getHiddenSelectProps(),
  );
  machine.start();
  const mounted = mountAnchored(
    root,
    machine,
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
      // The options and their selection are `syncHiddenSelect`'s.
      spread(hiddenSelect, omit(current.getHiddenSelectProps(), "value"));
      if (hiddenSelect) syncHiddenSelect(hiddenSelect, current, machine.service);
    },
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
