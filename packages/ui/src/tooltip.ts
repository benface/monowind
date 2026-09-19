import * as Tooltip from "@zag-js/tooltip";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { anchoredApi, positionedProps, type MachineProps } from "./anchor.ts";
import { mount, start, type Mounted } from "./vanilla.ts";

export type Props = Tooltip.Props;
export type Api<T extends PropTypes = PropTypes> = Tooltip.Api<T>;
export type Service = Tooltip.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Tooltip.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/tooltip";

/** The machine's props, `props()`'s return, with Zag's placement off. */
export function props(machineProps: Props): GridProps {
  return positionedProps<Props, GridProps>(machineProps);
}

/** Zag's API for a service, with the grid's props: `api()` over Zag's
 * `connect`, one import for the framework path. */
export function connect<T extends PropTypes>(
  service: Tooltip.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Tooltip.Api<T> {
  return api(Tooltip.connect(service, normalize), normalize, machineProps);
}

/** Zag's API with the grid's props: the trigger named as the anchor,
 * the positioner placed against it, the content shown by it. */
export function api<T extends PropTypes>(
  zag: Tooltip.Api<T>,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Tooltip.Api<T> {
  return anchoredApi(zag, normalize, machineProps, "bottom");
}

/** A tooltip on markup marked with `data-part`: `trigger`,
 * `positioner`, `content`. */
export function tooltip(root: Element, machineProps: Props): Mounted<Api> {
  const gridProps = props(machineProps);
  return mount(root, start(Tooltip.machine, gridProps), (service) =>
    connect(service, normalizeProps, gridProps),
  );
}
