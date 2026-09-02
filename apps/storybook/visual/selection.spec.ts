import { expect, test } from "@playwright/test";

/**
 * Selection-invert regression (the bbfc59c class of bug: the
 * text-fill-color invisibility lock silently defeating ::selection in
 * Safari): drag a REAL selection across each fixture and screenshot
 * the painted result. Runs in all three engines (playwright.config
 * projects) — they paint selection ink differently, so each keeps
 * its own golden.
 */
const FIXTURES = ["test-selection--light-text", "test-selection--banner"];

for (const id of FIXTURES) {
  test(`${id} selection invert`, async ({ page, browserName }) => {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);
    await page.waitForFunction(() => {
      const hosts = [...document.querySelectorAll("mono-wind")];
      return hosts.length > 0 && hosts.every((host) => host.hasAttribute("data-mw-ready"));
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    // Drag corner to corner of the selectable region: the light element
    // itself, or the banner's shadow transcript.
    const box = await page.evaluate(() => {
      const el = document.querySelector("[data-select-target]")!;
      const rect = (el.shadowRoot?.getElementById("mirror") ?? el).getBoundingClientRect();
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    });
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 2, box.y + box.h - 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    // Firefox paints selection edges with run-to-run sub-pixel jitter;
    // the guarded regression (unpainted glyphs) moves far more pixels.
    await expect(page).toHaveScreenshot(`${id}-${browserName}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
