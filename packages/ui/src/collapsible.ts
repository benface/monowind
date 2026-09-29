import * as Collapsible from "@zag-js/collapsible";
import { normalizeProps } from "@zag-js/vanilla";
import type { NormalizeProps, PropTypes } from "@zag-js/types";
import { asMachineProps, omit, type MachineProps } from "./anchor.ts";
import { liveProps, mount, partsOutside, start, type Mounted } from "./vanilla.ts";

export type Props = Collapsible.Props;
export type Api<T extends PropTypes = PropTypes> = Collapsible.Api<T>;
export type Service = Collapsible.Service;
/** The props as the machine takes them, `props()`'s return. */
export type GridProps = MachineProps<typeof Collapsible.machine>;

/** Zag's machine, for the framework's `useMachine`. */
export { machine } from "@zag-js/collapsible";
/** The machine props' names, for a framework that declares its
 * components' props at runtime. */
export { props as propNames } from "@zag-js/collapsible";

/** The machine's props as it takes them, `props()`'s return. */
export function props(machineProps: Props): GridProps {
  return asMachineProps(machineProps);
}

/** Zag's API for a service: `api()` over Zag's `connect`, one import
 * for the framework path. */
export function connect<T extends PropTypes>(
  service: Collapsible.Service,
  normalize: NormalizeProps<T>,
  machineProps: GridProps,
): Collapsible.Api<T> {
  return api(Collapsible.connect(service, normalize), normalize, machineProps);
}

/** The content's size, measured in the page's px, which the grid would
 * read on its spacing scale (specs/ui.md). */
const SIZE = ["--height", "--width"];

/** A style without the size variables, in the adapter's shape: a string
 * (Svelte) or an object. */
function withoutSize(style: unknown): unknown {
  if (typeof style === "string") {
    return style
      .split(";")
      .filter((declaration) => !SIZE.includes(declaration.split(":")[0]!.trim()))
      .join(";");
  }
  if (typeof style !== "object" || style === null) return style;
  const rest = { ...(style as Record<string, unknown>) };
  for (const name of SIZE) delete rest[name];
  return rest;
}

/** Zag's API as the grid takes it: a collapsible stands in the flow,
 * and its content drops the size variables (specs/ui.md). */
export function api<T extends PropTypes>(
  zag: Collapsible.Api<T>,
  _normalize: NormalizeProps<T>,
  _machineProps: GridProps,
): Collapsible.Api<T> {
  return {
    ...zag,
    getContentProps: () => {
      const content = zag.getContentProps() as { style?: unknown };
      return { ...content, style: withoutSize(content.style) } as ReturnType<
        typeof zag.getContentProps
      >;
    },
  };
}

/** A collapsible on markup marked with `data-part` (the parts in the
 * README): the mount's own element is the `root`, and under it a
 * `trigger`, the `content`, and an optional `indicator` — a
 * collapsible inside its content keeping its own. */
export function collapsible(root: Element, machineProps: Props): Mounted<Api> {
  const live = liveProps(machineProps, props);
  const [trigger] = partsOutside(root, "trigger", "content");
  const [content] = partsOutside(root, "content", "content");
  const [indicator] = partsOutside(root, "indicator", "content");
  return mount(
    start(Collapsible.machine, () => live.machine),
    (service) => connect(service, normalizeProps, live.machine),
    (current, spread) => {
      spread(root, omit(current.getRootProps(), "id"));
      spread(trigger, current.getTriggerProps());
      spread(content, current.getContentProps());
      spread(indicator, current.getIndicatorProps());
    },
    live,
  );
}
