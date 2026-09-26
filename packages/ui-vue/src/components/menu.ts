import { computed, defineComponent, useId } from "vue";
import type { ComponentObjectPropsOptions, ComputedRef } from "vue";
import { defined, warnStray } from "@monowind/ui/framework";
import { asSubmenuOf, propNames } from "@monowind/ui/menu";
import type * as menu from "@monowind/ui/menu";
import type { PropTypes } from "@zag-js/vue";
import { useMenu, type Composed } from "../composables.ts";
import {
  BOOLEAN,
  declarationsOf,
  defineContext,
  definePart,
  partsOf,
  positionerPart,
  triggerPart,
  updatesOf,
  withUpdates,
  type RootProps,
} from "./part.ts";

/**
 * Zag's menu as a compound component (specs/ui.md "Component layer"):
 * a `MenuRoot` providing the API to the parts under it, and a
 * `MenuRoot` inside another the submenu of the menu around it — Zag
 * links the two by service, and its `MenuTriggerItem` is the parent's
 * item that opens it.
 */

type Api = Composed<menu.Api<PropTypes>, menu.Service>;

/** What a menu's parts inject: its API, the menu it is nested in, and
 * the props it was given, which its own submenus take the behavior
 * half of — null under a `MenuRootProvider`, whose API the caller
 * built and whose props are theirs. */
interface Value extends Api {
  parent: Value | null;
  props: ComputedRef<menu.Props> | null;
}

const context = defineContext<Value>("Menu");

/** The menu a part is in, as `useMenu()` returns it. */
export const useMenuContext = (): Api => context.use();

/** A menu over its own machine, an id generated where none is given.
 * Nested in another, it is that menu's submenu. */
export const MenuRoot = defineComponent(
  (props: RootProps<menu.Props>, { slots, attrs, emit }) => {
    const parent = context.useOptional();
    const generated = useId();
    const own = computed<menu.Props>(
      () =>
        withUpdates(
          { ...defined(props), id: props.id ?? generated },
          propNames,
          emit,
        ) as unknown as menu.Props,
    );
    const machineProps = computed<menu.Props>(() =>
      parent ? asSubmenuOf(parent.props?.value ?? { id: own.value.id }, own.value) : own.value,
    );
    const instance = useMenu(machineProps);
    warnStray("MenuRoot", Object.keys(attrs), instance);
    context.provide({ ...instance, parent: parent ?? null, props: machineProps });
    // Linked before the parts render, as the vanilla mount links a
    // marked submenu before its first spread; a service outlives
    // every render, so once is enough.
    if (parent) {
      parent.api.value.setChild(instance.service);
      instance.api.value.setParent(parent.service);
    }
    return () => slots["default"]?.();
  },
  {
    name: "MenuRoot",
    inheritAttrs: false,
    props: declarationsOf(propNames) as ComponentObjectPropsOptions<RootProps<menu.Props>>,
    emits: updatesOf(propNames),
  },
);

/** A menu over an API the caller holds, for reaching it from outside
 * the tree: run `useMenu()` yourself and provide what it returns. */
export const MenuRootProvider = defineComponent(
  (props: { value: Api }, { slots }) => {
    const parent = context.useOptional();
    context.provide({ ...props.value, parent: parent ?? null, props: null });
    return () => slots["default"]?.();
  },
  { name: "MenuRootProvider", inheritAttrs: false, props: ["value"] },
);

const part = partsOf<menu.Api<PropTypes>, Value>("Menu", context);

export const MenuTrigger = triggerPart<menu.Api<PropTypes>, Value>("Menu", context);

/** The item of the menu above that opens this one: the submenu's own
 * trigger, which is why it goes inside the nested `MenuRoot`. */
export const MenuTriggerItem = definePart<Value & { parent: Value }>(
  "MenuTriggerItem",
  {
    use: () => {
      const value = context.use();
      if (!value.parent) throw new Error("a MenuTriggerItem must be inside a nested <MenuRoot>");
      return { ...value, parent: value.parent };
    },
  },
  ({ api, parent }) => parent.api.value.getTriggerItemProps(api.value),
);

export const MenuPositioner = positionerPart("Menu", context);

export const MenuContent = part("Content", (api) => api.getContentProps());
export const MenuItem = part<
  "div",
  { value: string; disabled?: boolean; closeOnSelect?: boolean; valueText?: string }
>("Item", (api, own) => api.getItemProps(own as { value: string }), "div", {
  value: null,
  disabled: BOOLEAN,
  closeOnSelect: BOOLEAN,
  valueText: null,
});
export const MenuItemGroup = part<"div", { id: string }>(
  "ItemGroup",
  (api, own) => api.getItemGroupProps(own as { id: string }),
  "div",
  { id: null },
);
export const MenuItemGroupLabel = part<"div", { htmlFor: string }>(
  "ItemGroupLabel",
  (api, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
  "div",
  { htmlFor: null },
);
export const MenuSeparator = part("Separator", (api) => api.getSeparatorProps(), "hr");
