/**
 * Smoke test for native-Tailwind mode: boot the Vite dev server
 * programmatically, load the page, verify Tailwind compiled and the engine
 * laid out the tree.
 */
import { chromium } from "playwright";
import { createServer } from "vite";

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
  const decorations = document
    .querySelector("mono-wind")
    ?.shadowRoot?.getElementById("decorations");
  return {
    laidOut: /--mw-w: \d+/.test(style),
    minHeightApplied: Number(style.match(/--mw-h: (\d+)/)?.[1] ?? 0) >= 5,
    hasBorderGlyphs: (decorations?.textContent ?? "").includes("┌"),
    tailwindRan: getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
    // Custom @theme token compiled into a working utility (text-phosphor).
    customThemeApplied: getComputedStyle(document.body).color === "rgb(0, 255, 136)",
    // Regression: utilities must beat monowind's form-control normalization
    // (companion CSS lives in @layer base; utilities are unlayered-stronger).
    utilityBeatsNormalization:
      getComputedStyle(document.querySelector("button")).color === "rgb(255, 176, 0)",
  };
});

await browser.close();
await server.close();

const failures = Object.entries(result).filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("Vite+Tailwind smoke test FAILED:", JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("Vite+Tailwind smoke test passed:", JSON.stringify(result));
