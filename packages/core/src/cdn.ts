/**
 * CDN entry point — the "Play CDN" experience, like Tailwind's:
 *
 *   <script src="https://unpkg.com/monowind/dist/cdn.js"></script>
 *
 * One classic script tag, no build step. Bundles:
 * - `@tailwindcss/browser` (compiles Tailwind classes in the browser at
 *   runtime, watching the DOM),
 * - the monowind companion stylesheet (injected into <head>),
 * - the engine, with <mono-wind> registered immediately.
 */
import "@tailwindcss/browser";
import { defineMonoWind } from "./element.ts";
import companionCss from "./styles.css?inline";

const style = document.createElement("style");
style.setAttribute("data-monowind", "");
style.textContent = companionCss;
document.head.appendChild(style);

defineMonoWind();
