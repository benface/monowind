import { propNames } from "@monowind/ui/listbox";
import type * as listbox from "@monowind/ui/listbox";
import type { PropTypes } from "@zag-js/vue";
import { useListbox, type InFlow } from "../composables.ts";
import { defineItemParts, defineListContext } from "./items.ts";
import { defineRoot, defineRootProvider, partsOf } from "./part.ts";

/** Zag's listbox as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its root is an element of its
 * own — Zag gives a listbox a root part — and takes attributes. */

type Api = InFlow<listbox.Api<PropTypes>, listbox.Service>;

const context = defineListContext<Api>("Listbox");

/** The listbox a part is in, as `useListbox()` returns it. */
export const useListboxContext = (): Api => context.use();

/** A listbox over its own machine, an id generated where none is
 * given. */
export const ListboxRoot = defineRoot<listbox.Props, Api>(
  "ListboxRoot",
  propNames,
  context,
  useListbox,
  ({ api }) => api.value.getRootProps(),
);

export const ListboxRootProvider = defineRootProvider<Api>("ListboxRootProvider", context);

const part = partsOf<listbox.Api<PropTypes>, Api>("Listbox", context);

export const ListboxLabel = part("Label", (api) => api.getLabelProps(), "span");
export const ListboxContent = part("Content", (api) => api.getContentProps());

const items = defineItemParts("Listbox");
export const useListboxItemContext = items.useItemContext;
export const ListboxItem = items.Item;
export const ListboxItemText = items.ItemText;
export const ListboxItemIndicator = items.ItemIndicator;
export const ListboxItemGroup = items.ItemGroup;
export const ListboxItemGroupLabel = items.ItemGroupLabel;
