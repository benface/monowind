import { propNames } from "@monowind/ui/tooltip";
import type * as tooltip from "@monowind/ui/tooltip";
import type { PropTypes } from "@zag-js/react";
import { useTooltip, type Connected, type Positioned } from "../hooks.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf, triggerPart } from "./part.tsx";

/** Zag's tooltip as a compound component (specs/ui.md "Component
 * layer"): its parts sit in the sentence around the trigger, so they
 * render inline. */

export type Api = Connected<Positioned<tooltip.Api<PropTypes>>, tooltip.Service>;

const context = defineContext<Api>("Tooltip");

/** The tooltip a part is in, as `useTooltip()` returns it. */
export const useTooltipContext = context.use;

/** A tooltip over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<tooltip.Props, Api>("Tooltip.Root", useTooltip, context, propNames);

/** A tooltip over an API the caller holds, for reaching it from outside
 * the tree: run `useTooltip()` yourself and hand over what it returns. */
export const RootProvider = defineRootProvider<Api>("Tooltip.RootProvider", context);

const part = partsOf("Tooltip", context.use);

export const Trigger = triggerPart("Tooltip", context.use);
export const Positioner = part("Positioner", (api) => api.getPositionerProps(), "span");
export const Content = part("Content", (api) => api.getContentProps(), "span");
