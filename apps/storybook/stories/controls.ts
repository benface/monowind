import { noChange } from "lit";
import { Directive, directive, PartType, type ElementPart, type PartInfo } from "lit/directive.js";
import type { ArgTypes, Args } from "@storybook/web-components-vite";
import { action } from "storybook/actions";
import type * as accordion from "@monowind/ui/accordion";
import type * as combobox from "@monowind/ui/combobox";
import type * as dialog from "@monowind/ui/dialog";
import type * as listbox from "@monowind/ui/listbox";
import type * as menu from "@monowind/ui/menu";
import {
  eventNameOf,
  propOf,
  type ElementClass,
  type Kind,
} from "../../../packages/ui/src/elements/element.ts";

/**
 * A `Packages / ui` story's options as Storybook controls, read off its
 * element's attribute table, so a prop an element gains reaches its
 * story unedited. A control's default is the story's markup; the rest
 * start unset, the machine's defaults.
 */

type Placement = NonNullable<NonNullable<menu.Props["positioning"]>["placement"]>;

/** Every value of a string union, the type check failing on one left
 * out or one too many. */
const valuesOf = <T extends string>(values: Record<T, true>): T[] => Object.keys(values) as T[];

/** The string attributes whose values are a known set. */
const OPTIONS: Readonly<Record<string, readonly string[]>> = {
  placement: valuesOf<Placement>({
    top: true,
    "top-start": true,
    "top-end": true,
    bottom: true,
    "bottom-start": true,
    "bottom-end": true,
    left: true,
    "left-start": true,
    "left-end": true,
    right: true,
    "right-start": true,
    "right-end": true,
  }),
  orientation: valuesOf<NonNullable<accordion.Props["orientation"]>>({
    vertical: true,
    horizontal: true,
  }),
  "selection-mode": valuesOf<NonNullable<listbox.Props["selectionMode"]>>({
    single: true,
    multiple: true,
    extended: true,
    none: true,
  }),
  "input-behavior": valuesOf<NonNullable<combobox.Props["inputBehavior"]>>({
    autohighlight: true,
    autocomplete: true,
    none: true,
  }),
  "selection-behavior": valuesOf<NonNullable<combobox.Props["selectionBehavior"]>>({
    replace: true,
    clear: true,
    preserve: true,
  }),
  "content-role": valuesOf<NonNullable<dialog.Props["role"]>>({ dialog: true, alertdialog: true }),
};

/** Attributes with no control: the direction, which the engine lays
 * out left to right alone (cell-model.md deviations 18 and 29); a form's
 * plumbing and an accessible name, which the canvas does not show. */
const LEFT_OUT = new Set(["dir", "name", "form", "auto-complete", "aria-label"]);

/** A control's attribute: past those, and past the state the reader
 * drives — a controlled `*-value` would freeze the component, and a
 * `default-*-value` is read once, at the mount. */
const isControl = (name: string): boolean => !LEFT_OUT.has(name) && !name.endsWith("-value");

/** The controls an element's table gives, as a story and its twins
 * share them. */
export function controlsOf(
  element: ElementClass<unknown>,
  defaults: Args = {},
): { args: Args; argTypes: ArgTypes } {
  const argTypes: ArgTypes = {};
  for (const [name, kind] of Object.entries(element.table)) {
    if (!isControl(name)) continue;
    const options = OPTIONS[name];
    argTypes[name] = options
      ? { control: "select", options }
      : { control: kind === "string" ? "text" : kind };
  }
  return { args: defaults, argTypes };
}

/** An arg as the attribute it names, null for none: a boolean by
 * presence, `"false"` turning off one whose machine default is on; a
 * number or a string as written. */
function attributeOf(kind: Kind, value: unknown): string | null {
  if (kind === "boolean") return typeof value === "boolean" ? (value ? "" : "false") : null;
  if (kind === "number")
    return typeof value === "number" && !Number.isNaN(value) ? String(value) : null;
  return typeof value === "string" && value !== "" ? value : null;
}

function write(element: Element, name: string, kind: Kind, value: unknown): void {
  const written = attributeOf(kind, value);
  if (written === null) element.removeAttribute(name);
  else if (element.getAttribute(name) !== written) element.setAttribute(name, written);
}

class Controlled extends Directive {
  #logging = false;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error("`controlled` goes on an element");
  }

  render(_args: Args): unknown {
    return noChange;
  }

  override update({ element }: ElementPart, [args]: [Args]): unknown {
    const own = customElements.get(element.localName) as ElementClass<unknown>;
    for (const [name, kind] of Object.entries(own.table)) {
      if (isControl(name)) write(element, name, kind, args[name]);
    }
    if (!this.#logging) {
      this.#logging = true;
      for (const callback of own.definition.callbacks) {
        const log = action(eventNameOf(callback));
        element.addEventListener(eventNameOf(callback), (event) =>
          log((event as CustomEvent).detail),
        );
      }
    }
    return noChange;
  }
}

/**
 * The args onto the `<mono-*>` element it sits on, as attributes by
 * its table's kinds, and its events into the Actions panel. Lit runs it
 * before the element connects, so the mount reads the first args as
 * it reads markup; a later arg reaches the running machine.
 */
export const controlled = directive(Controlled);

/**
 * The args as the vanilla mount's props, as the element makes them of
 * its attributes (`propOf`), and every callback into the Actions
 * panel. At the mount an unset one is absent; `cleared` for
 * `updateProps` gives it as undefined, so the merge drops it.
 */
export function propsOf(
  element: ElementClass<unknown>,
  args: Args,
  cleared = false,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const read = (name: string) => args[name];
  for (const name of Object.keys(element.table)) {
    if (isControl(name)) Object.assign(props, propOf(element, name, read, cleared));
  }
  for (const callback of element.definition.callbacks) props[callback] = action(callback);
  return props;
}
