import { createSignal, For } from "solid-js";
import { collection } from "@monowind/ui/select";
import { defineMonoUi } from "@monowind/ui/elements";

/**
 * Solid owns the light DOM (fine-grained signal updates, no VDOM diffing);
 * monowind reads it and lays it out on the character grid. The counter
 * proves the whole loop: click → the signal rewrites the text node →
 * monowind observes the mutation → relayout, without Solid ever noticing
 * the engine. (Solid 2.0: writes batch on a microtask.)
 *
 * The components come as `<mono-*>` elements, which any framework
 * renders as markup: attributes are the machine's props and events its
 * callbacks. Solid needs no bindings of its own, and has none —
 * `@zag-js/solid` reaches `solid-js/web`, which Solid 2 no longer
 * exports (chakra-ui/zag#3211).
 */
defineMonoUi();

const ITEM =
  "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500";

const branches = collection({ items: ["main", "next", "release"] });

export function App() {
  const [count, setCount] = createSignal(0);
  const [picked, setPicked] = createSignal("nothing yet");

  // A collection is a prop no attribute can carry, so it is set as
  // one, on the element Solid hands back.
  const holdCollection = (element: HTMLElement) => {
    (element as HTMLElement & { collection?: unknown }).collection = branches;
  };

  // An element's callbacks are events. Solid's `on:` namespace would
  // say it, but this 2.0 RC compiles `on:itemselect` to a listener
  // for ":itemselect", so the listener goes on by hand.
  const onSelect = (element: HTMLElement) => {
    element.addEventListener("itemselect", (event) => {
      setPicked((event as CustomEvent<{ value: string }>).detail.value);
    });
  };

  return (
    <mono-wind>
      <div class="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
        <div>
          count is <b class="text-yellow-400">{count()}</b>
        </div>
        <button class="cursor-pointer" onClick={() => setCount((n) => n + 1)}>
          increment
        </button>
      </div>
      <div class="mt-1 flex items-center gap-2">
        <mono-menu ref={onSelect} placement="bottom-start">
          <button data-part="trigger" class="border px-1">
            File
          </button>
          <div data-part="positioner" popover="manual">
            <div data-part="content" class="border bg-clear">
              <div data-part="item" data-value="new" class={ITEM}>
                New
              </div>
              <div data-part="item" data-value="open" class={ITEM}>
                Open…
              </div>
              <div data-part="trigger-item" class={ITEM}>
                Share ›
              </div>
              <mono-submenu value="share">
                <div data-part="positioner" popover="manual">
                  <div data-part="content" class="border bg-clear">
                    <div data-part="item" data-value="mail" class={ITEM}>
                      Mail
                    </div>
                  </div>
                </div>
              </mono-submenu>
            </div>
          </div>
        </mono-menu>
        <mono-dialog>
          <button data-part="trigger" class="border px-1">
            Delete
          </button>
          <div data-part="positioner" class="backdrop:bg-black/50">
            <div data-part="content" class="border px-1">
              <p data-part="title" class="font-bold">
                Delete the file?
              </p>
              <p data-part="description">This cannot be undone.</p>
              <p class="mt-1">
                <button data-part="close-trigger" class="border px-1">
                  Cancel
                </button>
              </p>
            </div>
          </div>
        </mono-dialog>
        <mono-select ref={holdCollection} name="branch">
          <div data-part="control">
            <button data-part="trigger" class="border px-1">
              <span data-part="value-text">branch…</span>
              <span data-part="indicator" class="ml-1">
                ▼
              </span>
            </button>
          </div>
          <div data-part="positioner" popover="manual">
            <div data-part="content" class="border bg-clear">
              <For each={branches.items}>
                {(value) => (
                  <div data-part="item" data-value={value} class={ITEM}>
                    <span data-part="item-text">{value}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
          <select data-part="hidden-select" />
        </mono-select>
        <span>
          picked <b class="text-yellow-400">{picked()}</b>
        </span>
      </div>
      <For each={[1, 2, 3, 4, 5, 6]}>{(i) => <p>Line {i} of the page, under the menu.</p>}</For>
    </mono-wind>
  );
}
