/**
 * Copy the built CDN and sort bundles next to index.html — a plain
 * relative script URL can't reach outside the served directory, and this
 * also mirrors how the files are consumed in the real world (URLs, not
 * monorepo paths).
 */
import { copyFileSync } from "node:fs";

for (const file of ["cdn.js", "cdn.js.map", "sort.js", "sort.js.map"]) {
  copyFileSync(
    new URL(`../../packages/core/dist/${file}`, import.meta.url),
    new URL(`./${file}`, import.meta.url),
  );
}
