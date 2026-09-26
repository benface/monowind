import { leafRendererFor } from "./leaf.ts";

/** The attributes that render, past every `data-*` (specs/cell-model.md
 * "Observation"): HTML's states and presentation, `id` (a popover's
 * implicit anchor, and a `#id` style), `role` and `tabindex` (the
 * interactives and the focus invert), an invoker's target, and the ARIA
 * states an `aria-*` variant styles. */
const RENDERING = new Set([
  "class",
  "style",
  "id",
  "role",
  "tabindex",
  "hidden",
  "open",
  "popover",
  "popovertarget",
  "commandfor",
  "inert",
  "dir",
  "lang",
  "contenteditable",
  "disabled",
  "checked",
  "selected",
  "readonly",
  "required",
  "min",
  "max",
  "step",
  "pattern",
  "minlength",
  "maxlength",
  "multiple",
  "placeholder",
  "type",
  "value",
  "size",
  "rows",
  "cols",
  "wrap",
  "href",
  "src",
  "alt",
  "width",
  "height",
  "label",
  "start",
  "reversed",
  "colspan",
  "rowspan",
  "span",
  "align",
  "valign",
  "nowrap",
  "border",
  "cellpadding",
  "cellspacing",
  "bgcolor",
  "color",
  "aria-busy",
  "aria-checked",
  "aria-current",
  "aria-disabled",
  "aria-expanded",
  "aria-hidden",
  "aria-invalid",
  "aria-pressed",
  "aria-readonly",
  "aria-required",
  "aria-selected",
  "aria-sort",
]);

/** Whether a change to the attribute can change what the grid shows: a
 * rendering attribute, any `data-*` but the engine's `data-mw-*` marks,
 * or any attribute of a leaf, which its renderer reads. */
export function rendersAttribute(element: Element, name: string): boolean {
  if (name.startsWith("data-")) return !name.startsWith("data-mw-");
  return RENDERING.has(name) || leafRendererFor(element.tagName) !== undefined;
}
