import { propNames } from "@monowind/ui/combobox";
import type * as combobox from "@monowind/ui/combobox";
import type { PropTypes } from "@zag-js/vue";
import { useCombobox, type Composed } from "../composables.ts";
import { defineItemParts, defineListContext } from "./items.ts";
import { defineRoot, defineRootProvider, partsOf, positionerPart } from "./part.ts";

/** Zag's combobox as a compound component (specs/ui.md "Component
 * layer"): a listbox under an input, its root an element of its own
 * and its list anchored to the control. Filtering is the page's: hand
 * the root the collection the input's value narrows. */

type Api = Composed<combobox.Api<PropTypes>, combobox.Service>;

const context = defineListContext<Api>("Combobox");

/** The combobox a part is in, as `useCombobox()` returns it. */
export const useComboboxContext = (): Api => context.use();

/** A combobox over its own machine, an id generated where none is
 * given. */
export const ComboboxRoot = defineRoot<combobox.Props, Api>(
  "ComboboxRoot",
  propNames,
  context,
  useCombobox,
  ({ api }) => api.value.getRootProps(),
);

export const ComboboxRootProvider = defineRootProvider<Api>("ComboboxRootProvider", context);

const part = partsOf<combobox.Api<PropTypes>, Api>("Combobox", context);

export const ComboboxLabel = part("Label", (api) => api.getLabelProps(), "label");
export const ComboboxControl = part("Control", (api) => api.getControlProps());
export const ComboboxInput = part("Input", (api) => api.getInputProps(), "input");
export const ComboboxTrigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const ComboboxClearTrigger = part(
  "ClearTrigger",
  (api) => api.getClearTriggerProps(),
  "button",
);
export const ComboboxContent = part("Content", (api) => api.getContentProps());
export const ComboboxList = part("List", (api) => api.getListProps());

export const ComboboxPositioner = positionerPart("Combobox", context);

const items = defineItemParts("Combobox");
export const useComboboxItemContext = items.useItemContext;
export const ComboboxItem = items.Item;
export const ComboboxItemText = items.ItemText;
export const ComboboxItemIndicator = items.ItemIndicator;
export const ComboboxItemGroup = items.ItemGroup;
export const ComboboxItemGroupLabel = items.ItemGroupLabel;
