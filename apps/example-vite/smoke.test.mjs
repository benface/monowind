/**
 * Smoke test for standalone mode (@monowind/vite): `vite build` must succeed
 * (exercises the virtual-module + generated-CSS-entry path through Rollup),
 * then the dev server must serve a page where Tailwind compiled (including
 * the custom @theme token), the engine laid out, and borders painted —
 * all without the app declaring Tailwind, monowind, a CSS entry, or a JS
 * entry.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";

const build = spawnSync("pnpm", ["exec", "vite", "build"], {
  cwd: import.meta.dirname,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  console.error("standalone smoke test FAILED: vite build failed");
  process.exit(1);
}
// The virtual entry must actually be bundled — a build that emits only
// index.html (unresolved /@id/ script) is broken in production.
const builtAssets = readdirSync(new URL("./dist/assets", import.meta.url));
if (!builtAssets.some((f) => f.endsWith(".js")) || !builtAssets.some((f) => f.endsWith(".css"))) {
  console.error("standalone smoke test FAILED: build emitted no JS/CSS assets", builtAssets);
  process.exit(1);
}

const server = await createServer({ server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForSelector("mono-wind[data-mw-ready]", { timeout: 10_000 });

const result = await page.evaluate(() => {
  const container = document.querySelector("mono-wind > div");
  const style = container?.getAttribute("style") ?? "";
  const grid = document.querySelector("mono-wind")?.shadowRoot?.getElementById("grid");
  return {
    laidOut: /--mw-w: \d+/.test(style),
    minHeightApplied: Number(style.match(/--mw-h: (\d+)/)?.[1] ?? 0) >= 5,
    hasBorderGlyphs: (grid?.textContent ?? "").includes("┌"),
    tailwindRan: getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
    // Custom @theme token via the plugin's `css` option (text-ice = #7dd3fc).
    customThemeApplied: getComputedStyle(document.body).color === "rgb(125, 211, 252)",
  };
});

await browser.close();
await server.close();

const failures = Object.entries(result).filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("standalone smoke test FAILED:", JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("standalone smoke test passed:", JSON.stringify(result));
