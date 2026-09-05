import { expect, test } from "@playwright/test";

/**
 * Selection-invert regression: drag a REAL selection across each
 * fixture and screenshot the painted result, in both select modes —
 * "text" guards the engine's painted highlight over a light-DOM range
 * (reverse video per cell, the colored banner as a band of its color,
 * specs/wide-characters.md) and the invisibility of the native one
 * beneath it; "grid" guards the <pre>'s own ::selection ink (the
 * bbfc59c class of bug: the text-fill-color invisibility lock silently
 * defeating it in Safari) and the full-row sweep of its padded rows
 * (specs/cell-model.md "Selection"). The mode goes through the
 * preview's Select toolbar global, which rewrites every host's
 * attribute after render. Runs in all three engines
 * (playwright.config projects) — they paint native selection ink
 * differently, so each keeps its own golden.
 */
const FIXTURES = [
  "test-selection--light-text",
  "test-selection--banner",
  "test-selection--host-text",
];
const MODES = ["text", "grid"];

for (const id of FIXTURES) {
  for (const mode of MODES) {
    test(`${id} selection invert (${mode})`, async ({ page, browserName }) => {
      await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=select:${mode}`);
      await page.waitForFunction((mode) => {
        const hosts = [...document.querySelectorAll("mono-wind")];
        return (
          hosts.length > 0 &&
          hosts.every(
            (host) => host.hasAttribute("data-mw-ready") && host.getAttribute("select") === mode,
          )
        );
      }, mode);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      // Drag corner to corner of the light element (the banner's shadow
      // transcript, the host itself for its own text): its text in
      // "text", the grid under it in "grid".
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-test="target"]')!;
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
      await expect(page).toHaveScreenshot(`${id}-${mode}-${browserName}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
}
