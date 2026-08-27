/**
 * Copy the built CDN bundle next to index.html — a plain relative script
 * URL can't reach outside the served directory, and this also mirrors how
 * the file is consumed in the real world (a URL, not a monorepo path).
 */
import { copyFileSync } from "node:fs";

for (const file of ["cdn.js", "cdn.js.map"]) {
  copyFileSync(
    new URL(`../../packages/core/dist/${file}`, import.meta.url),
    new URL(`./${file}`, import.meta.url),
  );
}
