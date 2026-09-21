import type { MachineSchema } from "@zag-js/core";
import { normalizeProps, useMachine, type PropTypes } from "@zag-js/svelte";
import * as dialog from "@monowind/ui/dialog";
import * as listbox from "@monowind/ui/listbox";
import * as menu from "@monowind/ui/menu";
import * as popover from "@monowind/ui/popover";
import * as select from "@monowind/ui/select";
import * as tooltip from "@monowind/ui/tooltip";
import { syncTopLayer, type Anchored, type Component } from "@monowind/ui/top-layer";
import type { Action } from "svelte/action";

/** A component in a Svelte component: its API, live. */
export interface InFlow<A> {
  readonly api: A;
}

/** A component with a floating part in a Svelte component: its API and
 * the action for its positioner (`use:positioner`), which keeps the
 * positioner in the top layer with the machine. */
export interface Created<A> extends InFlow<A> {
  positioner: Action<HTMLElement>;
}

/** The positioner's action, its top layer synced by an effect on the
 * machine's open state. */
function topLayer(open: () => boolean): Action<HTMLElement> {
  let node = $state.raw<HTMLElement | undefined>();
  $effect(() => syncTopLayer(node, open()));
  return (element) => {
    node = element;
    return {
      destroy() {
        node = undefined;
      },
    };
  };
}

/** A component as a function for a component's script: Zag's
 * `useMachine` on the grid's props — a getter of them keeps controlled
 * props flowing — the API derived. */
function create<T extends MachineSchema, P, G extends Partial<T["props"]>, A>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: P | (() => P)) => InFlow<A> {
  return (props) => {
    const gridProps = $derived(
      component.props(typeof props === "function" ? (props as () => P)() : props),
    );
    const service = useMachine(component.machine, () => gridProps);
    const api = $derived(component.connect(service, normalizeProps, gridProps));
    return {
      get api() {
        return api;
      },
    };
  };
}

/** A component with a floating part: its API, and the positioner's
 * action beside it. */
function anchoredCreate<
  T extends MachineSchema,
  P,
  G extends Partial<T["props"]>,
  A extends Anchored,
>(component: Component<T, P, G, typeof normalizeProps, A>): (props: P | (() => P)) => Created<A> {
  const createComponent = create(component);
  return (props) => {
    const created = createComponent(props);
    return {
      get api() {
        return created.api;
      },
      positioner: topLayer(() => created.api.open),
    };
  };
}

// Types written out, so the declarations name them through this
// package's own dependencies.
/** Zag's menu on the grid, in a component. */
export const createMenu: (props: menu.Props | (() => menu.Props)) => Created<menu.Api<PropTypes>> =
  anchoredCreate(menu);
/** Zag's listbox on the grid, in a component: its API alone, the parts
 * all in the flow. */
export const createListbox: (
  props: listbox.Props | (() => listbox.Props),
) => InFlow<listbox.Api<PropTypes>> = create(listbox);
/** Zag's select on the grid, in a component. */
export const createSelect: (
  props: select.Props | (() => select.Props),
) => Created<select.Api<PropTypes>> = anchoredCreate(select);
/** Zag's dialog on the grid, in a component. */
export const createDialog: (
  props: dialog.Props | (() => dialog.Props),
) => Created<dialog.Api<PropTypes>> = anchoredCreate(dialog);
/** Zag's popover on the grid, in a component. */
export const createPopover: (
  props: popover.Props | (() => popover.Props),
) => Created<popover.Api<PropTypes>> = anchoredCreate(popover);
/** Zag's tooltip on the grid, in a component. */
export const createTooltip: (
  props: tooltip.Props | (() => tooltip.Props),
) => Created<tooltip.Api<PropTypes>> = anchoredCreate(tooltip);
