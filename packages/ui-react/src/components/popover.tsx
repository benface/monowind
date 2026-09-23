import { propNames } from "@monowind/ui/popover";
import type * as popover from "@monowind/ui/popover";
import type { PropTypes } from "@zag-js/react";
import { usePopover, type Connected, type Positioned } from "../hooks.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf, triggerPart } from "./part.tsx";

/** Zag's popover as a compound component (specs/ui.md "Component
 * layer"). */

export type Api = Connected<Positioned<popover.Api<PropTypes>>, popover.Service>;

const context = defineContext<Api>("Popover");

/** The popover a part is in, as `usePopover()` returns it. */
export const usePopoverContext = context.use;

/** A popover over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<popover.Props, Api>("Popover.Root", usePopover, context, propNames);

/** A popover over an API the caller holds, for reaching it from outside
 * the tree: run `usePopover()` yourself and hand over what it returns. */
export const RootProvider = defineRootProvider<Api>("Popover.RootProvider", context);

const part = partsOf("Popover", context.use);

export const Trigger = triggerPart("Popover", context.use);
export const Indicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
export const Positioner = part("Positioner", (api) => api.getPositionerProps());
export const Content = part("Content", (api) => api.getContentProps());
export const Title = part("Title", (api) => api.getTitleProps(), "h2");
export const Description = part("Description", (api) => api.getDescriptionProps(), "p");
export const CloseTrigger = part("CloseTrigger", (api) => api.getCloseTriggerProps(), "button");
