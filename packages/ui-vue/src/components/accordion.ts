import { propNames } from "@monowind/ui/accordion";
import type * as accordion from "@monowind/ui/accordion";
import type { PropTypes } from "@zag-js/vue";
import { computed, defineComponent, type ComputedRef } from "vue";
import { useAccordion, type InFlow } from "../composables.ts";
import {
  BOOLEAN,
  defineContext,
  definePart,
  defineRoot,
  defineRootProvider,
  renderPart,
  type Part,
} from "./part.ts";

/** Zag's accordion as a compound component (specs/ui.md "Component
 * layer"): it stands in the flow, so its root is an element of its
 * own — Zag gives an accordion a root part — and takes attributes; an
 * item holds its value for the parts inside it. */

type Api = InFlow<accordion.Api<PropTypes>, accordion.Service>;

const context = defineContext<Api>("Accordion");

/** The accordion a part is in, as `useAccordion()` returns it. */
export const useAccordionContext = (): Api => context.use();

/** An accordion over its own machine, an id generated where none is
 * given. */
export const AccordionRoot = defineRoot<accordion.Props, Api>(
  "AccordionRoot",
  propNames,
  context,
  useAccordion,
  ({ api }) => api.value.getRootProps(),
);

export const AccordionRootProvider = defineRootProvider<Api>("AccordionRootProvider", context);

const held = defineContext<ComputedRef<accordion.ItemProps>>(
  "AccordionItem",
  "an accordion item's parts must be inside its AccordionItem",
);

/** The item a part is inside: its value, and whether it is disabled. */
export const useAccordionItemContext = (): ComputedRef<accordion.ItemProps> => held.use();

/** An item, by its value, held for the parts inside it. */
export const AccordionItem = defineComponent(
  (props: accordion.ItemProps & { asChild?: boolean }, { slots, attrs }) => {
    const { api } = context.use();
    const own = computed(() => ({ value: props.value, disabled: props.disabled }));
    held.provide(own);
    return () =>
      renderPart(
        "div",
        api.value.getItemProps(own.value),
        attrs as Record<string, unknown>,
        Boolean(props.asChild),
        slots["default"]?.(),
        "AccordionItem",
      );
  },
  {
    name: "AccordionItem",
    inheritAttrs: false,
    props: { value: null, disabled: BOOLEAN, asChild: BOOLEAN },
  },
) as unknown as Part<"div", accordion.ItemProps>;

const insideItem = { use: () => ({ api: context.use().api, item: held.use() }) };

export const AccordionItemTrigger = definePart(
  "AccordionItemTrigger",
  insideItem,
  ({ api, item }) => api.value.getItemTriggerProps(item.value),
  "button",
);
export const AccordionItemContent = definePart(
  "AccordionItemContent",
  insideItem,
  ({ api, item }) => api.value.getItemContentProps(item.value),
);
export const AccordionItemIndicator = definePart(
  "AccordionItemIndicator",
  insideItem,
  ({ api, item }) => api.value.getItemIndicatorProps(item.value),
  "span",
);
