import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A tick past Zag's deferred sends and the mount's first spread. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A form's reset as a browser runs it from a reader's click: the
 * event, the microtasks it queued (a framework's render among them,
 * inside `within` — React's `act`), then each option back to its
 * `selected` attribute, a one-row single control picking its first
 * where none has it. happy-dom's own `reset()` restores the controls
 * before the event, and picks that first option whatever the size. */
export async function resetByClick(
  form: HTMLFormElement,
  within: (work: () => Promise<void>) => Promise<void> = (work) => work(),
): Promise<void> {
  const event = new Event("reset", { bubbles: true, cancelable: true });
  await within(async () => {
    form.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve));
  });
  if (event.defaultPrevented) return;
  for (const control of form.querySelectorAll("select")) {
    for (const option of control.options) option.selected = option.hasAttribute("selected");
  }
}

/** What a browser's form submits for a select — the control, or the
 * one inside an element: its selected options, where happy-dom's
 * `FormData` posts the control's `value` as one entry, even with none
 * selected, and its `selectedOptions` can lag a change. */
export function posted(within: Element): string[] {
  const select = within instanceof HTMLSelectElement ? within : within.querySelector("select")!;
  return [...select.options].filter((option) => option.selected).map((option) => option.value);
}

/** A root's marked part, by value where several carry the part. */
export const by = (root: Element, part: string, value?: string) =>
  root.querySelector<HTMLElement>(
    value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
  )!;

/** A key pressed on a mount's content, and whether Zag took it. */
export function press(root: Element, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  by(root, "content").dispatchEvent(event);
  return event.defaultPrevented;
}

/** The modality Zag reads, as the reader's own input sets it: a
 * component shows a keyboard focus and leaves a pointer's scroll be. */
export const fromKeyboard = (): void => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
};
export const fromPointer = (): void => {
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
};

/** A pointer moving onto an element, as a mouse makes it. */
export const hover = (element: Element): void => {
  element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
};

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

/** The components of `names` that no other test in an adapter's test
 * directory renders, as `rendered` spots one in their source: a part
 * nothing instantiates is a part nothing type-checks or runs. */
export function unrendered(
  directory: string,
  names: readonly string[],
  rendered: (name: string) => RegExp,
): string {
  const source = readdirSync(directory)
    .filter((file) => /\.(tsx?|vue|svelte)$/.test(file) && file !== "coverage.test.ts")
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .join("\n");
  return names.filter((name) => !rendered(name).test(source)).join(", ");
}
