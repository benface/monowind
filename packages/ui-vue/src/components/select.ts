import { createTextVNode, defineComponent, ref, watchPostEffect } from "vue";
import type { DefineSetupFnComponent } from "vue";
import { hiddenSelectOptions, propNames, syncHiddenSelect } from "@monowind/ui/select";
import type * as select from "@monowind/ui/select";
import type { PropTypes } from "@zag-js/vue";
import { useSelect, type Composed } from "../composables.ts";
import { defineItemParts, defineListContext } from "./items.ts";
import {
  BOOLEAN,
  defineRoot,
  defineRootProvider,
  partsOf,
  positionerPart,
  renderPart,
  type Part,
  type PartProps,
} from "./part.ts";

/** Zag's select as a compound component (specs/ui.md "Component
 * layer"): a listbox on a trigger, its root an element of its own —
 * Zag gives a select a root part — and its content in the top
 * layer. */

type Api = Composed<select.Api<PropTypes>, select.Service>;

const context = defineListContext<Api>("Select");

/** The select a part is in, as `useSelect()` returns it. */
export const useSelectContext = (): Api => context.use();

/** A select over its own machine, an id generated where none is
 * given. */
export const SelectRoot = defineRoot<select.Props, Api>(
  "SelectRoot",
  propNames,
  context,
  useSelect,
  ({ api }) => api.value.getRootProps(),
);

export const SelectRootProvider = defineRootProvider<Api>("SelectRootProvider", context);

const part = partsOf<select.Api<PropTypes>, Api>("Select", context);

export const SelectLabel = part("Label", (api) => api.getLabelProps(), "label");
export const SelectControl = part("Control", (api) => api.getControlProps());
export const SelectTrigger = part("Trigger", (api) => api.getTriggerProps(), "button");
/** The trigger's text: what is selected, or the slot as the
 * placeholder while nothing is — as the mount writes it. */
export const SelectValueText = defineComponent(
  (props: { asChild?: boolean }, { slots, attrs }) => {
    const { api } = context.use();
    return () =>
      renderPart(
        "span",
        api.value.getValueTextProps(),
        attrs as Record<string, unknown>,
        Boolean(props.asChild),
        api.value.valueAsString ? [createTextVNode(api.value.valueAsString)] : slots["default"]?.(),
        "SelectValueText",
      );
  },
  { name: "SelectValueText", inheritAttrs: false, props: { asChild: BOOLEAN } },
) as unknown as Part<"span">;
export const SelectIndicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
export const SelectClearTrigger = part(
  "ClearTrigger",
  (api) => api.getClearTriggerProps(),
  "button",
);
export const SelectContent = part("Content", (api) => api.getContentProps());
export const SelectList = part("List", (api) => api.getListProps());

export const SelectPositioner = positionerPart("Select", context);

/** The native select a form submits (specs/ui.md "A select is a
 * listbox on a trigger"), its selection `syncHiddenSelect`'s after
 * each render. */
export const SelectHiddenSelect = defineComponent(
  (_props, { attrs }) => {
    const { api, service } = context.use();
    const element = ref<HTMLSelectElement>();
    const options = hiddenSelectOptions(api.value, service);
    watchPostEffect(() => {
      if (element.value) syncHiddenSelect(element.value, api.value, service);
    });
    return () => {
      const { value: _value, ...props } = api.value.getHiddenSelectProps();
      return renderPart(
        "select",
        { ...props, ref: element, size: 2, style: { display: "none" }, innerHTML: options },
        attrs as Record<string, unknown>,
        false,
        undefined,
        "SelectHiddenSelect",
      );
    };
  },
  { name: "SelectHiddenSelect", inheritAttrs: false },
) as unknown as DefineSetupFnComponent<PartProps<"select">, {}, {}>;

const items = defineItemParts("Select");
export const useSelectItemContext = items.useItemContext;
export const SelectItem = items.Item;
export const SelectItemText = items.ItemText;
export const SelectItemIndicator = items.ItemIndicator;
export const SelectItemGroup = items.ItemGroup;
export const SelectItemGroupLabel = items.ItemGroupLabel;
