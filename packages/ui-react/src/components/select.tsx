import type { ReactNode } from "react";
import { propNames } from "@monowind/ui/select";
import type * as select from "@monowind/ui/select";
import type { PropTypes } from "@zag-js/react";
import { useSelect, type Connected, type Positioned } from "../hooks.ts";
import { defineItemParts } from "./items.tsx";
import {
  defineContext,
  defineRoot,
  defineRootProvider,
  partsOf,
  renderPart,
  type PartProps,
} from "./part.tsx";

/**
 * Zag's select as a compound component (specs/ui.md "Component
 * layer"): a listbox on a trigger, its `Root` an element of its own —
 * Zag gives a select a root part — and its content in the top layer.
 */

export type Api = Connected<Positioned<select.Api<PropTypes>>, select.Service>;

const context = defineContext<Api>("Select");

/** The select a part is in, as `useSelect()` returns it. */
export const useSelectContext = context.use;

/** A select over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<select.Props, Api, PartProps<"div">>(
  "Select.Root",
  useSelect,
  context,
  propNames,
  { propsOf: (api) => api.getRootProps() },
);

/** A select over an API the caller holds, for reaching it from
 * outside the tree: run `useSelect()` yourself and hand it over. */
export const RootProvider = defineRootProvider<Api>("Select.RootProvider", context);

const part = partsOf("Select", context.use);

/** Zag normalizes a select's label as a `<label>` carrying `htmlFor`
 * for the hidden control, where a listbox's is a plain element: a
 * span here would drop the association a click needs. */
export const Label = part("Label", (api) => api.getLabelProps(), "label");
export const Control = part("Control", (api) => api.getControlProps());
export const Trigger = part("Trigger", (api) => api.getTriggerProps(), "button");
/** The trigger's text: what is selected, or the children as the
 * placeholder while nothing is — as the mount writes it. */
export function ValueText({ children, ...props }: PartProps): ReactNode {
  const api = context.use();
  return renderPart("Select.ValueText", "span", api.getValueTextProps(), {
    ...props,
    children: api.valueAsString || children,
  });
}
ValueText.displayName = "Select.ValueText";
export const Indicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
export const ClearTrigger = part("ClearTrigger", (api) => api.getClearTriggerProps(), "button");
export const Positioner = part("Positioner", (api) => api.getPositionerProps());
export const Content = part("Content", (api) => api.getContentProps());
export const List = part("List", (api) => api.getListProps());

export const {
  useItemContext: useSelectItemContext,
  Item,
  ItemText,
  ItemIndicator,
  ItemGroup,
  ItemGroupLabel,
} = defineItemParts("Select", context);

/** The native select a form submits, an option per item: out of the
 * grid, a `display: none` control being one the layout skips and a
 * form still posts (Zag hides it visually, which would take cells). */
export function HiddenSelect(props: PartProps): ReactNode {
  const api = context.use();
  const values = api.collection.getValues();
  return renderPart(
    "Select.HiddenSelect",
    "select",
    { ...api.getHiddenSelectProps(), style: { display: "none" } },
    {
      ...props,
      children: values.map((value: string) => <option key={value} value={value} />),
    },
  );
}
HiddenSelect.displayName = "Select.HiddenSelect";
