/** A tick past Zag's deferred sends and the mount's first spread. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A root's marked part, by value where several carry the part. */
export const by = (root: Element, part: string, value?: string) =>
  root.querySelector<HTMLElement>(
    value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
  )!;

interface Animated {
  finished: Promise<void>;
  playState: string;
  effect: { getComputedTiming(): { endTime: number } };
  end(): void;
}

/** The popover API on an element, where the DOM has none: shown and
 * hidden as the platform would, a wrong-state call throwing as it does,
 * with the animations under it stubbed. */
export function popoverApi(element: HTMLElement) {
  let open = false;
  const animations: Animated[] = [];
  const wrongState = (state: string) =>
    new DOMException(`The popover is already ${state}.`, "InvalidStateError");
  Object.assign(element, {
    showPopover: () => {
      if (open) throw wrongState("shown");
      open = true;
    },
    hidePopover: () => {
      if (!open) throw wrongState("hidden");
      open = false;
    },
    matches: (selector: string) => selector === ":popover-open" && open,
    getAnimations: () => animations,
  });
  return {
    element,
    isOpen: () => open,
    /** An animation under the element, running to its end unless told
     * otherwise. */
    animate: ({ endTime = 300, playState = "running" } = {}) => {
      let end!: () => void;
      const finished = new Promise<void>((resolve) => (end = resolve));
      animations.push({
        finished,
        playState,
        effect: { getComputedTiming: () => ({ endTime }) },
        end,
      });
    },
    end: () => {
      for (const animation of animations.splice(0)) animation.end();
    },
  };
}
