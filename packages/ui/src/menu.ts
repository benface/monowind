import * as Menu from "@zag-js/menu";
import { normalizeProps, type VanillaMachine } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { anchoredApi, pick, positionedProps, type MachineProps, type SchemaOf } from "./anchor.ts";
import { mountAnchored, parts, start, type Mounted } from "./vanilla.ts";

export type Props = Menu.Props;
export type Api<T extends PropTypes = PropTypes> = Menu.Api<T>;
export type Service = Menu.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Menu.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/menu";

/** The machine's props, `props()`'s return, with Zag's placement off. */
export function props(machineProps: Props): GridProps {
  return positionedProps<Props, GridProps>(machineProps);
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Menu.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Menu.Api<T> {
  return api(Menu.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the trigger named as the anchor, the
 * positioner placed against it, the content shown by it. A submenu's
 * trigger item takes the submenu's own trigger props, so a submenu
 * wrapped the same way names it. */
export function api<T extends PropTypes>(
  zag: Menu.Api<T>,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Menu.Api<T> {
  return anchoredApi(zag, normalize, machineProps, "bottom-start");
}

/** A menu on markup marked with `data-part` (the parts in the README),
 * a `submenu` root mounted as a menu of its own beside the
 * `trigger-item` before it, on the parent's behavior props. */
export function menu(root: Element, machineProps: Props): Mounted<Api> {
  return mountMenu(root, machineProps).mounted;
}

/** The parent's props a submenu takes, Zag calling a menu's `onSelect`
 * for its own items: how its items behave and select. */
const SHARED = [
  "closeOnSelect",
  "composite",
  "dir",
  "getRootNode",
  "loopFocus",
  "navigate",
  "onSelect",
  "typeahead",
] as const satisfies readonly (keyof Props)[];

/** A submenu's props: its id under the parent's, placed beside its item
 * on the reading side, the parent's shared props. */
function submenuProps(parent: Props, value: string): Props {
  return {
    id: `${parent.id}-${value}`,
    positioning: { placement: parent.dir === "rtl" ? "left-start" : "right-start" },
    ...pick(parent, SHARED),
  };
}

/** A mounted menu with its machine, for the menu above it to link to
 * and follow; the links are made before the mount, so the first spread
 * already carries them. */
interface MenuMount {
  mounted: Mounted<Api>;
  machine: VanillaMachine<SchemaOf<typeof Menu.machine>>;
}

/** The trigger item a submenu root follows: the nearest earlier sibling
 * marked so. Zag's spread writes its own value and id on the item, so
 * the pairing is the markup's order. */
function triggerItemBefore(submenu: Element): HTMLElement | undefined {
  for (let el = submenu.previousElementSibling; el; el = el.previousElementSibling) {
    if (el.matches("[data-part='trigger-item']")) return el as HTMLElement;
  }
  return undefined;
}

function mountMenu(root: Element, machineProps: Props): MenuMount {
  const gridProps = props(machineProps);
  const machine = start(Menu.machine, gridProps);
  const items = parts(root, "item");
  const groups = parts(root, "item-group");
  const labels = parts(root, "item-group-label");
  const separators = parts(root, "separator");
  const submenus = parts(root, "submenu").map((child) => ({
    item: triggerItemBefore(child),
    ...mountMenu(child, submenuProps(machineProps, child.dataset["value"] ?? "")),
  }));
  const grid = (service: Menu.Service): Api => connect(service, normalizeProps, gridProps);
  for (const submenu of submenus) {
    grid(machine.service).setChild(submenu.machine.service);
    submenu.mounted.api.setParent(machine.service);
  }
  const mounted = mountAnchored(
    root,
    machine,
    grid,
    (api, spread) => {
      for (const item of items) {
        spread(
          item,
          api.getItemProps({
            value: item.dataset["value"] ?? "",
            disabled: item.hasAttribute("data-disabled"),
          }),
        );
      }
      for (const group of groups) {
        spread(group, api.getItemGroupProps({ id: group.dataset["value"] ?? "" }));
      }
      for (const label of labels) {
        spread(label, api.getItemGroupLabelProps({ htmlFor: label.dataset["value"] ?? "" }));
      }
      for (const separator of separators) spread(separator, api.getSeparatorProps());
      for (const submenu of submenus) {
        spread(submenu.item, api.getTriggerItemProps(submenu.mounted.api));
      }
    },
    submenus.map((submenu) => submenu.machine),
  );
  return {
    machine,
    mounted: {
      get api() {
        return mounted.api;
      },
      destroy() {
        mounted.destroy();
        for (const submenu of submenus) submenu.mounted.destroy();
      },
    },
  };
}
