import { getContext, setContext } from "svelte";
import type { Snippet } from "svelte";
import type { ItemApi } from "@monowind/ui/framework";
export { warnStray } from "@monowind/ui/framework";
import type * as dialog from "@monowind/ui/dialog";
import type * as listbox from "@monowind/ui/listbox";
import type * as menu from "@monowind/ui/menu";
import type * as popover from "@monowind/ui/popover";
import type * as select from "@monowind/ui/select";
import type * as tooltip from "@monowind/ui/tooltip";
import type { PropTypes } from "@zag-js/svelte";
import type { Created, InFlow } from "../index.svelte.ts";

/**
 * What a compound component's parts read (specs/ui.md "Component
 * layer"): the root's own `create…` return, held in Svelte's context
 * and reached through a getter, so the API the parts read stays live.
 */

/** What every part takes past the props of the element it renders:
 * its content, or the `child` snippet that renders an element of the
 * author's own with the part's props handed to it. */
export interface PartProps {
  children?: Snippet;
  child?: Snippet<[Record<string, unknown>]>;
  [key: string]: unknown;
}

/** A component's context: what its parts read, and the reader that
 * fails loudly outside a root rather than on an undefined API. */
export function defineContext<V>(name: string): {
  set: (value: V) => void;
  use: () => V;
  useOptional: () => V | undefined;
} {
  const key = Symbol(name);
  return {
    set: (value) => {
      setContext(key, value);
    },
    use: () => {
      const value = getContext<V | undefined>(key);
      if (value === undefined) throw new Error(`a ${name} part must be inside <${name}Root>`);
      return value;
    },
    useOptional: () => getContext<V | undefined>(key),
  };
}

export type MenuApi = Created<menu.Api<PropTypes>, menu.Service>;
export type DialogApi = Created<dialog.Api<PropTypes>, dialog.Service>;
export type PopoverApi = Created<popover.Api<PropTypes>, popover.Service>;
export type TooltipApi = Created<tooltip.Api<PropTypes>, tooltip.Service>;
export type ListboxApi = InFlow<listbox.Api<PropTypes>, listbox.Service>;
export type SelectApi = Created<select.Api<PropTypes>, select.Service>;

/** What a menu's parts read: its own create, the menu it is nested
 * in, and the props it was given, which its own submenus take the
 * behavior half of — null under a `MenuRootProvider`, whose API the
 * caller built and whose props are theirs. */
export interface MenuValue {
  readonly menu: MenuApi;
  readonly parent: MenuValue | null;
  readonly props: menu.Props | null;
}

export const menuContext = defineContext<MenuValue>("Menu");
export const listboxContext = defineContext<ListboxApi>("Listbox");
export const selectContext = defineContext<SelectApi>("Select");
export const dialogContext = defineContext<DialogApi>("Dialog");
export const popoverContext = defineContext<PopoverApi>("Popover");
export const tooltipContext = defineContext<TooltipApi>("Tooltip");

/** The menu a part is in, as `createMenu()` returns it. */
export const useMenuContext = (): MenuApi => menuContext.use().menu;
/** The dialog a part is in, as `createDialog()` returns it. */
export const useDialogContext = (): DialogApi => dialogContext.use();
/** The popover a part is in, as `createPopover()` returns it. */
export const usePopoverContext = (): PopoverApi => popoverContext.use();
/** The tooltip a part is in, as `createTooltip()` returns it. */
export const useTooltipContext = (): TooltipApi => tooltipContext.use();
/** The listbox a part is in, as `createListbox()` returns it. */
export const useListboxContext = (): ListboxApi => listboxContext.use();
/** The select a part is in, as `createSelect()` returns it. */
export const useSelectContext = (): SelectApi => selectContext.use();

/** The item an `Item` holds, for the text and the indicator inside
 * it: whatever the collection holds, which is the author's shape. A
 * getter, so the parts read the item the props currently name. */
export const itemContext = defineContext<() => unknown>("Item");

/** The collection's item the part is inside. */
export const useItemContext = (): unknown => itemContext.use()();

/** The collection's item a part names: the one it was given, else
 * the one its value finds. */
export function itemOf(api: ItemApi, props: { item?: unknown; value?: string }): unknown {
  return props.item !== undefined ? props.item : api.collection.find(props.value ?? "");
}

/** A created component held live: a prop read outside a closure
 * captures only its first value, so the parts read the caller's
 * current one through these getters. A listbox has no positioner,
 * and reading an absent one back gives the same `undefined`. */
export function live<A, S>(value: () => Created<A, S>): Created<A, S> {
  return {
    get api() {
      return value().api;
    },
    get service() {
      return value().service;
    },
    get positioner() {
      return value().positioner;
    },
  };
}

/** A callback that first writes the prop a `bind:` follows, then runs
 * the author's own — Svelte's two-way binding over an uncontrolled
 * machine. */
export function bound<D extends object, K extends keyof D>(
  key: K,
  write: (value: D[K]) => void,
  authored: ((detail: D) => void) | undefined,
): (detail: D) => void {
  return (detail) => {
    write(detail[key]);
    authored?.(detail);
  };
}

/** A root's props split in two: the machine's, which Zag names, and
 * the rest, which are the root element's own attributes. */
export function splitProps<P extends object>(
  props: P,
  names: readonly string[],
): [P, Record<string, unknown>] {
  const machine: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    (names.includes(key) ? machine : attributes)[key] = value;
  }
  return [machine as P, attributes];
}

/** A part's own props as the getter takes them: one left out is not
 * one set to `undefined`, which would override a default of Zag's. */
export function defined<T extends object>(props: T): T {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as T;
}
