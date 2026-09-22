import { computed, defineComponent, useId, type ComputedRef } from "vue";
import { warnStray } from "@monowind/ui/framework";
import { asSubmenuOf, propNames } from "@monowind/ui/menu";
import type * as menu from "@monowind/ui/menu";
import type { PropTypes } from "@zag-js/vue";
import { useMenu, type Composed } from "../composables.ts";
import {
  defined,
  defineContext,
  definePart,
  partsOf,
  renderPart,
  updatesOf,
  withUpdates,
} from "./part.ts";

/**
 * Zag's menu as a compound component (specs/ui.md "Component layer"):
 * a `MenuRoot` providing the API to the parts under it, and a
 * `MenuRoot` inside another the submenu of the menu around it — Zag
 * links the two by service, and its `MenuTriggerItem` is the parent's
 * item that opens it.
 */

export type Api = Composed<menu.Api<PropTypes>, menu.Service>;

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
  (props: Omit<menu.Props, "id"> & { id?: string }, { slots, attrs, emit }) => {
    const parent = context.useOptional();
    const generated = useId();
    warnStray("MenuRoot", Object.keys(attrs));
    const own = computed<menu.Props>(
      () =>
        withUpdates(
          { ...defined(props), id: props.id ?? generated },
          propNames,
          emit,
        ) as unknown as menu.Props,
    );
    // A submenu opens beside its item on the reading side and takes
    // the behavior its parent shares, exactly as a marked one does.
    const machineProps = computed<menu.Props>(() =>
      parent ? asSubmenuOf(parent.props?.value ?? { id: own.value.id }, own.value) : own.value,
    );
    const instance = useMenu(machineProps);
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
  { name: "MenuRoot", inheritAttrs: false, props: [...propNames], emits: updatesOf(propNames) },
);

/** A menu over an API the caller holds, for reaching it from outside
 * the tree: run `useMenu()` yourself and provide what it returns. */
export const MenuRootProvider = defineComponent(
  (props: { value: Api }, { slots }) => {
    const parent = context.useOptional();
    context.provide({
      ...props.value,
      parent: parent ?? null,
      props: computed(() => ({ id: "" })),
    });
    return () => slots["default"]?.();
  },
  { name: "MenuRootProvider", inheritAttrs: false, props: ["value"] },
);

const part = partsOf<menu.Api<PropTypes>, Value>("Menu", context);

export const MenuTrigger = part("Trigger", (api, own) => api.getTriggerProps(own), "button", [
  "value",
]);

/** The item of the menu above that opens this one: the submenu's own
 * trigger, which is why it goes inside the nested `MenuRoot`. */
export const MenuTriggerItem = defineComponent({
  name: "MenuTriggerItem",
  inheritAttrs: false,
  props: ["asChild"] as string[],
  setup(props: Record<string, unknown>, { slots, attrs }) {
    const own = context.use();
    const { parent } = own;
    if (!parent) throw new Error("a MenuTriggerItem must be inside a nested <MenuRoot>");
    return () =>
      renderPart(
        "div",
        parent.api.value.getTriggerItemProps(own.api.value),
        attrs as Record<string, unknown>,
        Boolean(props["asChild"]),
        slots["default"]?.(),
        "MenuTriggerItem",
      );
  },
});

/** The floating part, carrying the ref that keeps it in the top
 * layer with the machine. */
export const MenuPositioner = definePart<Value>("MenuPositioner", context, (value) => ({
  ...value.api.value.getPositionerProps(),
  ref: value.positioner,
}));

export const MenuContent = part("Content", (api) => api.getContentProps());
export const MenuItem = part(
  "Item",
  (api, own) => api.getItemProps(own as { value: string }),
  "div",
  ["value", "disabled", "closeOnSelect", "valueText"],
);
export const MenuItemGroup = part(
  "ItemGroup",
  (api, own) => api.getItemGroupProps(own as { id: string }),
  "div",
  ["id"],
);
export const MenuItemGroupLabel = part(
  "ItemGroupLabel",
  (api, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
  "div",
  ["htmlFor"],
);
export const MenuSeparator = part("Separator", (api) => api.getSeparatorProps(), "hr");
