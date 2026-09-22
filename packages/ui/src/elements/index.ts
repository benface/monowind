import { combobox, type MountProps as ComboboxProps } from "../combobox.ts";
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

/** The content's accessible name, as Zag spells the prop. The
 * element's own `aria-label` is inert — it carries no role — so the
 * attribute is the plain one a markup author reaches for. */
const CONTENT_LABEL = { "aria-label": "aria-label" } as const;

/** An interaction away from the content, which a list closes on. */
const OUTSIDE = ["onInteractOutside", "onFocusOutside", "onPointerDownOutside"] as const;

/** What a component the reader dismisses handles past those: a menu,
 * a dialog and a popover, which Escape closes and which can refuse. */
const DISMISSABLE = [...OUTSIDE, "onEscapeKeyDown", "onRequestDismiss"] as const;

/** The prop no attribute can carry that every component takes. The
 * DOM owns `getRootNode` on every node, so that one is `setProp`'s
 * alone. */
const PROPERTIES = ["ids"] as const;

/** Those, plus the strings a component reads to its user: a select, a
 * combobox and a popover take them. */
const TRANSLATED = [...PROPERTIES, "translations"] as const;

/** The reading direction every component takes. */
const DIRECTION: Record<string, Kind> = { dir: "string" };

/** Which of several triggers a component is open against, for the
 * four that can have more than one: a menu, a dialog, a popover and a
 * tooltip. */
const TRIGGERS: Record<string, Kind> = {
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
  properties: [...PROPERTIES, "navigate", "anchorPoint"],
  mount: (root, props) =>
    menu(root, { ...props, submenus: submenusOf(root) } as unknown as MenuProps),
  anchored: true,
  attributes: {
    ...DIRECTION,
    ...TRIGGERS,
    "close-on-select": "boolean",
    "loop-focus": "boolean",
    typeahead: "boolean",
    "aria-label": "string",
    composite: "boolean",
    "default-highlighted-value": "string",
    "highlighted-value": "string",
  },
  aliases: CONTENT_LABEL,
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
    ...DIRECTION,
    disabled: "boolean",
    orientation: "string",
    "selection-mode": "string",
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
  properties: [...TRANSLATED, "collection", "scrollToIndexFn"],
  mount: (root, props) => select(root, props as unknown as SelectProps),
  anchored: true,
  attributes: {
    ...DIRECTION,
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
  callbacks: ["onSelect", "onHighlightChange", "onValueChange", "onOpenChange", ...OUTSIDE],
});

export const MonoCombobox = defineElement({
  properties: [...TRANSLATED, "collection", "navigate", "scrollToIndexFn"],
  mount: (root, props) => combobox(root, props as unknown as ComboboxProps),
  anchored: true,
  attributes: {
    ...DIRECTION,
    name: "string",
    form: "string",
    placeholder: "string",
    "input-behavior": "string",
    "selection-behavior": "string",
    "allow-custom-value": "boolean",
    "auto-focus": "boolean",
    "close-on-select": "boolean",
    composite: "boolean",
    disabled: "boolean",
    invalid: "boolean",
    "loop-focus": "boolean",
    multiple: "boolean",
    "open-on-change": "boolean",
    "open-on-click": "boolean",
    "open-on-key-press": "boolean",
    "read-only": "boolean",
    required: "boolean",
    "disable-layer": "boolean",
    "always-submit-on-enter": "boolean",
    "default-input-value": "string",
    "input-value": "string",
    "default-highlighted-value": "string",
    "highlighted-value": "string",
  },
  callbacks: [
    "onSelect",
    "onHighlightChange",
    "onValueChange",
    "onInputValueChange",
    "onOpenChange",
    ...OUTSIDE,
  ],
});

export const MonoDialog = defineElement({
  properties: [...PROPERTIES, "initialFocusEl", "finalFocusEl", "persistentElements"],
  mount: (root, props) => dialog(root, props as unknown as DialogProps),
  anchored: true,
  attributes: {
    ...DIRECTION,
    ...TRIGGERS,
    "trap-focus": "boolean",
    "prevent-scroll": "boolean",
    modal: "boolean",
    "restore-focus": "boolean",
    "close-on-interact-outside": "boolean",
    "close-on-escape": "boolean",
    "aria-label": "string",
    // The element's own `role` is its own; the machine's names itself.
    "content-role": "string",
  },
  aliases: { ...CONTENT_LABEL, "content-role": "role" },
  callbacks: ["onOpenChange", "onTriggerValueChange", ...DISMISSABLE],
});

export const MonoPopover = defineElement({
  properties: [...TRANSLATED, "initialFocusEl", "finalFocusEl", "persistentElements"],
  mount: (root, props) => popover(root, props as unknown as PopoverProps),
  anchored: true,
  attributes: {
    ...DIRECTION,
    ...TRIGGERS,
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
    ...DIRECTION,
    ...TRIGGERS,
    "open-delay": "number",
    "close-delay": "number",
    "close-on-pointer-down": "boolean",
    "close-on-escape": "boolean",
    "close-on-scroll": "boolean",
    "close-on-click": "boolean",
    interactive: "boolean",
    disabled: "boolean",
    "aria-label": "string",
  },
  aliases: CONTENT_LABEL,
  callbacks: ["onOpenChange", "onTriggerValueChange"],
});

const ELEMENTS: Record<string, CustomElementConstructor> = {
  "mono-menu": MonoMenu,
  "mono-submenu": MonoSubmenu,
  "mono-listbox": MonoListbox,
  "mono-select": MonoSelect,
  "mono-combobox": MonoCombobox,
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
