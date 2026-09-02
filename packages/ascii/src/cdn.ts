/**
 * CDN entry — a classic script loaded NEXT TO monowind's own cdn.js:
 *
 *   <script src=".../monowind/dist/cdn.js"></script>
 *   <script src=".../@monowind/ascii/dist/cdn.js"></script>
 *
 * Registers <mono-ascii> with the default fonts, injects the companion
 * styles (--mw-ansi-* tokens), and merges the API into the shared
 * `monowind` global — `monowind.ascii.loadFont(name)` lazily fetches
 * any bundled font (same-origin `fonts/` first, then the published
 * package via jsdelivr).
 */
import { onUnknownAsciiFont } from "./index.ts";
import { asciiFont, registerAsciiFont } from "./registry.ts";
import companionCss from "./styles.css?inline";

const style = document.createElement("style");
style.setAttribute("data-monowind-ascii", "");
style.textContent = companionCss;
document.head.appendChild(style);

// Injected by vite.cdn.config.ts from package.json.
declare const __MONOWIND_ASCII_VERSION__: string;

/** Fetch a bundled font by name from the published package (raw
 * `fonts/` files ship in the tarball) and register it. Resolves to
 * the font, or null when no such font ships. */
const loading = new Map<string, Promise<unknown>>();

function loadFont(name: string): Promise<unknown> {
  const slug = name.toLowerCase().replace(/\.(flf|tlf)$/, "");
  const pending = loading.get(slug);
  if (pending) return pending;
  const promise = fetchFont(slug).finally(() => loading.delete(slug));
  loading.set(slug, promise);
  return promise;
}

async function fetchFont(slug: string): Promise<unknown> {
  const existing = asciiFont(slug);
  if (existing) return existing;
  // Same-origin `fonts/` first (a site can ship the fonts directory,
  // as the playground does), then the published package via jsdelivr.
  const bases = [
    "fonts/",
    `https://cdn.jsdelivr.net/npm/@monowind/ascii@${__MONOWIND_ASCII_VERSION__}/fonts/`,
  ];
  for (const base of bases) {
    for (const extension of ["flf", "tlf"]) {
      try {
        const response = await fetch(`${base}${slug}.${extension}`);
        if (response.ok) return registerAsciiFont(slug, await response.text());
      } catch {
        // Network/origin errors: try the next candidate.
      }
    }
  }
  console.warn(`[monowind] loadFont("${slug}"): no such bundled font.`);
  return null;
}

// A `font` attribute naming an unbundled-but-published font lazy-loads
// it — in the playground, typing font="slant" just works.
onUnknownAsciiFont((name) => void loadFont(name));

// Merge, not replace — core's cdn.js (and sort.js) share the global.
const existing = (globalThis as { monowind?: { ascii?: object } }).monowind;
Object.assign(globalThis, {
  monowind: {
    ...existing,
    ascii: {
      ...existing?.ascii,
      asciiFont,
      loadFont,
      registerAsciiFont,
      version: __MONOWIND_ASCII_VERSION__,
    },
  },
});
