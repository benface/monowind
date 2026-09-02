/** Sanity checks for the shipped theme files (run as the package's
 * test): every theme has a fresh-looking palette, scoped selectors,
 * and resolvable font references. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generatePalettes } from "./generate-palettes.mjs";

const root = new URL("..", import.meta.url).pathname;
const { exports } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const themes = readdirSync(join(root, "themes")).filter(
  (f) => f.endsWith(".css") && !f.endsWith(".palette.css") && f !== "index.css",
);
let failed = false;
const fail = (msg) => ((failed = true), console.error(msg));
if (themes.length < 6) fail(`only ${themes.length} themes found`);
for (const file of themes) {
  const name = file.replace(".css", "");
  const css = readFileSync(join(root, "themes", file), "utf8");
  if (!css.includes(`@import "./${name}.palette.css"`)) fail(`${file}: missing palette import`);
  if (exports[`./${name}`] !== `./themes/${file}`) fail(`${file}: missing "./${name}" export`);
  if (!css.includes(`mono-wind.theme-${name}`)) fail(`${file}: missing scoped selector`);
  if (!css.includes("--mw-border-glyphs:")) fail(`${file}: missing glyph set`);
  if (!css.includes("--mw-ansi-bright-white:")) fail(`${file}: missing ANSI tokens`);
  const palette = readFileSync(join(root, "themes", `${name}.palette.css`), "utf8");
  const tokens = palette.match(/--color-/g)?.length ?? 0;
  if (tokens < 250) fail(`${name}.palette.css: only ${tokens} tokens`);
  for (const [, ref] of css.matchAll(/@import "([^"]+)"/g)) {
    if (!existsSync(join(root, "themes", ref))) fail(`${file}: unresolved import ${ref}`);
  }
  for (const [, ref] of css.matchAll(/url\("([^"]+)"\)/g)) {
    if (!existsSync(join(root, "themes", ref))) fail(`${file}: missing font file ${ref}`);
  }
}
const index = readFileSync(join(root, "themes", "index.css"), "utf8");
for (const file of themes) {
  if (!index.includes(`@import "./${file}"`)) fail(`index.css: missing ${file}`);
}
// Freshness: committed palettes must match what the generator
// produces against the installed Tailwind — a Tailwind upgrade that
// changes the default palette fails here until regenerated.
for (const [theme, expected] of generatePalettes()) {
  const actual = readFileSync(join(root, "themes", `${theme}.palette.css`), "utf8");
  if (actual !== expected) fail(`${theme}.palette.css is stale — run pnpm generate`);
}
if (failed) process.exit(1);
console.log(`themes valid: ${themes.map((f) => f.replace(".css", "")).join(", ")}`);
