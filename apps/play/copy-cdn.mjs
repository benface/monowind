/**
 * Copy the built CDN and sort bundles next to index.html — a plain
 * relative script URL can't reach outside the served directory, and this
 * also mirrors how the files are consumed in the real world (URLs, not
 * monorepo paths).
 */
import { copyFileSync, cpSync } from "node:fs";

for (const file of ["cdn.js", "cdn.js.map", "sort.js", "sort.js.map"]) {
  copyFileSync(
    new URL(`../../packages/core/dist/${file}`, import.meta.url),
    new URL(`./${file}`, import.meta.url),
  );
}
for (const file of ["cdn.js", "cdn.js.map"]) {
  copyFileSync(
    new URL(`../../packages/ascii/dist/${file}`, import.meta.url),
    new URL(`./ascii-${file}`, import.meta.url),
  );
}
// Theme css + their woff fonts (class-scoped; the switcher toggles
// classes on the preview host).
cpSync(
  new URL("../../packages/themes/themes", import.meta.url),
  new URL("./themes", import.meta.url),
  {
    recursive: true,
  },
);
cpSync(
  new URL("../../packages/themes/fonts", import.meta.url),
  new URL("./fonts", import.meta.url),
  {
    recursive: true,
    filter: (source) => !source.includes("LICENSES"),
  },
);
// The full font catalog, for loadFont's same-origin path (typing
// font="slant" in the playground lazy-loads it).
cpSync(
  new URL("../../packages/ascii/fonts", import.meta.url),
  new URL("./fonts", import.meta.url),
  {
    recursive: true,
    filter: (source) => !source.includes("LICENSES"),
  },
);
