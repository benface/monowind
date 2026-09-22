import { propNames } from "@monowind/ui/tooltip";
import type * as tooltip from "@monowind/ui/tooltip";
import type { PropTypes } from "@zag-js/vue";
import { useTooltip, type Composed } from "../composables.ts";
import { defineContext, definePart, defineRoot, defineRootProvider, partsOf } from "./part.ts";

/** Zag's tooltip as a compound component (specs/ui.md "Component
 * layer"). */

export type Api = Composed<tooltip.Api<PropTypes>, tooltip.Service>;

const context = defineContext<Api>("Tooltip");

/** The tooltip a part is in, as `useTooltip()` returns it. */
export const useTooltipContext = (): Api => context.use();

/** A tooltip over its own machine, an id generated where none is
 * given. */
export const TooltipRoot = defineRoot<tooltip.Props, Api>(
  "TooltipRoot",
  propNames,
  context,
  useTooltip,
);

export const TooltipRootProvider = defineRootProvider<Api>("TooltipRootProvider", context);

const part = partsOf<tooltip.Api<PropTypes>, Api>("Tooltip", context);

/** The floating part, carrying the ref that keeps it in the top layer
 * with the machine. */
export const TooltipPositioner = definePart<Api>(
  "TooltipPositioner",
  context,
  (value) => ({ ...value.api.value.getPositionerProps(), ref: value.positioner }),
  "span",
);

export const TooltipTrigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const TooltipContent = part("Content", (api) => api.getContentProps(), "span");
