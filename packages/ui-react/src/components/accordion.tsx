import { propNames } from "@monowind/ui/accordion";
import type * as accordion from "@monowind/ui/accordion";
import type { PropTypes } from "@zag-js/react";
import type { ReactNode } from "react";
import { useAccordion, type Connected } from "../hooks.ts";
import {
  defineContext,
  definePart,
  defineRoot,
  defineRootProvider,
  renderPart,
  type PartProps,
} from "./part.tsx";

/**
 * Zag's accordion as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its `Root` is an element of its
 * own — Zag gives an accordion a root part — and takes attributes; an
 * `Item` holds its value for the parts inside it.
 */

export type Api = Connected<accordion.Api<PropTypes>, accordion.Service>;

const context = defineContext<Api>("Accordion");

/** The accordion a part is in, as `useAccordion()` returns it. */
export const useAccordionContext = context.use;

/** An accordion over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<accordion.Props, Api, PartProps<"div">>(
  "Accordion.Root",
  useAccordion,
  context,
  propNames,
  (api) => api.getRootProps(),
);

/** An accordion over an API the caller holds: run `useAccordion()`
 * yourself and hand it over. */
export const RootProvider = defineRootProvider<Api>("Accordion.RootProvider", context);

const held = defineContext<accordion.ItemProps>(
  "Accordion.Item",
  "an Accordion item part must be inside <Accordion.Item>",
);

/** The item a part is inside: its value, and whether it is disabled. */
export const useAccordionItemContext = held.use;

/** An item, by its value, held for the parts inside it. */
export function Item({
  value,
  disabled,
  children,
  ...rest
}: PartProps<"div"> & accordion.ItemProps): ReactNode {
  const api = context.use();
  const own = { value, disabled };
  return renderPart("Accordion.Item", "div", api.getItemProps(own), {
    ...rest,
    children: <held.Provider value={own}>{children}</held.Provider>,
  });
}
Item.displayName = "Accordion.Item";

const useItem = () => ({ api: context.use(), item: held.use() });

export const ItemTrigger = definePart(
  "Accordion.ItemTrigger",
  useItem,
  ({ api, item }) => api.getItemTriggerProps(item),
  "button",
);
export const ItemContent = definePart("Accordion.ItemContent", useItem, ({ api, item }) =>
  api.getItemContentProps(item),
);
export const ItemIndicator = definePart(
  "Accordion.ItemIndicator",
  useItem,
  ({ api, item }) => api.getItemIndicatorProps(item),
  "span",
);
