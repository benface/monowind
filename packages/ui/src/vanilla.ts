import type { Machine, MachineSchema, Service } from "@zag-js/core";
import { VanillaMachine, spreadProps } from "@zag-js/vanilla";
import { syncTopLayer, type Anchored } from "./top-layer.ts";

/** A component mounted on markup: its API, live, and a `destroy` that
 * stops its machine and takes its handlers off the parts. */
export interface Mounted<A> {
  readonly api: A;
  destroy(): void;
}

/** A machine started on its props. */
export function start<T extends MachineSchema>(
  machine: Machine<T>,
  props: Partial<T["props"]>,
): VanillaMachine<T> {
  const started = new VanillaMachine(machine, props);
  started.start();
  return started;
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
interface CommonApi extends Anchored {
  getTriggerProps(props?: { value?: string | undefined }): object;
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
): Mounted<A> {
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
  );
  return {
    get api() {
      return mounted.api;
    },
    destroy() {
      mounted.destroy();
      syncTopLayer(positioner, false);
    },
  };
}
