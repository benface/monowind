import type { MachineSchema, Service } from "@zag-js/core";
import { normalizeProps, useMachine, type PropTypes } from "@zag-js/react";
import * as dialog from "@monowind/ui/dialog";
import * as listbox from "@monowind/ui/listbox";
import * as menu from "@monowind/ui/menu";
import * as popover from "@monowind/ui/popover";
import * as select from "@monowind/ui/select";
import * as tooltip from "@monowind/ui/tooltip";
import { syncTopLayer, type Anchored, type Component } from "@monowind/ui/top-layer";
import { useEffect, useRef, type RefObject } from "react";

/** A hook's return: Zag's API, with the machine's service beside it
 * for a caller that must link two — a submenu to the menu above it,
 * which Zag links by service — and for `RootProvider`. */
export type Connected<A, S> = A & { service: S };

/** A component's API with the positioner's ref in its props, keeping
 * the positioner in the top layer with the machine; a `<div>`'s ref,
 * which a `<div ref>` accepts where an `HTMLElement` ref would not. */
export type Positioned<A> = Omit<A, "getPositionerProps"> & {
  getPositionerProps(): PropTypes["element"] & { ref: RefObject<HTMLDivElement | null> };
};

/** The positioner's ref, its top layer synced after each commit. */
function useTopLayer(open: boolean): RefObject<HTMLDivElement | null> {
  const positioner = useRef<HTMLDivElement>(null);
  useEffect(() => syncTopLayer(positioner.current, open), [open]);
  return positioner;
}

/** A component as a hook: Zag's `useMachine` on the grid's props, the
 * API connected on each render. */
function hook<T extends MachineSchema, P, G extends Partial<T["props"]>, A>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: P) => Connected<A, Service<T>> {
  return function useComponent(props) {
    const gridProps = component.props(props);
    const service = useMachine(component.machine, gridProps);
    return { ...component.connect(service, normalizeProps, gridProps), service };
  };
}

/** A component with a floating part as a hook: the API with the
 * positioner's ref in its props. */
function anchoredHook<
  T extends MachineSchema,
  P,
  G extends Partial<T["props"]>,
  A extends Anchored,
>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: P) => Connected<Positioned<A>, Service<T>> {
  const useComponent = hook(component);
  return function useAnchoredComponent(props) {
    const api = useComponent(props);
    const positioner = useTopLayer(api.open);
    return {
      ...api,
      getPositionerProps: () => ({ ...api.getPositionerProps(), ref: positioner }),
    } as Connected<Positioned<A>, Service<T>>;
  };
}

// Types written out, so the declarations name them through this
// package's own dependencies.
/** Zag's menu on the grid, as a hook. */
export const useMenu: (
  props: menu.Props,
) => Connected<Positioned<menu.Api<PropTypes>>, menu.Service> = anchoredHook(menu);
/** Zag's listbox on the grid, as a hook. */
export const useListbox: (
  props: listbox.Props,
) => Connected<listbox.Api<PropTypes>, listbox.Service> = hook(listbox);
/** Zag's select on the grid, as a hook. */
export const useSelect: (
  props: select.Props,
) => Connected<Positioned<select.Api<PropTypes>>, select.Service> = anchoredHook(select);
/** Zag's dialog on the grid, as a hook. */
export const useDialog: (
  props: dialog.Props,
) => Connected<Positioned<dialog.Api<PropTypes>>, dialog.Service> = anchoredHook(dialog);
/** Zag's popover on the grid, as a hook. */
export const usePopover: (
  props: popover.Props,
) => Connected<Positioned<popover.Api<PropTypes>>, popover.Service> = anchoredHook(popover);
/** Zag's tooltip on the grid, as a hook. */
export const useTooltip: (
  props: tooltip.Props,
) => Connected<Positioned<tooltip.Api<PropTypes>>, tooltip.Service> = anchoredHook(tooltip);
