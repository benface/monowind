/**
 * CDN entry point — the "Play CDN" experience, like Tailwind's:
 *
 *   <script src="https://unpkg.com/monowind/dist/cdn.js"></script>
 *
 * One classic script tag, no build step. Bundles:
 * - `@tailwindcss/browser` (compiles Tailwind classes in the browser at
 *   runtime, watching the DOM),
 * - the monowind companion stylesheet (injected into <head>) and the
 *   rule-* utilities as Tailwind source for the in-browser compiler,
 * - the engine, with <mono-wind> registered immediately.
 */
import "@tailwindcss/browser";
import { invalidateLeaves, registerLeafRenderer } from "./leaf.ts";
import { defineMonoWind } from "./element.ts";
import rulesCss from "./rules.css?inline";
import companionCss from "./styles.css?inline";
import variantsCss from "./variants.css?inline";

const style = document.createElement("style");
style.setAttribute("data-monowind", "");
style.textContent = companionCss;
document.head.appendChild(style);

// The rule-* utilities and pointer-state variants are Tailwind source:
// the plain tag above leaves @utility/@custom-variant inert, so hand
// them to the in-browser compiler separately.
const rules = document.createElement("style");
rules.setAttribute("type", "text/tailwindcss");
rules.setAttribute("data-monowind-rules", "");
rules.textContent = `${rulesCss}\n${variantsCss}`;
document.head.appendChild(rules);

defineMonoWind();

// Injected by vite.cdn.config.ts from packages/core/package.json.
declare const __MONOWIND_VERSION__: string;

// Merge, not replace — dist/sort.js (the optional class-order
// companion, see src/sort.ts) and @monowind/ascii's cdn.js contribute
// to the same global. The public extension API rides along so sibling
// CDN bundles (built with `monowind` external → this global) share
// the engine's registries instead of bundling a second copy.
Object.assign(globalThis, {
  monowind: {
    ...(globalThis as { monowind?: object }).monowind,
    version: __MONOWIND_VERSION__,
    registerLeafRenderer,
    invalidateLeaves,
  },
});
