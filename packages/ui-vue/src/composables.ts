import type { MachineSchema, Service } from "@zag-js/core";
import { normalizeProps, useMachine, type PropTypes } from "@zag-js/vue";
import * as dialog from "@monowind/ui/dialog";
import * as listbox from "@monowind/ui/listbox";
import * as menu from "@monowind/ui/menu";
import * as popover from "@monowind/ui/popover";
import * as select from "@monowind/ui/select";
import * as tooltip from "@monowind/ui/tooltip";
import { syncTopLayer, type Anchored, type Component } from "@monowind/ui/top-layer";
import {
  computed,
  ref,
  toValue,
  watchEffect,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";

/** A component in a component: its API, computed, and the machine's
 * service beside it for a caller that must link two — a submenu to
 * the menu above it, which Zag links by service. */
export interface InFlow<A, S = unknown> {
  api: ComputedRef<A>;
  service: S;
}

/** A component with a floating part in a component: its API and the
 * ref for its positioner (`ref="positioner"`), which keeps the
 * positioner in the top layer with the machine. */
export interface Composed<A, S = unknown> extends InFlow<A, S> {
  positioner: Ref<HTMLElement | null>;
}

/** The positioner's ref, its top layer synced after each DOM update. */
function topLayer(open: () => boolean): Ref<HTMLElement | null> {
  const positioner = ref<HTMLElement | null>(null);
  watchEffect(() => syncTopLayer(positioner.value, open()), { flush: "post" });
  return positioner;
}

/** A component as a composable: Zag's `useMachine` on the grid's props
 * — a ref or getter of them keeps controlled props flowing — the API a
 * computed. */
function composable<T extends MachineSchema, P, G extends Partial<T["props"]>, A>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: MaybeRefOrGetter<P>) => InFlow<A, Service<T>> {
  return (props) => {
    const gridProps = computed(() => component.props(toValue(props)));
    const service = useMachine(component.machine, gridProps);
    return {
      api: computed(() => component.connect(service, normalizeProps, gridProps.value)),
      service,
    };
  };
}

/** A component with a floating part as a composable: the API computed,
 * the positioner's ref beside it. */
function anchoredComposable<
  T extends MachineSchema,
  P,
  G extends Partial<T["props"]>,
  A extends Anchored,
>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: MaybeRefOrGetter<P>) => Composed<A, Service<T>> {
  const use = composable(component);
  return (props) => {
    const { api, service } = use(props);
    return { api, service, positioner: topLayer(() => api.value.open) };
  };
}

// Types written out, so the declarations name them through this
// package's own dependencies.
/** Zag's menu on the grid, in a component. */
export const useMenu: (
  props: MaybeRefOrGetter<menu.Props>,
) => Composed<menu.Api<PropTypes>, menu.Service> = anchoredComposable(menu);
/** Zag's listbox on the grid, in a component: its API alone, the parts
 * all in the flow. */
export const useListbox: (
  props: MaybeRefOrGetter<listbox.Props>,
) => InFlow<listbox.Api<PropTypes>, listbox.Service> = composable(listbox);
/** Zag's select on the grid, in a component. */
export const useSelect: (
  props: MaybeRefOrGetter<select.Props>,
) => Composed<select.Api<PropTypes>, select.Service> = anchoredComposable(select);
/** Zag's dialog on the grid, in a component. */
export const useDialog: (
  props: MaybeRefOrGetter<dialog.Props>,
) => Composed<dialog.Api<PropTypes>, dialog.Service> = anchoredComposable(dialog);
/** Zag's popover on the grid, in a component. */
export const usePopover: (
  props: MaybeRefOrGetter<popover.Props>,
) => Composed<popover.Api<PropTypes>, popover.Service> = anchoredComposable(popover);
/** Zag's tooltip on the grid, in a component. */
export const useTooltip: (
  props: MaybeRefOrGetter<tooltip.Props>,
) => Composed<tooltip.Api<PropTypes>, tooltip.Service> = anchoredComposable(tooltip);
