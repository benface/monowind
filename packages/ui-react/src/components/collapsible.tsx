import { propNames } from "@monowind/ui/collapsible";
import type * as collapsible from "@monowind/ui/collapsible";
import type { PropTypes } from "@zag-js/react";
import { useCollapsible, type Connected } from "../hooks.ts";
import { defineContext, defineRoot, defineRootProvider, partsOf, type PartProps } from "./part.tsx";

/**
 * Zag's collapsible as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its `Root` is an element of its
 * own — Zag gives a collapsible a root part — and takes attributes.
 */

export type Api = Connected<collapsible.Api<PropTypes>, collapsible.Service>;

const context = defineContext<Api>("Collapsible");

/** The collapsible a part is in, as `useCollapsible()` returns it. */
export const useCollapsibleContext = context.use;

/** A collapsible over its own machine, an id generated where none is
 * given. */
export const Root = defineRoot<collapsible.Props, Api, PartProps<"div">>(
  "Collapsible.Root",
  useCollapsible,
  context,
  propNames,
  (api) => api.getRootProps(),
);

/** A collapsible over an API the caller holds: run `useCollapsible()`
 * yourself and hand it over. */
export const RootProvider = defineRootProvider<Api>("Collapsible.RootProvider", context);

const part = partsOf("Collapsible", context.use);

export const Trigger = part("Trigger", (api) => api.getTriggerProps(), "button");
export const Content = part("Content", (api) => api.getContentProps());
export const Indicator = part("Indicator", (api) => api.getIndicatorProps(), "span");
