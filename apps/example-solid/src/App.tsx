import { createSignal } from "solid-js";

/**
 * Solid owns the light DOM (fine-grained signal updates, no VDOM diffing);
 * monowind reads it and lays it out on the character grid. The counter
 * proves the whole loop: click → the signal rewrites the text node →
 * monowind observes the mutation → relayout, without Solid ever noticing
 * the engine. (Solid 2.0: writes batch on a microtask.)
 */
export function App() {
  const [count, setCount] = createSignal(0);

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
    </mono-wind>
  );
}
