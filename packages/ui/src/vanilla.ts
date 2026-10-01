import type { Machine, MachineSchema, Service } from "@zag-js/core";
import { VanillaMachine, spreadProps } from "@zag-js/vanilla";
import type { TriggerApi } from "./framework.ts";
import { syncTopLayer, type Anchored } from "./top-layer.ts";

/** A component mounted on markup: its API, live, a way to change the
 * props it was mounted on, and a `destroy` that stops its machine,
 * takes its handlers off the parts and puts back what it wrote. */
export interface Mounted<A> {
  readonly api: A;
  /** Merge a partial into the props the machine and the API read, and
   * spread the parts again from them. */
  updateProps(partial: object): void;
  destroy(): void;
}

/** A machine started on its props, which it may read per render. */
export function start<T extends MachineSchema>(
  machine: Machine<T>,
  props: Partial<T["props"]> | (() => Partial<T["props"]>),
): VanillaMachine<T> {
  const started = new VanillaMachine(machine, props);
  started.start();
  return started;
}

/** A plain object, which a partial merges into a level deep and an
 * element compares by its entries. A class instance is not one:
 * spread into a literal, a Zag collection keeps its items and loses
 * the accessors the machine navigates by. */
export const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** A partial over props, merged as Zag's own `updateProps` merges one:
 * a level deep, so `{ positioning: { placement } }` leaves the rest of
 * `positioning` alone. */
export function mergePartial<P extends object>(base: P, partial: object): P {
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    const had = merged[key];
    merged[key] = isPlain(had) && isPlain(value) ? { ...had, ...value } : value;
  }
  return merged as P;
}

/** The props a mount reads: the authored ones a partial merges into,
 * and what the machine and the API take from them, re-derived on every
 * change so the next spread sees it. */
export interface LiveProps<G> {
  readonly machine: G;
  update(partial: object): void;
}

export function liveProps<P extends object, G>(authored: P, derive: (props: P) => G): LiveProps<G> {
  let current = authored;
  let derived = derive(current);
  return {
    get machine() {
      return derived;
    },
    update(partial) {
      current = mergePartial(current, partial);
      derived = derive(current);
    },
  };
}

/** On the class of every element `defineElement` makes: a root of its
 * own, whose parts no component around it takes. */
export const ROOT: unique symbol = Symbol("monowind root");

/** A root nested under another: a submenu's, one a page nesting
 * components by script marks `data-part="root"`, or an element's. */
function isRoot(element: Element): boolean {
  const part = element.getAttribute("data-part");
  if (part === "submenu" || part === "root") return true;
  return ROOT in (customElements.get(element.localName) ?? {});
}

/** The root's own elements of a part: those it is the nearest root
 * above, none nested in it (`isRoot`) standing between. */
export function parts(root: Element, name: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)).filter(
    (element) => {
      let above = element.parentElement;
      while (above !== root && above !== null && !isRoot(above)) above = above.parentElement;
      return above === root;
    },
  );
}

/** The root's one element of a part, if marked. */
export function part(root: Element, name: string): HTMLElement | undefined {
  return parts(root, name)[0];
}

/** Zag's props onto a part, if the markup has it. */
export type Spread = (element: Element | undefined, props: object) => void;

/** What an anchored component's API gives its mount past `Anchored`:
 * the props of its triggers — a menu's each by value — and its
 * content. */
interface CommonApi extends Anchored, TriggerApi {
  getContentProps(): object;
}

/** What a popover's and a dialog's API gives their three parts past
 * those. */
interface TitledApi {
  getTitleProps(): object;
  getDescriptionProps(): object;
  getCloseTriggerProps(): object;
}

/** The parts a popover and a dialog share past the three every anchored
 * component has — `title`, `description`, `close-trigger` — found once,
 * wired on each render. */
export function titledParts<A extends TitledApi>(root: Element): (api: A, spread: Spread) => void {
  const title = part(root, "title");
  const description = part(root, "description");
  const closeTrigger = part(root, "close-trigger");
  return (api, spread) => {
    spread(title, api.getTitleProps());
    spread(description, api.getDescriptionProps());
    spread(closeTrigger, api.getCloseTriggerProps());
  };
}

/** What a part held before a mount first wrote it — its attributes,
 * its inline style's properties, whether it had a style at all — and
 * the props the mount last spread on it. */
interface Original {
  attributes: Map<string, string | null>;
  styles: Map<string, [value: string, priority: string]>;
  styled: boolean;
  last: Record<string, unknown>;
}

/** What the reader chose, which outlives the mount as they left it: the
 * values Zag's spread assigns to a control, and the markers a mount
 * again reads off an item — a list's selection, an accordion's open
 * items (specs/ui.md). */
const ASSIGNED = new Set(["value", "checked", "selected"]);
const MARKERS = new Set(["data-selected", "data-state"]);

/** A style key as the CSS property Zag's spread sets. */
const cssName = (key: string): string =>
  key.startsWith("--") ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The attribute Zag's spread leaves for a prop's value, null for none. */
const writtenOf = (name: string, value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "boolean" && !name.startsWith("aria-")) return value ? "" : null;
  return String(value);
};

/** What the spread of `props` is about to write on `element`, as the
 * markup holds it, the first time a mount writes it; Zag writes no
 * null value. */
function remember(originals: Map<Element, Original>, element: Element, props: object): void {
  let original = originals.get(element);
  if (!original) {
    original = {
      attributes: new Map(),
      styles: new Map(),
      styled: element.hasAttribute("style"),
      last: {},
    };
    originals.set(element, original);
  }
  const item = element.getAttribute("data-part") === "item";
  for (const [key, value] of Object.entries(props)) {
    if (value == null || key.startsWith("on") || ASSIGNED.has(key)) continue;
    if (key === "style" && typeof value === "object") {
      const { style } = element as HTMLElement;
      for (const [property, written] of Object.entries(value)) {
        const name = cssName(property);
        if (written == null || original.styles.has(name)) continue;
        original.styles.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
      }
    } else if (!(item && MARKERS.has(key)) && !original.attributes.has(key)) {
      original.attributes.set(key, element.getAttribute(key));
    }
  }
  original.last = props as Record<string, unknown>;
}

/** The parts as the markup held them before the mount, but for an
 * attribute the page changed since the mount's last spread, which is
 * the page's; the inline styles the mount wrote are its own. */
function restore(originals: Map<Element, Original>): void {
  for (const [element, { attributes, styles, styled, last }] of originals) {
    for (const [name, value] of attributes) {
      if (element.getAttribute(name) !== writtenOf(name, last[name])) continue;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    const { style } = element as HTMLElement;
    for (const [name, [value, priority]] of styles) {
      if (value === "") style.removeProperty(name);
      else style.setProperty(name, value, priority);
    }
    if (!styled && style?.length === 0) element.removeAttribute("style");
  }
}

/** A machine whose changes a mount follows. */
interface Followed {
  subscribe(listener: () => void): () => void;
}

/** What a mount follows past its own machine — a menu's submenus —
 * and what it runs last at the destroy. */
interface MountOptions {
  linked?: Iterable<Followed>;
  cleanup?: () => void;
}

/** A started machine mounted on its markup (specs/ui.md): the API
 * connected and spread onto the parts — found once by the caller's
 * `wire`, Zag's spread rewriting a trigger item's `data-part` — on
 * every change of its own or a linked machine's (its mount subscribed
 * first, its API fresh here), first a microtask after the mount, past
 * the vanilla machine's deferred sends. */
export function mount<T extends MachineSchema, A>(
  machine: VanillaMachine<T>,
  connect: (service: Service<T>) => A,
  wire: (api: A, spread: Spread) => void,
  live: LiveProps<Partial<T["props"]>>,
  { linked = [], cleanup }: MountOptions = {},
): Mounted<A> {
  // Zag declares this one private and defines it on the instance.
  const notify = (machine as unknown as { notify?: () => void }).notify;
  let current = connect(machine.service);
  let stopped = false;
  let unwire: (() => void)[] = [];
  const originals = new Map<Element, Original>();
  const spread: Spread = (element, props) => {
    if (!element) return;
    remember(originals, element, props);
    unwire.push(spreadProps(element, props as Record<string, unknown>));
  };
  const render = (): void => {
    if (stopped) return;
    current = connect(machine.service);
    unwire = [];
    wire(current, spread);
  };
  const followed: Followed[] = [machine, ...linked];
  const unsubscribes = followed.map((source) => source.subscribe(render));
  queueMicrotask(render);
  return {
    get api() {
      return current;
    },
    updateProps(partial) {
      live.update(partial);
      // The machine reads its props from the getter it was started
      // on, so only its watchers are owed the news, and `notify` is
      // that. Zag's public `updateProps` wraps the props source per
      // call, which a combobox filtering per keystroke pays for
      // quadratically, so it is the fallback rather than the way.
      // Either publishes, and the subscription below renders.
      if (notify) notify();
      else machine.updateProps(partial);
    },
    destroy() {
      stopped = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      for (const unspread of unwire) unspread();
      machine.stop();
      cleanup?.();
      restore(originals);
    },
  };
}

/** A mount whose floating part is the top layer's: the triggers, the
 * positioner, and the content spread as every anchored component's,
 * the positioner shown while the machine is open and hidden once its
 * exit has played, at the destroy too. */
export function mountAnchored<T extends MachineSchema, A extends CommonApi>(
  root: Element,
  machine: VanillaMachine<T>,
  connect: (service: Service<T>) => A,
  wire: ((api: A, spread: Spread) => void) | undefined,
  live: LiveProps<Partial<T["props"]>>,
  options: MountOptions = {},
): Mounted<A> {
  const triggers = parts(root, "trigger");
  const positioner = part(root, "positioner");
  const content = part(root, "content");
  return mount(
    machine,
    connect,
    (api, spread) => {
      for (const trigger of triggers) {
        spread(trigger, api.getTriggerProps({ value: trigger.dataset["value"] }));
      }
      spread(positioner, api.getPositionerProps());
      spread(content, api.getContentProps());
      wire?.(api, spread);
      syncTopLayer(positioner, api.open);
    },
    live,
    {
      ...options,
      cleanup: () => {
        syncTopLayer(positioner, false);
        options.cleanup?.();
      },
    },
  );
}
