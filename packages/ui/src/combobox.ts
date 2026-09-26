import * as Combobox from "@zag-js/combobox";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import {
  anchorName,
  anchoringOf,
  omit,
  positionedProps,
  positionerProps,
  triggerProps,
  withProps,
  type MachineProps,
} from "./anchor.ts";
import { itemParts, withMarkupItems, type WithMarkupItems } from "./items.ts";
import { scrollToItem } from "./scroll.ts";
import { liveProps, mountAnchored, part, start, type Mounted } from "./vanilla.ts";

export type Props = Combobox.Props;
export type Api<T extends PropTypes = PropTypes> = Combobox.Api<T>;
export type Service = Combobox.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Combobox.machine>;

const zagActions = Combobox.machine.implementations!.actions!;

/** Zag's machine, for the framework's `useMachine` and the mount, with
 * the list a keystroke opens leaving the reader's caret where it was
 * (specs/ui.md "Shape"). */
export const machine: typeof Combobox.machine = {
  ...Combobox.machine,
  implementations: {
    ...Combobox.machine.implementations,
    actions: {
      ...zagActions,
      setInitialFocus(params) {
        const { event } = params;
        if (event.type === "INPUT.CHANGE" || event.previousEvent?.type === "INPUT.CHANGE") return;
        zagActions["setInitialFocus"]!(params);
      },
    },
  },
};
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/combobox";
/** Zag's collection, the items a combobox holds. */
export { collection } from "@zag-js/combobox";

/** The machine's props, `props()`'s return, with Zag's placement off
 * and the grid's scroll under a props' own. */
export function props(machineProps: Props): GridProps {
  return positionedProps<Props, GridProps>({ scrollToIndexFn: scrollToItem, ...machineProps });
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Combobox.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Combobox.Api<T> {
  return api(Combobox.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the positioner placed against the
 * anchor, the content shown by it. The anchor is the `control` — the
 * box around the input and the trigger — not the trigger alone, so
 * the list lines up under what the reader types into rather than
 * under the button beside it. */
export function api<T extends PropTypes>(
  zag: Combobox.Api<T>,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Combobox.Api<T> {
  const { id } = machineProps;
  const anchoring = anchoringOf(machineProps, "bottom-start");
  return {
    ...zag,
    getControlProps: () => withProps(normalize, zag.getControlProps(), triggerProps(id)),
    getPositionerProps: () =>
      withProps(
        normalize,
        omit(zag.getPositionerProps(), "style"),
        positionerProps(anchorName(id), anchoring),
      ),
    getContentProps: () => omit(zag.getContentProps(), "hidden"),
  };
}

/** The props the mount takes, the marked items its collection where
 * the props name none. */
export type MountProps = WithMarkupItems<Props>;

/** A combobox on markup marked with `data-part` (the parts in the
 * README): the mount's own element is the `root`, and under it a
 * `label` and a `control` holding the `input` the reader types into,
 * a `trigger` beside it and a `clear-trigger`, then the `positioner`
 * and its `content` of `item`s, as a listbox's, with an optional
 * `list` around them. The marked items are the collection where the
 * props name none, and filtering them is the page's own: give the
 * props a `collection` built from what `onInputValueChange` hands
 * you, and the items it leaves out are hidden. */
export function combobox(root: Element, machineProps: MountProps): Mounted<Api> {
  const live = liveProps(
    withMarkupItems(root, machineProps, machineProps.multiple === true),
    props,
  );
  const label = part(root, "label");
  const control = part(root, "control");
  const input = part(root, "input");
  const clearTrigger = part(root, "clear-trigger");
  const list = part(root, "list");
  // A combobox filters by narrowing the collection, so an item it
  // drops is hidden rather than left standing as plain markup.
  const wireItems = itemParts<Api>(root, "combobox", () => ({}), true);
  return mountAnchored(
    root,
    start(machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    (current, spread) => {
      spread(root, omit(current.getRootProps(), "id"));
      spread(label, current.getLabelProps());
      spread(control, current.getControlProps());
      spread(input, current.getInputProps());
      spread(clearTrigger, current.getClearTriggerProps());
      spread(list, current.getListProps());
      wireItems(current, spread);
    },
    live,
  );
}
