import type { MachineSchema, Service } from "@zag-js/core";
import { normalizeProps, useMachine, type PropTypes } from "@zag-js/svelte";
import * as combobox from "@monowind/ui/combobox";
import * as dialog from "@monowind/ui/dialog";
import * as listbox from "@monowind/ui/listbox";
import * as menu from "@monowind/ui/menu";
import * as popover from "@monowind/ui/popover";
import * as select from "@monowind/ui/select";
import * as tooltip from "@monowind/ui/tooltip";
import { syncTopLayer, type Anchored, type Component } from "@monowind/ui/top-layer";
import type { Action } from "svelte/action";

/**
 * `@monowind/ui` for Svelte: a `create…` per component for a
 * component's script, and a compound component over each
 * (specs/ui.md "Component layer"). Both read from the same machines,
 * so a page may mix them.
 */
/** The three lists' collections, `@monowind/ui/listbox`'s. */
export { collection, gridCollection } from "@monowind/ui/listbox";
export {
  useComboboxContext,
  useDialogContext,
  useItemContext,
  useListboxContext,
  useMenuContext,
  usePopoverContext,
  useSelectContext,
  useTooltipContext,
} from "./components/context.ts";
export { default as ComboboxClearTrigger } from "./components/ComboboxClearTrigger.svelte";
export { default as ComboboxContent } from "./components/ComboboxContent.svelte";
export { default as ComboboxControl } from "./components/ComboboxControl.svelte";
export { default as ComboboxInput } from "./components/ComboboxInput.svelte";
export { default as ComboboxItem } from "./components/ListItem.svelte";
export { default as ComboboxItemGroup } from "./components/ListItemGroup.svelte";
export { default as ComboboxItemGroupLabel } from "./components/ListItemGroupLabel.svelte";
export { default as ComboboxItemIndicator } from "./components/ListItemIndicator.svelte";
export { default as ComboboxItemText } from "./components/ListItemText.svelte";
export { default as ComboboxLabel } from "./components/ComboboxLabel.svelte";
export { default as ComboboxList } from "./components/ComboboxList.svelte";
export { default as ComboboxPositioner } from "./components/ComboboxPositioner.svelte";
export { default as ComboboxRoot } from "./components/ComboboxRoot.svelte";
export { default as ComboboxRootProvider } from "./components/ComboboxRootProvider.svelte";
export { default as ComboboxTrigger } from "./components/ComboboxTrigger.svelte";
export { default as DialogCloseTrigger } from "./components/DialogCloseTrigger.svelte";
export { default as DialogContent } from "./components/DialogContent.svelte";
export { default as DialogDescription } from "./components/DialogDescription.svelte";
export { default as DialogPositioner } from "./components/DialogPositioner.svelte";
export { default as DialogRoot } from "./components/DialogRoot.svelte";
export { default as DialogRootProvider } from "./components/DialogRootProvider.svelte";
export { default as DialogTitle } from "./components/DialogTitle.svelte";
export { default as DialogTrigger } from "./components/DialogTrigger.svelte";
export { default as ListboxContent } from "./components/ListboxContent.svelte";
export { default as ListboxItem } from "./components/ListItem.svelte";
export { default as ListboxItemGroup } from "./components/ListItemGroup.svelte";
export { default as ListboxItemGroupLabel } from "./components/ListItemGroupLabel.svelte";
export { default as ListboxItemIndicator } from "./components/ListItemIndicator.svelte";
export { default as ListboxItemText } from "./components/ListItemText.svelte";
export { default as ListboxLabel } from "./components/ListboxLabel.svelte";
export { default as ListboxRoot } from "./components/ListboxRoot.svelte";
export { default as ListboxRootProvider } from "./components/ListboxRootProvider.svelte";
export { default as MenuContent } from "./components/MenuContent.svelte";
export { default as MenuItem } from "./components/MenuItem.svelte";
export { default as MenuItemGroup } from "./components/MenuItemGroup.svelte";
export { default as MenuItemGroupLabel } from "./components/MenuItemGroupLabel.svelte";
export { default as MenuPositioner } from "./components/MenuPositioner.svelte";
export { default as MenuRoot } from "./components/MenuRoot.svelte";
export { default as MenuRootProvider } from "./components/MenuRootProvider.svelte";
export { default as MenuSeparator } from "./components/MenuSeparator.svelte";
export { default as MenuTrigger } from "./components/MenuTrigger.svelte";
export { default as MenuTriggerItem } from "./components/MenuTriggerItem.svelte";
export { default as PopoverCloseTrigger } from "./components/PopoverCloseTrigger.svelte";
export { default as PopoverContent } from "./components/PopoverContent.svelte";
export { default as PopoverDescription } from "./components/PopoverDescription.svelte";
export { default as PopoverIndicator } from "./components/PopoverIndicator.svelte";
export { default as PopoverPositioner } from "./components/PopoverPositioner.svelte";
export { default as PopoverRoot } from "./components/PopoverRoot.svelte";
export { default as PopoverRootProvider } from "./components/PopoverRootProvider.svelte";
export { default as PopoverTitle } from "./components/PopoverTitle.svelte";
export { default as PopoverTrigger } from "./components/PopoverTrigger.svelte";
export { default as SelectClearTrigger } from "./components/SelectClearTrigger.svelte";
export { default as SelectContent } from "./components/SelectContent.svelte";
export { default as SelectControl } from "./components/SelectControl.svelte";
export { default as SelectHiddenSelect } from "./components/SelectHiddenSelect.svelte";
export { default as SelectIndicator } from "./components/SelectIndicator.svelte";
export { default as SelectItem } from "./components/ListItem.svelte";
export { default as SelectItemGroup } from "./components/ListItemGroup.svelte";
export { default as SelectItemGroupLabel } from "./components/ListItemGroupLabel.svelte";
export { default as SelectItemIndicator } from "./components/ListItemIndicator.svelte";
export { default as SelectItemText } from "./components/ListItemText.svelte";
export { default as SelectLabel } from "./components/SelectLabel.svelte";
export { default as SelectList } from "./components/SelectList.svelte";
export { default as SelectPositioner } from "./components/SelectPositioner.svelte";
export { default as SelectRoot } from "./components/SelectRoot.svelte";
export { default as SelectRootProvider } from "./components/SelectRootProvider.svelte";
export { default as SelectTrigger } from "./components/SelectTrigger.svelte";
export { default as SelectValueText } from "./components/SelectValueText.svelte";
export { default as TooltipContent } from "./components/TooltipContent.svelte";
export { default as TooltipPositioner } from "./components/TooltipPositioner.svelte";
export { default as TooltipRoot } from "./components/TooltipRoot.svelte";
export { default as TooltipRootProvider } from "./components/TooltipRootProvider.svelte";
export { default as TooltipTrigger } from "./components/TooltipTrigger.svelte";

/** A component in a Svelte component: its API, live, and the
 * machine's service beside it for a caller that must link two — a
 * submenu to the menu above it, which Zag links by service. */
export interface InFlow<A, S = unknown> {
  readonly api: A;
  readonly service: S;
}

/** A component with a floating part in a Svelte component: its API and
 * the action for its positioner (`use:positioner`), which keeps the
 * positioner in the top layer with the machine. */
export interface Created<A, S = unknown> extends InFlow<A, S> {
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
): (props: P | (() => P)) => InFlow<A, Service<T>> {
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
      get service() {
        return service;
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
>(
  component: Component<T, P, G, typeof normalizeProps, A>,
): (props: P | (() => P)) => Created<A, Service<T>> {
  const createComponent = create(component);
  return (props) => {
    const created = createComponent(props);
    return {
      get api() {
        return created.api;
      },
      get service() {
        return created.service;
      },
      positioner: topLayer(() => created.api.open),
    };
  };
}

// Types written out, so the declarations name them through this
// package's own dependencies.
/** Zag's menu on the grid, in a component. */
export const createMenu: (
  props: menu.Props | (() => menu.Props),
) => Created<menu.Api<PropTypes>, menu.Service> = anchoredCreate(menu);
/** Zag's listbox on the grid, in a component: its API alone, the parts
 * all in the flow. */
export const createListbox: (
  props: listbox.Props | (() => listbox.Props),
) => InFlow<listbox.Api<PropTypes>, listbox.Service> = create(listbox);
/** Zag's select on the grid, in a component. */
export const createSelect: (
  props: select.Props | (() => select.Props),
) => Created<select.Api<PropTypes>, select.Service> = anchoredCreate(select);
/** Zag's combobox on the grid, in a component. */
export const createCombobox: (
  props: combobox.MountProps | (() => combobox.MountProps),
) => Created<combobox.Api<PropTypes>, combobox.Service> = anchoredCreate(combobox);
/** Zag's dialog on the grid, in a component. */
export const createDialog: (
  props: dialog.Props | (() => dialog.Props),
) => Created<dialog.Api<PropTypes>, dialog.Service> = anchoredCreate(dialog);
/** Zag's popover on the grid, in a component. */
export const createPopover: (
  props: popover.Props | (() => popover.Props),
) => Created<popover.Api<PropTypes>, popover.Service> = anchoredCreate(popover);
/** Zag's tooltip on the grid, in a component. */
export const createTooltip: (
  props: tooltip.Props | (() => tooltip.Props),
) => Created<tooltip.Api<PropTypes>, tooltip.Service> = anchoredCreate(tooltip);
