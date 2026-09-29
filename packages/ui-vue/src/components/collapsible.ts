import { propNames } from "@monowind/ui/collapsible";
import type * as collapsible from "@monowind/ui/collapsible";
import type { PropTypes } from "@zag-js/vue";
import { useCollapsible, type InFlow } from "../composables.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf } from "./part.ts";

/** Zag's collapsible as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its root is an element of its
 * own — Zag gives a collapsible a root part — and takes attributes. */

type Api = InFlow<collapsible.Api<PropTypes>, collapsible.Service>;

const context = defineContext<Api>("Collapsible");

/** The collapsible a part is in, as `useCollapsible()` returns it. */
export const useCollapsibleContext = (): Api => context.use();

/** A collapsible over its own machine, an id generated where none is
 * given. */
export const CollapsibleRoot = defineRoot<collapsible.Props, Api>(
  "CollapsibleRoot",
  propNames,
  context,
  useCollapsible,
  ({ api }) => api.value.getRootProps(),
);

export const CollapsibleRootProvider = defineRootProvider<Api>("CollapsibleRootProvider", context);

const part = partsOf<collapsible.Api<PropTypes>, Api>("Collapsible", context);

export const CollapsibleTrigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const CollapsibleContent = part("Content", (api) => api.getContentProps());
export const CollapsibleIndicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
