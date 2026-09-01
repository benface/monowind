/**
 * Optional companion to the CDN bundle: canonical Tailwind class
 * ordering (the order prettier-plugin-tailwindcss produces), exposed as
 * `globalThis.monowind.sortClasses` for tools like the playground's
 * Tidy. A separate file because it needs the `tailwindcss` library (the
 * design system), which would grow cdn.js by ~70% for a feature most
 * consumers never call:
 *
 *   <script src="https://unpkg.com/monowind/dist/cdn.js"></script>
 *   <script src="https://unpkg.com/monowind/dist/sort.js"></script>
 */
import { __unstable__loadDesignSystem } from "tailwindcss";
import themeCss from "tailwindcss/theme.css?raw";
import rulesCss from "./rules.css?inline";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
let designSystem: DesignSystem | null = null;
// Include rules.css so its @utility declarations (rule-*, rule-x-*,
// rule-y-*) register with the design system — otherwise the sorter
// treats them as unknown and floats them to the front. Sorting is a
// no-op for the few ms until the load resolves.
void __unstable__loadDesignSystem(`${themeCss}\n${rulesCss}`).then((loaded) => {
  designSystem = loaded;
});

function sortClasses(value: string): string {
  const names = value.split(/\s+/).filter(Boolean);
  if (!designSystem || names.length < 2) return names.join(" ");
  // Unknown classes (null order) sort first; sort is stable (guaranteed
  // since ES2019), so ties keep their authored order.
  return designSystem
    .getClassOrder(names)
    .sort(([, a], [, b]) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1))
    .map(([name]) => name)
    .join(" ");
}

// Merge, not replace — load order relative to cdn.js must not matter.
Object.assign(globalThis, {
  monowind: { ...(globalThis as { monowind?: object }).monowind, sortClasses },
});
