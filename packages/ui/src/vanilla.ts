import type { Machine, MachineSchema, Service } from "@zag-js/core";
import { VanillaMachine, spreadProps } from "@zag-js/vanilla";
import { syncTopLayer, type Anchored } from "./top-layer.ts";

/** A component mounted on markup: its API, live, a way to change the
 * props it was mounted on, and a `destroy` that stops its machine and
 * takes its handlers off the parts. */
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

/** A plain object, which a partial merges into a level deep. A class
 * instance is not one: spread into a literal, a Zag collection keeps
 * its items and loses the accessors the machine navigates by. */
const isPlain = (value: unknown): value is Record<string, unknown> => {
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

/** The nearest submenu root above an element, null outside any. */
const submenuOf = (element: Element): Element | null =>
  element.parentElement?.closest("[data-part='submenu']") ?? null;

/** The root's own elements of a part: those under it and under none of
 * its submenus, which are roots of their own. */
export function parts(root: Element, name: string): HTMLElement[] {
  const own = root.closest("[data-part='submenu']");
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)).filter(
    (element) => submenuOf(element) === own,
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
/** What a trigger takes of its own: a menu names one of several by
 * value, a combobox says whether its one takes focus. Both are
 * optional, and a component ignores what it does not read. */
interface TriggerOptions {
  value?: string | undefined;
  focusable?: boolean | undefined;
}

interface CommonApi extends Anchored {
  getTriggerProps(props?: TriggerOptions): object;
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

/** A machine whose changes a mount follows. */
interface Followed {
  subscribe(listener: () => void): () => void;
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
  linked: Iterable<Followed> = [],
  live?: LiveProps<Partial<T["props"]>>,
): Mounted<A> {
  // Zag declares this one private and defines it on the instance.
  const notify = (machine as unknown as { notify?: () => void }).notify;
  let current = connect(machine.service);
  let stopped = false;
  let unwire: (() => void)[] = [];
  const spread: Spread = (element, props) => {
    if (element) unwire.push(spreadProps(element, props as Record<string, unknown>));
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
      if (!live) return;
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
      for (const cleanup of unwire) cleanup();
      machine.stop();
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
  wire?: (api: A, spread: Spread) => void,
  linked: Iterable<Followed> = [],
  live?: LiveProps<Partial<T["props"]>>,
): Mounted<A> {
  const triggers = parts(root, "trigger");
  const positioner = part(root, "positioner");
  const content = part(root, "content");
  const mounted = mount(
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
    linked,
    live,
  );
  return {
    get api() {
      return mounted.api;
    },
    updateProps(partial) {
      mounted.updateProps(partial);
    },
    destroy() {
      mounted.destroy();
      syncTopLayer(positioner, false);
    },
  };
}
