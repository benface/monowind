import { dialog, type Props as DialogProps } from "../dialog.ts";
import { listbox, type MountProps as ListboxProps } from "../listbox.ts";
import { menu, type MountProps as MenuProps, type Props } from "../menu.ts";
import { popover, type Props as PopoverProps } from "../popover.ts";
import { select, type MountProps as SelectProps } from "../select.ts";
import { tooltip, type Props as TooltipProps } from "../tooltip.ts";
import { defineElement, type Kind, type MonoElement } from "./element.ts";

/**
 * The elements for markup (specs/ui.md "Component layer"): one per
 * component, each the vanilla mount's root, its attributes the
 * machine's props and its callbacks events. Registering nothing on
 * import — `defineMonoUi()` does it, as `defineMonoWind()` does core's
 * — so the package's `sideEffects: false` holds.
 *
 * Each mount casts the props: an element reads them off its attributes
 * by kind, which no static type can narrow to its machine's own.
 */

/** What every dismissable component handles past its own callbacks. */
const DISMISSABLE = [
  "onEscapeKeyDown",
  "onInteractOutside",
  "onFocusOutside",
  "onPointerDownOutside",
] as const;

/** The props no attribute can carry, which every component takes.
 * `getRootNode` is not among them: the DOM owns that name on every
 * node, so it is `setProp`'s alone. */
const PROPERTIES = ["ids", "translations"] as const;

/** The direction and the trigger value every component takes. */
const COMMON: Record<string, Kind> = {
  dir: "string",
  "default-trigger-value": "string",
  "trigger-value": "string",
};

/** Every `<mono-submenu>` under a menu marks the part its mount looks
 * for and hands up what its own markup carries, keyed by its value:
 * the parser may upgrade one after the menu around it, which would
 * mark its part too late for that mount to find. */
function submenusOf(root: Element): Record<string, Props> {
  const submenus: Record<string, Props> = {};
  for (const element of root.querySelectorAll("mono-submenu")) {
    const value = element.getAttribute("value");
    const props = (element as MonoElement).publish?.();
    if (value && props) submenus[value] = props as unknown as Props;
  }
  return submenus;
}

export const MonoMenu = defineElement({
  properties: [...PROPERTIES, "navigate"],
  mount: (root, props) =>
    menu(root, { ...props, submenus: submenusOf(root) } as unknown as MenuProps),
  anchored: true,
  attributes: {
    ...COMMON,
    "close-on-select": "boolean",
    "loop-focus": "boolean",
    typeahead: "boolean",
    composite: "boolean",
    "default-highlighted-value": "string",
    "highlighted-value": "string",
  },
  callbacks: [
    "onSelect",
    "onHighlightChange",
    "onOpenChange",
    "onTriggerValueChange",
    ...DISMISSABLE,
  ],
});

/** A submenu is its parent's to mount: the element marks the root and
 * carries what the parent reads off it, its `value` pairing it with
 * the trigger item before it. */
export const MonoSubmenu = defineElement({
  part: "submenu",
  anchored: true,
  attributes: {},
  callbacks: ["onOpenChange", ...DISMISSABLE],
});

export const MonoListbox = defineElement({
  properties: [...PROPERTIES, "collection", "scrollToIndexFn"],
  mount: (root, props) => listbox(root, props as unknown as ListboxProps),
  attributes: {
    ...COMMON,
    disabled: "boolean",
    "disallow-select-all": "boolean",
    "loop-focus": "boolean",
    "select-on-highlight": "boolean",
    deselectable: "boolean",
    typeahead: "boolean",
    "default-highlighted-value": "string",
    "highlighted-value": "string",
  },
  callbacks: ["onSelect", "onHighlightChange", "onValueChange"],
});

export const MonoSelect = defineElement({
  properties: [...PROPERTIES, "collection", "scrollToIndexFn"],
  mount: (root, props) => select(root, props as unknown as SelectProps),
  anchored: true,
  attributes: {
    ...COMMON,
    name: "string",
    form: "string",
    "auto-complete": "string",
    disabled: "boolean",
    invalid: "boolean",
    "read-only": "boolean",
    required: "boolean",
    "close-on-select": "boolean",
    "loop-focus": "boolean",
    multiple: "boolean",
    composite: "boolean",
    deselectable: "boolean",
    "default-highlighted-value": "string",
    "highlighted-value": "string",
  },
  callbacks: ["onSelect", "onHighlightChange", "onValueChange", "onOpenChange"],
});

export const MonoDialog = defineElement({
  properties: [
    ...PROPERTIES,
    "initialFocusEl",
    "finalFocusEl",
    "restoreFocus",
    "persistentElements",
  ],
  mount: (root, props) => dialog(root, props as unknown as DialogProps),
  anchored: true,
  attributes: {
    ...COMMON,
    "trap-focus": "boolean",
    "prevent-scroll": "boolean",
    modal: "boolean",
    "restore-focus": "boolean",
    "close-on-interact-outside": "boolean",
    "close-on-escape": "boolean",
    // The element's own `role` is its own; the machine's names itself.
    "content-role": "string",
  },
  aliases: { "content-role": "role" },
  callbacks: ["onOpenChange", "onTriggerValueChange", ...DISMISSABLE],
});

export const MonoPopover = defineElement({
  properties: [...PROPERTIES, "initialFocusEl", "persistentElements"],
  mount: (root, props) => popover(root, props as unknown as PopoverProps),
  anchored: true,
  attributes: {
    ...COMMON,
    modal: "boolean",
    portalled: "boolean",
    "auto-focus": "boolean",
    "restore-focus": "boolean",
    "close-on-interact-outside": "boolean",
    "close-on-escape": "boolean",
  },
  callbacks: ["onOpenChange", "onTriggerValueChange", ...DISMISSABLE],
});

export const MonoTooltip = defineElement({
  properties: [...PROPERTIES],
  mount: (root, props) => tooltip(root, props as unknown as TooltipProps),
  anchored: true,
  attributes: {
    ...COMMON,
    "open-delay": "number",
    "close-delay": "number",
    "close-on-pointer-down": "boolean",
    "close-on-escape": "boolean",
    "close-on-scroll": "boolean",
    "close-on-click": "boolean",
    interactive: "boolean",
    disabled: "boolean",
  },
  callbacks: ["onOpenChange", "onTriggerValueChange"],
});

const ELEMENTS: Record<string, CustomElementConstructor> = {
  "mono-menu": MonoMenu,
  "mono-submenu": MonoSubmenu,
  "mono-listbox": MonoListbox,
  "mono-select": MonoSelect,
  "mono-dialog": MonoDialog,
  "mono-popover": MonoPopover,
  "mono-tooltip": MonoTooltip,
};

/** Register every element, as `defineMonoWind()` registers core's.
 * Defining one twice is the caller's to avoid, so a name already taken
 * is left alone. */
export function defineMonoUi(): void {
  if (typeof customElements === "undefined") return;
  for (const [name, element] of Object.entries(ELEMENTS)) {
    if (!customElements.get(name)) customElements.define(name, element);
  }
}

export { MonoElement, defineElement } from "./element.ts";
export type { Definition, ElementClass, Kind } from "./element.ts";
