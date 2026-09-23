import type { Machine } from "@zag-js/core";
import type { NormalizeProps, PropTypes } from "@zag-js/types";

/** A machine's schema, which its type carries. */
export type SchemaOf<M> = M extends Machine<infer S> ? S : never;

/** A machine's props as Zag's adapters take them — the schema's own,
 * which type the optional fields without `undefined` — with the id
 * every machine needs. */
export type MachineProps<M> = Partial<SchemaOf<M>["props"]> & { id: string };

type Side = "top" | "right" | "bottom" | "left";

/** Zag's placements: a side, alone or with the anchor edge the box
 * aligns to. */
export type Placement = Side | `${Side}-${"start" | "end"}`;

/** Where a floating part goes: its placement, the gap to the anchor,
 * and its shift along the anchor from the edge it aligns to, in cells. */
interface Anchoring {
  placement: Placement;
  gutter: number;
  shift: number;
}

/** A placement as the `position-area` that places it
 * (specs/anchor-positioning.md): the side, and from an aligned edge a
 * span across the anchor. */
const AREA: Record<Placement, string> = {
  top: "top",
  "top-start": "top span-right",
  "top-end": "top span-left",
  bottom: "bottom",
  "bottom-start": "bottom span-right",
  "bottom-end": "bottom span-left",
  left: "left",
  "left-start": "left span-bottom",
  "left-end": "left span-top",
  right: "right",
  "right-start": "right span-bottom",
  "right-end": "right span-top",
};

type Margin = "marginTop" | "marginRight" | "marginBottom" | "marginLeft";

/** The margin that keeps the box off the anchor: the anchor's side,
 * which a flip mirrors with the area (specs/anchor-positioning.md). */
const GUTTER: Record<Side, Margin> = {
  top: "marginBottom",
  bottom: "marginTop",
  left: "marginRight",
  right: "marginLeft",
};

/** The margins that shift the box along the anchor: the aligned edge's
 * side for a start or an end alignment; for a centered one, the start
 * side at twice the shift, the box centering with its margins. */
const SHIFT: Record<Side, { start: Margin; end: Margin }> = {
  top: { start: "marginLeft", end: "marginRight" },
  bottom: { start: "marginLeft", end: "marginRight" },
  left: { start: "marginTop", end: "marginBottom" },
  right: { start: "marginTop", end: "marginBottom" },
};

/** Cells as the engine reads them, a quarter rem each. */
const cells = (count: number): string => `${count / 4}rem`;

/** The flips tried when the placement overflows, in order. */
export const FALLBACKS = "flip-block, flip-inline, flip-block flip-inline";

/** A machine's anchor name, a dashed ident from its id — and the
 * trigger's value where a menu has several triggers. */
export function anchorName(id: string, value?: string): string {
  const ident = (text: string) => text.replace(/[^\w-]/g, "-");
  return `--mw-ui-${ident(id)}${value === undefined ? "" : `-${ident(value)}`}`;
}

/** Zag's own placement off — `applyStyles`, `flip`, and `listeners` —
 * so the engine alone places the box, and its size middleware with
 * `sameWidth` and `fitViewport`, which turn it back on: its sizes are
 * pixels, which the grid would read as cells; `anchor-size()` sizes the
 * positioner instead (specs/ui.md). */
const ZAG_PLACEMENT_OFF = {
  applyStyles: false,
  flip: false,
  listeners: false,
  sizeMiddleware: false,
  sameWidth: false,
  fitViewport: false,
} as const;

/** Zag's positioning options with its own placement off. */
export function positioning<T extends object>(
  options: T | undefined,
): T & typeof ZAG_PLACEMENT_OFF {
  return { ...(options ?? ({} as T)), ...ZAG_PLACEMENT_OFF };
}

/** Zag's props as the machine's schema types them: Zag's props type
 * allows an explicit `undefined` where the schema's, under
 * exactOptionalPropertyTypes, does not; the machine reads both alike. */
export function asMachineProps<P, G>(machineProps: P): G {
  return machineProps as unknown as G;
}

/** A machine's props with the grid's positioning: Zag's own placement
 * off, `positioning.placement` the area the engine places the part in,
 * `positioning.gutter` its gap in cells. */
export function positionedProps<P extends { positioning?: object | undefined }, G>(
  machineProps: P,
): G {
  return asMachineProps({ ...machineProps, positioning: positioning(machineProps.positioning) });
}

/** A trigger's own value, where a menu has several. */
interface TriggerValue {
  value?: string | undefined;
}

/** The trigger's props: the anchor name. */
export function triggerProps(id: string, value?: string): { style: { anchorName: string } } {
  return { style: { anchorName: anchorName(id, value) } };
}

/** The positioner's props: a manual popover — the top layer's, shown
 * by `syncTopLayer` — anchored in the placement's area, flipped where
 * it overflows (visibly: the UA's `overflow: auto` would clip), one
 * width, the gutter and the shift its margins in cells, on the anchor's
 * side and the aligned edge's, which a flip mirrors. */
export function positionerProps(
  anchor: string,
  { placement, gutter, shift }: Anchoring,
): { popover: "manual"; style: Record<string, string> } {
  const style: Record<string, string> = {
    positionAnchor: anchor,
    positionArea: AREA[placement],
    positionTryFallbacks: FALLBACKS,
    minWidth: "max-content",
    overflow: "visible",
  };
  const [side, alignment] = placement.split("-") as [Side, "start" | "end" | undefined];
  if (gutter !== 0) style[GUTTER[side]] = cells(gutter);
  if (shift !== 0) style[SHIFT[side][alignment ?? "start"]] = cells(alignment ? shift : 2 * shift);
  return { popover: "manual", style };
}

/** Zag's props of a part with the grid's over them, in the adapter's
 * shape: the styles joined as the adapter writes them, both strings
 * (Svelte) or both objects (React, Vue, Solid, vanilla). */
export function withProps<P extends object, T extends PropTypes>(
  normalize: NormalizeProps<T>,
  zag: P,
  extra: object,
): P {
  const ours = normalize.element(extra as never) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...(zag as Record<string, unknown>), ...ours };
  const { style: below } = zag as { style?: unknown };
  const { style: above } = ours;
  if (below && above) {
    merged["style"] =
      typeof below === "string"
        ? `${below}${below.endsWith(";") ? "" : ";"}${above as string}`
        : { ...(below as object), ...(above as object) };
  }
  return merged as P;
}

/** Zag's props of a part with ours beside them, in the adapter's
 * shape: an event both handle runs Zag's first, then ours, so neither
 * loses the other's. */
export function withHandlers<P extends object, T extends PropTypes>(
  normalize: NormalizeProps<T>,
  zag: P,
  extra: object,
): P {
  const ours = normalize.element(extra as never) as Record<string, (event: never) => void>;
  const merged: Record<string, unknown> = { ...(zag as Record<string, unknown>) };
  for (const [key, ourHandler] of Object.entries(ours)) {
    const theirHandler = merged[key];
    merged[key] =
      typeof theirHandler === "function"
        ? (event: never) => {
            (theirHandler as (event: never) => void)(event);
            ourHandler(event);
          }
        : ourHandler;
  }
  return merged as P;
}

/** Props without one of them, where the grid or the markup owns it
 * instead: the positioner's `style`, a root's `id`, and the content's
 * `hidden`, so a closed state's exit plays before the positioner hides
 * (specs/ui.md). */
export function omit<P extends object>(props: P, key: string): P {
  const rest = { ...(props as Record<string, unknown>) };
  delete rest[key];
  return rest as P;
}

/** The keys of one object set on another: a parent's props handed to a
 * submenu, an explicit `undefined` — which would override a default of
 * Zag's — left out. */
export function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  ) as Pick<T, K>;
}

/** The parts `anchoredApi` wraps — every anchored component's trigger,
 * positioner, and content — and the menu's current trigger value. */
interface AnchoredParts<T extends PropTypes> {
  readonly triggerValue?: string | null;
  getTriggerProps(props?: TriggerValue): T["element"];
  getPositionerProps(): T["element"];
  getContentProps(): T["element"];
}

/** The machine props an anchored component's placement comes from:
 * Zag's, its `gutter` (`offset.mainAxis` over it, as Zag reads them)
 * and `offset.crossAxis` counted in cells. */
interface PlacedProps {
  id: string;
  positioning?:
    | {
        placement?: Placement | undefined;
        gutter?: number | undefined;
        offset?: { mainAxis?: number | undefined; crossAxis?: number | undefined } | undefined;
      }
    | undefined;
}

/** Where a component's floating part goes, read from its props: the
 * placement asked for, else the component's own, with the gutter and
 * the shift in cells. A component whose anchor is not its trigger — a
 * combobox anchors to the control, so its list lines up under the
 * input rather than the button beside it — reads this and names its
 * own parts. */
export function anchoringOf({ positioning }: PlacedProps, placement: Placement): Anchoring {
  return {
    placement: positioning?.placement ?? placement,
    gutter: positioning?.offset?.mainAxis ?? positioning?.gutter ?? 0,
    shift: positioning?.offset?.crossAxis ?? 0,
  };
}

/** Zag's connected API with the grid's props: each trigger named as an
 * anchor, the positioner a manual popover placed against the current
 * one — in the placement asked for, else the component's own — the
 * content shown by the positioner. */
export function anchoredApi<T extends PropTypes, A extends AnchoredParts<T>>(
  zag: A,
  normalize: NormalizeProps<T>,
  machineProps: PlacedProps,
  placement: Placement,
): A {
  const { id } = machineProps;
  const anchoring = anchoringOf(machineProps, placement);
  return {
    ...zag,
    getTriggerProps: (props?: TriggerValue) =>
      withProps(normalize, zag.getTriggerProps(props), triggerProps(id, props?.value)),
    getPositionerProps: () =>
      withProps(
        normalize,
        omit(zag.getPositionerProps(), "style"),
        positionerProps(anchorName(id, zag.triggerValue ?? undefined), anchoring),
      ),
    getContentProps: () => omit(zag.getContentProps(), "hidden"),
  };
}
