import { useEffect, useId, useRef, type ReactNode } from "react";
import { splitProps, warnStray } from "@monowind/ui/framework";
import { asSubmenuOf, propNames } from "@monowind/ui/menu";
import type * as menu from "@monowind/ui/menu";
import type { PropTypes } from "@zag-js/react";
import { useMenu, type Connected, type Positioned } from "../hooks.ts";
import { defineContext, partsOf, renderPart, triggerPart, type PartProps } from "./part.tsx";

/**
 * Zag's menu as a compound component (specs/ui.md "Component layer"):
 * a `Root` holding the API for the parts under it, and a `Root`
 * inside another one the submenu of the menu around it — Zag links
 * the two by service, and its `TriggerItem` is the parent's item that
 * opens it.
 */

export type Api = Connected<Positioned<menu.Api<PropTypes>>, menu.Service>;

/** What a menu's parts read: its API, the menu it is nested in, and
 * the props it was given, which its own submenus take the behavior
 * half of — null under a `RootProvider`, whose API the caller built
 * and whose props are theirs. */
interface Value {
  api: Api;
  parent: Value | null;
  props: menu.Props | null;
}

const context = defineContext<Value>("Menu");

/** The menu a part is in, as `useMenu()` returns it. */
export const useMenuContext = (): Api => context.use().api;

/** A menu over its own machine, an id generated where none is given.
 * Nested in another, it is that menu's submenu. */
export function Root({
  children,
  ...props
}: Omit<menu.Props, "id"> & { id?: string; children?: ReactNode }): ReactNode {
  const generated = useId();
  const parent = context.useOptional();
  // One object across this root's renders: the warning is said once per root.
  const instance = useRef(null);
  const [machine, rest] = splitProps(props as Record<string, unknown>, propNames);
  warnStray("Menu.Root", Object.keys(rest), instance);
  const own = { ...machine, id: props.id ?? generated } as menu.Props;
  // A submenu opens beside its item on the reading side and takes the
  // behavior its parent shares, exactly as a marked one does.
  const machineProps = parent ? asSubmenuOf(parent.props ?? { id: own.id }, own) : own;
  const api = useMenu(machineProps);
  // Zag hands a fresh service object over the same machine each render:
  // keyed on its stable `send`, the link is made once.
  useEffect(() => {
    if (!parent) return;
    parent.api.setChild(api.service);
    api.setParent(parent.api.service);
  }, [parent?.api.service.send, api.service.send]);
  return (
    <context.Provider value={{ api, parent, props: machineProps }}>{children}</context.Provider>
  );
}
Root.displayName = "Menu.Root";

/** A menu over an API the caller holds, for reaching it from outside
 * the tree: run `useMenu()` yourself and hand over what it returns. */
export function RootProvider({ value, children }: { value: Api; children?: ReactNode }): ReactNode {
  const parent = context.useOptional();
  return (
    <context.Provider value={{ api: value, parent, props: null }}>{children}</context.Provider>
  );
}
RootProvider.displayName = "Menu.RootProvider";

const part = partsOf("Menu", context.use);

export const Trigger = triggerPart("Menu", () => context.use().api);

/** The item of the menu above that opens this one: the submenu's own
 * trigger, which is why it goes inside the nested `Root`. */
export function TriggerItem(props: PartProps): ReactNode {
  const { api, parent } = context.use();
  if (!parent) throw new Error("a Menu.TriggerItem must be inside a nested <Menu.Root>");
  return renderPart("Menu.TriggerItem", "div", parent.api.getTriggerItemProps(api), props);
}
TriggerItem.displayName = "Menu.TriggerItem";

export const Positioner = part("Positioner", ({ api }) => api.getPositionerProps());
export const Content = part("Content", ({ api }) => api.getContentProps());
export const Item = part<
  "div",
  {
    value: string;
    disabled?: boolean | undefined;
    closeOnSelect?: boolean | undefined;
    valueText?: string | undefined;
  }
>("Item", ({ api }, own) => api.getItemProps(own as { value: string }), "div", [
  "value",
  "disabled",
  "closeOnSelect",
  "valueText",
]);
export const ItemGroup = part<"div", { id: string }>(
  "ItemGroup",
  ({ api }, own) => api.getItemGroupProps(own as { id: string }),
  "div",
  ["id"],
);
export const ItemGroupLabel = part<"div", { htmlFor: string }>(
  "ItemGroupLabel",
  ({ api }, own) => api.getItemGroupLabelProps(own as { htmlFor: string }),
  "div",
  ["htmlFor"],
);
export const Separator = part("Separator", ({ api }) => api.getSeparatorProps(), "hr");
