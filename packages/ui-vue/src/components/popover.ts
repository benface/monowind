import { propNames } from "@monowind/ui/popover";
import type * as popover from "@monowind/ui/popover";
import type { PropTypes } from "@zag-js/vue";
import { usePopover, type Composed } from "../composables.ts";
import {
  defineContext,
  defineRoot,
  defineRootProvider,
  partsOf,
  positionerPart,
  triggerPart,
} from "./part.ts";

/** Zag's popover as a compound component (specs/ui.md "Component
 * layer"). */

type Api = Composed<popover.Api<PropTypes>, popover.Service>;

const context = defineContext<Api>("Popover");

/** The popover a part is in, as `usePopover()` returns it. */
export const usePopoverContext = (): Api => context.use();

/** A popover over its own machine, an id generated where none is
 * given. */
export const PopoverRoot = defineRoot<popover.Props, Api>(
  "PopoverRoot",
  propNames,
  context,
  usePopover,
);

export const PopoverRootProvider = defineRootProvider<Api>("PopoverRootProvider", context);

const part = partsOf<popover.Api<PropTypes>, Api>("Popover", context);

export const PopoverPositioner = positionerPart("Popover", context);

export const PopoverTrigger = triggerPart<popover.Api<PropTypes>, Api>("Popover", context);
export const PopoverIndicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
export const PopoverContent = part("Content", (api) => api.getContentProps());
export const PopoverTitle = part("Title", (api) => api.getTitleProps(), "h2");
export const PopoverDescription = part("Description", (api) => api.getDescriptionProps(), "p");
export const PopoverCloseTrigger = part(
  "CloseTrigger",
  (api) => api.getCloseTriggerProps(),
  "button",
);
