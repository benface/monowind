/**
 * Smoke test for the CDN bundle: load index.html from disk (like a classic
 * script tag would work anywhere), and verify that Tailwind's browser
 * compiler ran AND the monowind engine laid out the tree.
 */
import { chromium } from "playwright";

const url = new URL("./index.html", import.meta.url).href;
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
  };
});

await browser.close();

const failures = Object.entries(result).filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("CDN smoke test FAILED:", JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("CDN smoke test passed:", JSON.stringify(result));
