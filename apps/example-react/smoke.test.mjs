/**
 * Smoke test for React integration: build must succeed, then in the dev
 * server — layout, borders, Tailwind, AND the React ownership loop: clicking
 * the button updates React state, React re-renders the text, monowind
 * observes the mutation and relayouts without breaking reconciliation.
 */
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "vite";

const build = spawnSync("pnpm", ["exec", "vite", "build"], {
  cwd: import.meta.dirname,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  console.error("React smoke test FAILED: vite build failed");
  process.exit(1);
}

const server = await createServer({ server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForSelector("mono-wind[data-mw-ready]", { timeout: 10_000 });

await page.click("button");
await page.click("button");
await page.waitForFunction(() => document.body.textContent?.includes("count is 2"));

const result = await page.evaluate(() => {
  const container = document.querySelector("mono-wind > div");
  const style = container?.getAttribute("style") ?? "";
  const decorations = document
    .querySelector("mono-wind")
    ?.shadowRoot?.getElementById("decorations");
  return {
    laidOut: /--mw-w: \d+/.test(style),
    minHeightApplied: Number(style.match(/--mw-h: (\d+)/)?.[1] ?? 0) >= 5,
    hasBorderGlyphs: (decorations?.textContent ?? "").includes("┌"),
    tailwindRan: getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
    reactStateFlowedThrough: document.body.textContent?.includes("count is 2") ?? false,
  };
});

await browser.close();
await server.close();

const failures = Object.entries(result).filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("React smoke test FAILED:", JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("React smoke test passed:", JSON.stringify(result));
