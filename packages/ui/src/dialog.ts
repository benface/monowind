import * as Dialog from "@zag-js/dialog";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { asMachineProps, omit, withProps, type MachineProps } from "./anchor.ts";
import { liveProps, mountAnchored, start, titledParts, type Mounted } from "./vanilla.ts";

/** An interface of this module's own, so a framework package's types
 * reach Zag's through this module, one of its dependencies. */
export interface Props extends Dialog.Props {}
export type Api<T extends PropTypes = PropTypes> = Dialog.Api<T>;
export type Service = Dialog.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Dialog.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/dialog";
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/dialog";

/** The machine's props as it takes them, `props()`'s return. */
export function props(machineProps: Props): GridProps {
  return asMachineProps(machineProps);
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Dialog.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Dialog.Api<T> {
  return api(Dialog.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the positioner a manual popover —
 * the top layer's, centered by the UA in the cells the window shows,
 * its `::backdrop` the dialog's (specs/top-layer.md) — the content
 * shown by it; the props every
 * `api`'s, the `Component` shape. */
export function api<T extends PropTypes>(
  zag: Dialog.Api<T>,
  normalize: NormalizeProps<T>,
  _machineProps: GridProps,
): Dialog.Api<T> {
  return {
    ...zag,
    getPositionerProps: () =>
      withProps(normalize, omit(zag.getPositionerProps(), "style"), { popover: "manual" }),
    getContentProps: () => omit(zag.getContentProps(), "hidden"),
  };
}

/** A dialog on markup marked with `data-part`: `trigger`, `positioner`,
 * `content`, and inside it `title`, `description`, and `close-trigger`. */
export function dialog(root: Element, machineProps: Props): Mounted<Api> {
  const live = liveProps(machineProps, props);
  return mountAnchored(
    root,
    start(Dialog.machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    titledParts(root),
    live,
  );
}
