/**
 * "Build" for a build-less app: the playground is static files plus the
 * CDN bundle (classic scripts, which a bundler would ignore anyway), so
 * deployment just stages them into dist/.
 */
import { copyFileSync, cpSync, mkdirSync } from "node:fs";

mkdirSync(new URL("./dist", import.meta.url), { recursive: true });
for (const file of [
  "index.html",
  "play.js",
  "cdn.js",
  "cdn.js.map",
  "sort.js",
  "sort.js.map",
  "ascii-cdn.js",
  "ascii-cdn.js.map",
]) {
  copyFileSync(new URL(`./${file}`, import.meta.url), new URL(`./dist/${file}`, import.meta.url));
}
cpSync(new URL("./fonts", import.meta.url), new URL("./dist/fonts", import.meta.url), {
  recursive: true,
});
cpSync(new URL("./themes", import.meta.url), new URL("./dist/themes", import.meta.url), {
  recursive: true,
});
