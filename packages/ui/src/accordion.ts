import * as Accordion from "@zag-js/accordion";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { asMachineProps, type MachineProps } from "./anchor.ts";
import { liveProps, mount, part, parts, start, type Mounted } from "./vanilla.ts";

export type Props = Accordion.Props;
/** An item's props: its value, and whether it is disabled. */
export type ItemProps = Accordion.ItemProps;
export type Api<T extends PropTypes = PropTypes> = Accordion.Api<T>;
export type Service = Accordion.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Accordion.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/accordion";
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/accordion";

/** The machine's props as it takes them, `props()`'s return. */
export function props(machineProps: Props): GridProps {
  return asMachineProps(machineProps);
}

/** Zag's API for a service, one import for the framework path. An
 * accordion stands in the flow, so its API is Zag's (specs/ui.md). */
export function connect<T extends PropTypes>(
  service: Accordion.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Accordion.Api<T> {
  return api(Accordion.connect(service, normalize), normalize, machineProps);
}

/** Zag's API as the grid takes it: Zag's own, the parts laying out as
 * any box's. */
export function api<T extends PropTypes>(
  zag: Accordion.Api<T>,
  _normalize: NormalizeProps<T>,
  _machineProps: GridProps,
): Accordion.Api<T> {
  return zag;
}

/** An accordion on markup marked with `data-part` (the parts in the
 * README): the mount's own element is the `root`, its id Zag's root id,
 * by which Zag finds the triggers the keys walk; under it an `item` per
 * value, carrying its `data-value` and `data-disabled`, with an
 * `item-trigger`, an `item-content` and an optional `item-indicator`
 * inside.
 * Where the props name no value, the items marked `data-state="open"`
 * are open, the first alone unless `multiple`. */
export function accordion(root: Element, machineProps: Props): Mounted<Api> {
  const items = parts(root, "item").map((item) => ({
    props: { value: item.dataset["value"] ?? "", disabled: item.hasAttribute("data-disabled") },
    item,
    trigger: part(item, "item-trigger"),
    content: part(item, "item-content"),
    indicator: part(item, "item-indicator"),
  }));
  const open = items
    .filter(({ item }) => item.dataset["state"] === "open")
    .map(({ props }) => props.value);
  const initial =
    machineProps.value === undefined && machineProps.defaultValue === undefined && open.length > 0
      ? { defaultValue: machineProps.multiple ? open : open.slice(0, 1) }
      : {};
  const ids = root.id ? { ids: { root: root.id, ...machineProps.ids } } : {};
  const live = liveProps({ ...machineProps, ...initial, ...ids }, props);
  return mount(
    start(Accordion.machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    (current, spread) => {
      spread(root, current.getRootProps());
      for (const { props, item, trigger, content, indicator } of items) {
        spread(item, current.getItemProps(props));
        spread(trigger, current.getItemTriggerProps(props));
        spread(content, current.getItemContentProps(props));
        spread(indicator, current.getItemIndicatorProps(props));
      }
    },
    live,
  );
}
