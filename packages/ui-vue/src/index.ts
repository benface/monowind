import type { MachineSchema } from "@zag-js/core";
import { normalizeProps, useMachine, type PropTypes } from "@zag-js/vue";
import * as dialog from "@monowind/ui/dialog";
import * as menu from "@monowind/ui/menu";
import * as popover from "@monowind/ui/popover";
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

/** A component in a component: its API, computed, and the ref for its
 * positioner (`ref="positioner"`), which keeps the positioner in the
 * top layer with the machine. */
export interface Composed<A> {
  api: ComputedRef<A>;
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
 * computed, the positioner's ref beside it. */
function composable<T extends MachineSchema, P, G extends Partial<T["props"]>, A extends Anchored>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: MaybeRefOrGetter<P>) => Composed<A> {
  return (props) => {
    const gridProps = computed(() => component.props(toValue(props)));
    const service = useMachine(component.machine, gridProps);
    const api = computed(() => component.connect(service, normalizeProps, gridProps.value));
    return { api, positioner: topLayer(() => api.value.open) };
  };
}

// Types written out, so the declarations name them through this
// package's own dependencies.
/** Zag's menu on the grid, in a component. */
export const useMenu: (props: MaybeRefOrGetter<menu.Props>) => Composed<menu.Api<PropTypes>> =
  composable(menu);
/** Zag's dialog on the grid, in a component. */
export const useDialog: (props: MaybeRefOrGetter<dialog.Props>) => Composed<dialog.Api<PropTypes>> =
  composable(dialog);
/** Zag's popover on the grid, in a component. */
export const usePopover: (
  props: MaybeRefOrGetter<popover.Props>,
) => Composed<popover.Api<PropTypes>> = composable(popover);
/** Zag's tooltip on the grid, in a component. */
export const useTooltip: (
  props: MaybeRefOrGetter<tooltip.Props>,
) => Composed<tooltip.Api<PropTypes>> = composable(tooltip);
