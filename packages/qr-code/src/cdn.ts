/**
 * CDN entry — a classic script loaded NEXT TO monowind's own cdn.js:
 *
 *   <script src=".../monowind/dist/cdn.js"></script>
 *   <script src=".../@monowind/qr-code/dist/cdn.js"></script>
 *
 * Registers <mono-qr>, injects the companion styles, and merges its
 * version into the shared `monowind` global.
 */
import "./index.ts";
import { encode, renderQr } from "./render.ts";
import companionCss from "./styles.css?inline";

const style = document.createElement("style");
style.setAttribute("data-monowind-qr", "");
style.textContent = companionCss;
document.head.appendChild(style);

// Injected by vite.cdn.config.ts from package.json.
declare const __MONOWIND_QR_VERSION__: string;

// Merge, not replace — core's cdn.js and the other companions share the global.
const existing = (globalThis as { monowind?: { qr?: object } }).monowind;
Object.assign(globalThis, {
  monowind: {
    ...existing,
    qr: { ...existing?.qr, encode, renderQr, version: __MONOWIND_QR_VERSION__ },
  },
});
