import { createTextVNode, defineComponent, h } from "vue";
import { propNames } from "@monowind/ui/select";
import type * as select from "@monowind/ui/select";
import type { PropTypes } from "@zag-js/vue";
import { useSelect, type Composed } from "../composables.ts";
import { defineItemParts } from "./items.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf, renderPart } from "./part.ts";

/** Zag's select as a compound component (specs/ui.md "Component
 * layer"): a listbox on a trigger, its root an element of its own —
 * Zag gives a select a root part — and its content in the top
 * layer. */

export type Api = Composed<select.Api<PropTypes>, select.Service>;

const context = defineContext<Api>("Select");

/** The select a part is in, as `useSelect()` returns it. */
export const useSelectContext = (): Api => context.use();

/** A select over its own machine, an id generated where none is
 * given. */
export const SelectRoot = defineRoot<select.Props, Api>(
  "SelectRoot",
  propNames,
  context,
  useSelect,
  { propsOf: ({ api }) => api.value.getRootProps() },
);

export const SelectRootProvider = defineRootProvider<Api>("SelectRootProvider", context);

const part = partsOf<select.Api<PropTypes>, Api>("Select", context);

/** Zag normalizes a select's label as a `<label>` carrying `htmlFor`
 * for the hidden control, where a listbox's is a plain element: a
 * span here would drop the association a click needs. */
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
  { name: "SelectValueText", inheritAttrs: false, props: ["asChild"] },
);
export const SelectIndicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
export const SelectClearTrigger = part(
  "ClearTrigger",
  (api) => api.getClearTriggerProps(),
  "button",
);
export const SelectContent = part("Content", (api) => api.getContentProps());
export const SelectList = part("List", (api) => api.getListProps());

/** The floating part, carrying the ref that keeps it in the top layer
 * with the machine. */
export const SelectPositioner = defineComponent(
  (props: { asChild?: boolean }, { slots, attrs }) => {
    const value = context.use();
    return () =>
      renderPart(
        "div",
        { ...value.api.value.getPositionerProps(), ref: value.positioner },
        attrs as Record<string, unknown>,
        Boolean(props.asChild),
        slots["default"]?.(),
        "SelectPositioner",
      );
  },
  { name: "SelectPositioner", inheritAttrs: false, props: ["asChild"] },
);

/** The native select a form submits, an option per item: out of the
 * grid, a `display: none` control being one the layout skips and a
 * form still posts (Zag hides it visually, which would take cells). */
export const SelectHiddenSelect = defineComponent(
  (_props, { attrs }) => {
    const { api } = context.use();
    return () =>
      renderPart(
        "select",
        { ...api.value.getHiddenSelectProps(), style: { display: "none" } },
        attrs as Record<string, unknown>,
        false,
        api.value.collection.getValues().map((value: string) => h("option", { key: value, value })),
        "SelectHiddenSelect",
      );
  },
  { name: "SelectHiddenSelect", inheritAttrs: false },
);

const items = defineItemParts<select.Api<PropTypes>, Api>("Select", context);
export const useSelectItemContext = items.useItemContext;
export const SelectItem = items.Item;
export const SelectItemText = items.ItemText;
export const SelectItemIndicator = items.ItemIndicator;
export const SelectItemGroup = items.ItemGroup;
export const SelectItemGroupLabel = items.ItemGroupLabel;
