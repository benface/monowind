import { propNames } from "@monowind/ui/combobox";
import type * as combobox from "@monowind/ui/combobox";
import type { PropTypes } from "@zag-js/react";
import { useCombobox, type Connected, type Positioned } from "../hooks.ts";
import { defineItemParts, defineListContext } from "./items.tsx";
import { defineRoot, defineRootProvider, partsOf, type PartProps } from "./part.tsx";

/**
 * Zag's combobox as a compound component (specs/ui.md "Component
 * layer"): a listbox under an input, its `Root` an element of its own
 * — Zag gives a combobox a root part — and its list anchored to the
 * `Control`, so it lines up under what the reader types into.
 * Filtering is the page's: hand `Root` the collection the input's
 * value narrows.
 */

export type Api = Connected<Positioned<combobox.Api<PropTypes>>, combobox.Service>;

const context = defineListContext<Api>("Combobox");

/** The combobox a part is in, as `useCombobox()` returns it. */
export const useComboboxContext = context.use;

/** A combobox over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<combobox.Props, Api, PartProps<"div">>(
  "Combobox.Root",
  useCombobox,
  context,
  propNames,
  (api) => api.getRootProps(),
);

/** A combobox over an API the caller holds, for reaching it from
 * outside the tree: run `useCombobox()` yourself and hand it over. */
export const RootProvider = defineRootProvider<Api>("Combobox.RootProvider", context);

const part = partsOf("Combobox", context.use);

export const Label = part("Label", (api) => api.getLabelProps(), "label");
export const Control = part("Control", (api) => api.getControlProps());
export const Input = part("Input", (api) => api.getInputProps(), "input");
export const Trigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const ClearTrigger = part("ClearTrigger", (api) => api.getClearTriggerProps(), "button");
export const Positioner = part("Positioner", (api) => api.getPositionerProps());
export const Content = part("Content", (api) => api.getContentProps());
export const List = part("List", (api) => api.getListProps());

export const {
  useItemContext: useComboboxItemContext,
  Item,
  ItemText,
  ItemIndicator,
  ItemGroup,
  ItemGroupLabel,
} = defineItemParts("Combobox");
