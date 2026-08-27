import { useState } from "react";

/**
 * React owns the light DOM (state, events, reconciliation); monowind reads
 * it and lays it out on the character grid. The counter proves the whole
 * loop: click → React re-renders the text → monowind observes the mutation
 * → relayout, without React ever noticing the engine.
 */
export function App() {
  const [count, setCount] = useState(0);

  return (
    <mono-wind>
      <div className="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
        <div>
          count is <b className="text-yellow-400">{count}</b>
        </div>
        <button className="cursor-pointer" onClick={() => setCount((n) => n + 1)}>
          increment
        </button>
      </div>
    </mono-wind>
  );
}
