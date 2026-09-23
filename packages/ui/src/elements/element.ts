import type { Mounted } from "../vanilla.ts";

/**
 * The base every `<mono-*>` element is (specs/ui.md "Component
 * layer"): the vanilla mount's root and nothing more — no shadow root,
 * its parts the `data-part` descendants the mount finds, all of them
 * light DOM the engine lays out. Attributes are the machine's props by
 * type, callbacks are events, and `open` is the state both ways.
 */

/** How an attribute's value reads: true by presence and false as
 * `"false"`, a number parsed, a string as written. */
export type Kind = "boolean" | "number" | "string";

/** The positioning props every anchored element flattens, in cells. */
const POSITIONING: Record<string, Kind> = {
  placement: "string",
  gutter: "number",
  "offset-main-axis": "number",
  "offset-cross-axis": "number",
};

/** The event a callback prop dispatches: its name without `on`, lower
 * cased as one run, but for `onSelect` — the native `select` event
 * bubbles from inputs, so a menu's is `itemselect`. */
const NAMED: Record<string, string> = { onSelect: "itemselect" };

const eventNameOf = (callback: string): string =>
  NAMED[callback] ?? callback.slice(2).toLowerCase();

const camel = (attribute: string): string =>
  attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The props an element reads off its attributes and callbacks, each
 * by its kind — which no static type narrows to a machine's own, so
 * every element casts them at its mount. */
export type ElementProps = Record<string, unknown>;

/** What a list's API gives an element that remounts it: a listbox's,
 * a select's and a combobox's. */
interface Selecting {
  value: string[];
  setValue(value: string[]): void;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** Two prop values alike: the same, or arrays or plain objects whose
 * entries are — a framework hands a fresh `value` array or `ids`
 * object on every render. */
function equalProps(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => Object.is(entry, b[i]));
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/** What every element declares, whichever of the two it is. */
interface Declared {
  /** Attribute name to how its value reads; the prop is the attribute
   * camel-cased, and `anchored` adds the positioning four. */
  attributes: Readonly<Record<string, Kind>>;
  /** Attributes whose prop is named otherwise — the dialog's
   * `content-role`, its own `role` being the element's. */
  aliases?: Readonly<Record<string, string>>;
  /** Callback props, each an event on the element. */
  callbacks: readonly string[];
  /** Props no attribute can carry, defined as accessors on the class:
   * a framework that sets a property it finds (React does, with `in`)
   * hands the value over whole rather than stringified. A name the
   * DOM already carries is left alone. */
  properties?: readonly string[];
  /** Whether the positioning attributes apply. */
  anchored?: boolean;
}

/** What an element is: either the mount it roots, or the `data-part`
 * it marks for the mount above it to read — a submenu, which is its
 * parent menu's to mount. A marker's `value` attribute names it as
 * `data-value` does a hand-marked part. */
export type Definition<A> = Declared &
  (
    | { mount(root: Element, props: ElementProps): Mounted<A>; part?: undefined }
    | { part: string; mount?: undefined }
  );

/** The class `defineElement` returns: an element whose `api` is its
 * own mount's. */
export interface ElementClass<A> {
  new (): MonoElement & { readonly api: A | undefined };
  readonly prototype: MonoElement;
  readonly definition: Definition<unknown>;
  readonly table: Readonly<Record<string, Kind>>;
  readonly observedAttributes: string[];
}

let generated = 0;

export function defineElement<A>(definition: Definition<A>): ElementClass<A> {
  const attributes = definition.anchored
    ? { ...POSITIONING, ...definition.attributes }
    : definition.attributes;

  class Defined extends MonoElement {
    static override readonly definition = definition as Definition<unknown>;
    static override readonly table = attributes;
    static override get observedAttributes(): string[] {
      const named = definition.part ? ["value"] : [];
      return ["id", "open", ...named, ...Object.keys(attributes)];
    }
  }
  for (const name of definition.properties ?? []) {
    // A name the DOM already carries stays the DOM's: `getRootNode`
    // is a method on every node, and an accessor would shadow it.
    // Such a prop is `setProp`'s to set.
    if (name in Defined.prototype) continue;
    Object.defineProperty(Defined.prototype, name, {
      configurable: true,
      get(this: MonoElement) {
        return this.getProp(name);
      },
      set(this: MonoElement, value: unknown) {
        this.setProp(name, value);
      },
    });
  }
  return Defined as unknown as ElementClass<A>;
}

const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

export class MonoElement extends HTMLElementBase {
  static readonly definition: Definition<unknown>;
  static readonly table: Readonly<Record<string, Kind>>;
  static get observedAttributes(): string[] {
    return [];
  }

  #mounted: Mounted<unknown> | null = null;
  #observer: MutationObserver | null = null;
  /** The marked parts the current mount was given, by identity: a
   * mount writes into its own markup — a select fills its hidden
   * control with an option per item — and that must not read as
   * markup to mount again. */
  #parts: Element[] = [];
  #scheduled = false;
  /** The props set as properties, which no attribute carries. */
  #properties: Record<string, unknown> = {};
  /** A list's value at its first mount — the page's default, which a
   * form's reset goes back to — and every later mount's start. */
  #initialValue: string[] | undefined;
  /** The reader's selection as the last mount left it, which the next
   * one puts back. */
  #selection: string[] | undefined;
  /** Set while a mount puts the reader's selection back, which is no
   * change of the reader's to announce. */
  #restoring = false;
  /** Set while the element writes `open` from the machine, so the
   * attribute it just wrote does not open or close it again. */
  #reflecting = false;

  /** The mount's API while it is mounted. */
  get api(): unknown {
    return this.#mounted?.api;
  }

  /** The part this element marks for the mount above it, in place of
   * a mount of its own. */
  get #marker(): string | undefined {
    return (this.constructor as typeof MonoElement).definition.part;
  }

  connectedCallback(): void {
    this.#upgradeProperties();
    if (this.#marker) {
      this.publish();
      return;
    }
    this.#watch();
    if (this.#hasParts()) {
      this.#mount();
      return;
    }
    // The parser connects an element at its START tag, so its parts are
    // not there yet; every other way of filling one is caught by the
    // observer a microtask later.
    if (this.ownerDocument.readyState === "loading") {
      this.ownerDocument.addEventListener("DOMContentLoaded", this.#onParsed, { once: true });
    }
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener("DOMContentLoaded", this.#onParsed);
    this.#observer?.disconnect();
    this.#observer = null;
    this.#unmount();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (old === value || this.#reflecting) return;
    // A marker carries no mount of its own: what it publishes is read
    // once, so a change to it is the owner's to read again.
    if (this.#marker) {
      if (this.isConnected) this.#owner()?.remount();
      return;
    }
    if (!this.#mounted) return;
    // The id is the machine's, bound at the mount: a change re-roots it.
    if (name === "id") {
      this.#mount();
      return;
    }
    if (name === "open") {
      this.#setOpen(value !== null && value !== "false");
      return;
    }
    this.#mounted.updateProps(this.#propsOf(name, true));
  }

  /** Stop the mount and take its handlers off the parts. */
  destroy(): void {
    this.#unmount();
  }

  /** Mount again, for a change the subtree observer does not see —
   * a marker element's own attributes. */
  remount(): void {
    if (this.#mounted) this.#mount();
  }

  /** What a marker element hands the mount above it: its part marked
   * and its value named in the markup, and the props it carries. Null
   * on an element that mounts its own markup. */
  publish(): ElementProps | null {
    const part = this.#marker;
    if (!part) return null;
    this.dataset["part"] = part;
    const value = this.getAttribute("value");
    if (value !== null) this.dataset["value"] = value;
    return this.#props();
  }

  /** A prop no attribute carries — `ids`, `translations`, `navigate`,
   * `initialFocusEl`, `finalFocusEl`, a list's `collection`, `value`
   * and `defaultValue`, and `getRootNode`, which only this sets, the
   * DOM owning that name.
   * The rest are accessors too, so `element.ids = …` reaches here.
   * Unchanged is no change: React sets such a property on every
   * render, often a fresh array or object alike the last. */
  setProp(name: string, value: unknown): void {
    if (equalProps(this.#properties[name], value)) return;
    this.#properties[name] = value;
    this.#mounted?.updateProps({ [name]: value });
  }

  /** What `setProp` last set, if anything. */
  getProp(name: string): unknown {
    return this.#properties[name];
  }

  /** A property set before the element was defined is the instance's
   * own and hides the class's accessor, so it goes to `setProp` as
   * the accessor would send it. */
  #upgradeProperties(): void {
    const own = this.constructor as typeof MonoElement;
    const instance = this as unknown as Record<string, unknown>;
    for (const name of own.definition.properties ?? []) {
      if (!Object.hasOwn(this, name)) continue;
      const value = instance[name];
      delete instance[name];
      this.setProp(name, value);
    }
  }

  #onParsed = (): void => {
    if (this.isConnected && this.#hasParts()) this.#mount();
  };

  #hasParts(): boolean {
    return this.querySelector("[data-part]") !== null;
  }

  /** Whether the parts are the ones the mount was given. */
  #keepsParts(): boolean {
    const parts = this.querySelectorAll("[data-part]");
    if (parts.length !== this.#parts.length) return false;
    return this.#parts.every((part, index) => part === parts[index]);
  }

  /** Parts coming or going re-mount, a microtask after, so a framework
   * filling the element in one tick mounts once. A mount that writes
   * into its own markup changes no part, so it starts no loop. */
  #watch(): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => {
      if (this.#scheduled) return;
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (!this.isConnected || this.#keepsParts()) return;
        if (this.#hasParts()) this.#mount();
        else this.#unmount();
      });
    });
    this.#observer.observe(this, { childList: true, subtree: true });
  }

  /** Stop the mount, keeping the reader's selection and clearing the
   * `data-selected` markers it wrote, so a later mount reads only the
   * markers of items the page brings. */
  #unmount(): void {
    const value = (this.#mounted?.api as Partial<Selecting> | undefined)?.value;
    if (Array.isArray(value)) this.#selection = [...value];
    this.#mounted?.destroy();
    this.#mounted = null;
    for (const part of this.#parts) {
      if (part.getAttribute("data-part") === "item") part.removeAttribute("data-selected");
    }
    this.#parts = [];
  }

  #mount(): void {
    this.#unmount();
    const { mount } = (this.constructor as typeof MonoElement).definition;
    if (!mount) return;
    if (!this.id) this.id = `mono-ui-${++generated}`;
    const props = this.#props();
    // Items arriving marked are the page's new default, as an inserted
    // `<option selected>` is a native select's.
    const later = this.#initialValue !== undefined;
    const marked =
      later &&
      props["defaultValue"] === undefined &&
      this.querySelector("[data-part='item'][data-selected]") !== null;
    if (later && !marked) props["defaultValue"] = this.#initialValue;
    this.#mounted = mount(this, props);
    this.#parts = Array.from(this.querySelectorAll("[data-part]"));
    const api = this.#mounted.api as Partial<Selecting>;
    if (!Array.isArray(api.value)) return;
    if (!later || marked) this.#initialValue = [...api.value];
    else if (props["value"] === undefined) this.#restore(api as Selecting);
  }

  /** The reader's selection put back on a mount that started at the
   * page's default, Zag's reset target being the value a machine
   * starts at. Zag applies it a microtask on, and the callbacks it
   * fires there dispatch nothing. */
  #restore(api: Selecting): void {
    const selection = this.#selection;
    if (!selection || equalProps(selection, api.value)) return;
    this.#restoring = true;
    api.setValue(selection);
    queueMicrotask(() => {
      this.#restoring = false;
    });
  }

  /** The mount above this element, which roots the markup it marks. */
  #owner(): MonoElement | null {
    for (let node = this.parentElement; node; node = node.parentElement) {
      if (node instanceof MonoElement && !node.#marker) return node;
    }
    return null;
  }

  #setOpen(open: boolean): void {
    const api = this.#mounted?.api as { setOpen?: (open: boolean) => void } | undefined;
    api?.setOpen?.(open);
  }

  /** The props the mount takes: the id, every attribute by its kind,
   * the positioning four folded, the callbacks as events, `open` as
   * the initial state, and whatever was set as a property. */
  #props(): ElementProps {
    const own = this.constructor as typeof MonoElement;
    const props: ElementProps = { ...this.#properties };
    // A marker element has no id of its own: the mount above it makes
    // one under its own.
    if (this.id) props["id"] = this.id;
    for (const name of Object.keys(own.table)) Object.assign(props, this.#propsOf(name));
    if (this.hasAttribute("open")) props["defaultOpen"] = this.getAttribute("open") !== "false";
    for (const callback of own.definition.callbacks) {
      props[callback] = (detail: unknown) => this.#dispatch(callback, detail);
    }
    return props;
  }

  /** One attribute as the prop it carries; a positioning one as the
   * whole of `positioning`, the four being one prop. Absent, it says
   * nothing at the mount; after it (`cleared`), it is undefined, so the
   * prop it carried goes and the machine takes its default. */
  #propsOf(name: string, cleared = false): Record<string, unknown> {
    const own = this.constructor as typeof MonoElement;
    const kind = own.table[name];
    if (!kind) return {};
    if (name in POSITIONING) return { positioning: this.#positioning(cleared) };
    const value = this.#valueOf(name, kind);
    if (value === undefined && !cleared) return {};
    return { [own.definition.aliases?.[name] ?? camel(name)]: value };
  }

  /** Where the floating part goes, as the four attributes set it: the
   * two offsets under `offset`, the rest by their own names — each key
   * present where `cleared`, since a partial merges into the last. */
  #positioning(cleared = false): Record<string, unknown> {
    const own = this.constructor as typeof MonoElement;
    const positioning: Record<string, unknown> = cleared
      ? { placement: undefined, gutter: undefined, offset: undefined }
      : {};
    const offset: Record<string, unknown> = {};
    for (const [name, kind] of Object.entries(POSITIONING)) {
      if (!(name in own.table)) continue;
      const value = this.#valueOf(name, kind);
      if (value === undefined) continue;
      if (name === "offset-main-axis") offset["mainAxis"] = value;
      else if (name === "offset-cross-axis") offset["crossAxis"] = value;
      else positioning[camel(name)] = value;
    }
    if (Object.keys(offset).length > 0) positioning["offset"] = offset;
    return positioning;
  }

  #valueOf(name: string, kind: Kind): unknown {
    if (kind === "boolean") {
      return this.hasAttribute(name) ? this.getAttribute(name) !== "false" : undefined;
    }
    const raw = this.getAttribute(name);
    if (raw === null) return undefined;
    return kind === "number" ? Number(raw) : raw;
  }

  /** A callback as a bubbling event, its argument the `detail`; where
   * the argument carries a `preventDefault`, cancelling calls it.
   * `open` is written first, so a listener reads the state the event
   * announces. */
  #dispatch(callback: string, detail: unknown): void {
    if (callback === "onOpenChange") this.#reflectOpen(detail);
    if (this.#restoring) return;
    const name = eventNameOf(callback);
    const cancelable =
      typeof (detail as { preventDefault?: unknown })?.preventDefault === "function";
    const event = new CustomEvent(name, { detail, bubbles: true, cancelable });
    this.dispatchEvent(event);
    if (event.defaultPrevented && cancelable) {
      (detail as { preventDefault: () => void }).preventDefault();
    }
  }

  /** `open` written from the machine, and only where its presence
   * differs from the state, so neither direction loops. */
  #reflectOpen(detail: unknown): void {
    const open = (detail as { open?: boolean } | undefined)?.open;
    if (typeof open !== "boolean" || open === this.hasAttribute("open")) return;
    this.#reflecting = true;
    if (open) this.setAttribute("open", "");
    else this.removeAttribute("open");
    this.#reflecting = false;
  }
}
