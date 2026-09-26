import * as Popover from "@zag-js/popover";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { anchoredApi, positionedProps, type MachineProps } from "./anchor.ts";
import { liveProps, mountAnchored, start, titledParts, type Mounted } from "./vanilla.ts";

/** An interface of its own, for the reason menu.ts's `Props` is. */
export interface Props extends Popover.Props {}
export type Api<T extends PropTypes = PropTypes> = Popover.Api<T>;
export type Service = Popover.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Popover.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/popover";
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/popover";

/** The machine's props, `props()`'s return, with Zag's placement off. */
export function props(machineProps: Props): GridProps {
  return positionedProps<Props, GridProps>(machineProps);
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Popover.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Popover.Api<T> {
  return api(Popover.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the trigger named as the anchor,
 * the positioner placed against it, the content shown by it. */
export function api<T extends PropTypes>(
  zag: Popover.Api<T>,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Popover.Api<T> {
  return anchoredApi(zag, normalize, machineProps, "bottom");
}

/** A popover on markup marked with `data-part`: `trigger`,
 * `positioner`, `content`, and inside it `title`, `description`, and
 * `close-trigger`. */
export function popover(root: Element, machineProps: Props): Mounted<Api> {
  const live = liveProps(machineProps, props);
  return mountAnchored(
    root,
    start(Popover.machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    titledParts(root),
    live,
  );
}
