import { propNames } from "@monowind/ui/listbox";
import type * as listbox from "@monowind/ui/listbox";
import type { PropTypes } from "@zag-js/react";
import { useListbox, type Connected } from "../hooks.ts";
import { defineItemParts, defineListContext } from "./items.tsx";
import { defineRoot, defineRootProvider, partsOf, type PartProps } from "./part.tsx";

/**
 * Zag's listbox as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its `Root` is an element of its
 * own — Zag gives a listbox a root part — and takes attributes.
 */

export type Api = Connected<listbox.Api<PropTypes>, listbox.Service>;

const context = defineListContext<Api>("Listbox");

/** The listbox a part is in, as `useListbox()` returns it. */
export const useListboxContext = context.use;

/** A listbox over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<listbox.Props, Api, PartProps<"div">>(
  "Listbox.Root",
  useListbox,
  context,
  propNames,
  (api) => api.getRootProps(),
);

/** A listbox over an API the caller holds, for reaching it from
 * outside the tree: run `useListbox()` yourself and hand it over. */
export const RootProvider = defineRootProvider<Api>("Listbox.RootProvider", context);

const part = partsOf("Listbox", context.use);

export const Label = part("Label", (api) => api.getLabelProps(), "span");
export const Content = part("Content", (api) => api.getContentProps());

export const {
  useItemContext: useListboxItemContext,
  Item,
  ItemText,
  ItemIndicator,
  ItemGroup,
  ItemGroupLabel,
} = defineItemParts("Listbox");
