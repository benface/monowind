import { propNames } from "@monowind/ui/dialog";
import type * as dialog from "@monowind/ui/dialog";
import type { PropTypes } from "@zag-js/react";
import { useDialog, type Connected, type Positioned } from "../hooks.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf } from "./part.tsx";

/** Zag's dialog as a compound component (specs/ui.md "Component
 * layer"): the positioner is the platform's centered top-layer box and
 * carries the backdrop. */

export type Api = Connected<Positioned<dialog.Api<PropTypes>>, dialog.Service>;

const context = defineContext<Api>("Dialog");

/** The dialog a part is in, as `useDialog()` returns it. */
export const useDialogContext = context.use;

/** A dialog over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<dialog.Props, Api>("Dialog.Root", useDialog, context, propNames);

/** A dialog over an API the caller holds, for reaching it from outside
 * the tree: run `useDialog()` yourself and hand over what it returns. */
export const RootProvider = defineRootProvider<Api>("Dialog.RootProvider", context);

const part = partsOf("Dialog", context.use);

export const Trigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const Positioner = part("Positioner", (api) => api.getPositionerProps());
export const Content = part("Content", (api) => api.getContentProps());
export const Title = part("Title", (api) => api.getTitleProps(), "h2");
export const Description = part("Description", (api) => api.getDescriptionProps(), "p");
export const CloseTrigger = part("CloseTrigger", (api) => api.getCloseTriggerProps(), "button");
