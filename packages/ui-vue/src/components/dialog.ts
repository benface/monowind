import { propNames } from "@monowind/ui/dialog";
import type * as dialog from "@monowind/ui/dialog";
import type { PropTypes } from "@zag-js/vue";
import { useDialog, type Composed } from "../composables.ts";
import { defineContext, definePart, defineRoot, defineRootProvider, partsOf } from "./part.ts";

/** Zag's dialog as a compound component (specs/ui.md "Component
 * layer"). */

export type Api = Composed<dialog.Api<PropTypes>, dialog.Service>;

const context = defineContext<Api>("Dialog");

/** The dialog a part is in, as `useDialog()` returns it. */
export const useDialogContext = (): Api => context.use();

/** A dialog over its own machine, an id generated where none is
 * given. */
export const DialogRoot = defineRoot<dialog.Props, Api>(
  "DialogRoot",
  propNames,
  context,
  useDialog,
);

export const DialogRootProvider = defineRootProvider<Api>("DialogRootProvider", context);

const part = partsOf<dialog.Api<PropTypes>, Api>("Dialog", context);

/** The floating part, carrying the ref that keeps it in the top layer
 * with the machine. */
export const DialogPositioner = definePart<Api>("DialogPositioner", context, (value) => ({
  ...value.api.value.getPositionerProps(),
  ref: value.positioner,
}));

export const DialogTrigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const DialogContent = part("Content", (api) => api.getContentProps());
export const DialogTitle = part("Title", (api) => api.getTitleProps(), "h2");
export const DialogDescription = part("Description", (api) => api.getDescriptionProps(), "p");
export const DialogCloseTrigger = part(
  "CloseTrigger",
  (api) => api.getCloseTriggerProps(),
  "button",
);
