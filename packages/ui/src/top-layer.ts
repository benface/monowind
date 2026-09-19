import type { Machine, MachineSchema, Service } from "@zag-js/core";

/** What every component's API gives a framework package: its open
 * state and the positioner's props. */
export interface Anchored {
  readonly open: boolean;
  getPositionerProps(): object;
}

/** One of this package's entries as a framework package takes it: Zag's
 * machine, the props as the machine takes them, and Zag's API with the
 * grid's props for the adapter's `normalizeProps` (`N`), typed as the
 * framework package writes it (`A`), an erased generic `connect` naming
 * none. */
export interface Component<
  T extends MachineSchema,
  P,
  G extends Partial<T["props"]>,
  N,
  A extends Anchored,
> {
  machine: Machine<T>;
  props(machineProps: P): G;
  connect(service: Service<T>, normalize: N, gridProps: G): NoInfer<A>;
}

/** The hide each positioner waits on; a newer show or hide supersedes it. */
const pending = new WeakMap<Element, number>();

/** Whether the element is an open popover; a DOM without the
 * pseudo-class says no. */
function isShown(element: Element): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

/** Whether an animation ends on its own — running (a pending one
 * reports so) toward a finite end: an exit. One that spins forever, a
 * decoration, or one paused would otherwise hold the positioner shown. */
function ends(animation: Animation): boolean {
  if (animation.playState !== "running") return false;
  return Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity);
}

/** The positioner's place in the top layer follows the machine
 * (specs/ui.md): shown as it opens, hidden once the exit's animations
 * have finished — a connected element with the popover API. */
export function syncTopLayer(element: Element | null | undefined, open: boolean): void {
  if (!element?.isConnected || !("showPopover" in element)) return;
  const positioner = element as HTMLElement;
  const token = (pending.get(positioner) ?? 0) + 1;
  pending.set(positioner, token);
  if (open) {
    if (!isShown(positioner)) positioner.showPopover();
    return;
  }
  if (!isShown(positioner)) return;
  // The focus leaves at once: a machine placing it next (a submenu's
  // parent) asks where it is, before the browser's fixup.
  const focused = positioner.ownerDocument.activeElement;
  if (focused instanceof HTMLElement && positioner.contains(focused)) focused.blur();
  const hide = (): void => {
    if (pending.get(positioner) === token && isShown(positioner)) positioner.hidePopover();
  };
  const exits = positioner.getAnimations({ subtree: true }).filter(ends);
  if (exits.length === 0) hide();
  else void Promise.allSettled(exits.map((animation) => animation.finished)).then(hide);
}
