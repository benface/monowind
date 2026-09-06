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

/**
 * A word or paragraph gesture survives its release
 * (specs/semantic-selection.md): the engine takes the multi-click
 * press over, and the browser's mouse-up default would otherwise
 * collapse the selection the press landed in (Chromium, WebKit). A
 * real mouse, since a synthetic release has no default to cancel.
 */
for (const mode of MODES) {
  test(`double- and triple-click keep their selection (${mode})`, async ({ page }) => {
    await page.goto(
      `/iframe.html?id=test-selection--light-text&viewMode=story&globals=select:${mode}`,
    );
    await page.waitForFunction((mode) => {
      const host = document.querySelector("mono-wind");
      return host?.hasAttribute("data-mw-ready") && host.getAttribute("select") === mode;
    }, mode);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const box = await page.locator('[data-test="target"]').boundingBox();
    // The middle of the target's first letter.
    const letter = await page.evaluate(() => {
      const target = document.querySelector('[data-test="target"]')!;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.search(/\S/);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      throw new Error("no text");
    });
    const selected = () => page.evaluate(() => document.getSelection()!.toString());
    // A drag first, so the multi-click lands inside a selection.
    await page.mouse.move(box!.x + 2, box!.y + 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height - 2, { steps: 8 });
    await page.mouse.up();
    await page.mouse.dblclick(letter.x, letter.y);
    await page.waitForTimeout(150);
    expect(await selected()).toMatch(/^\S+\s?$/);
    await page.mouse.click(letter.x, letter.y, { clickCount: 3 });
    await page.waitForTimeout(150);
    expect((await selected()).split(/\s+/).length).toBeGreaterThan(3);
    // A plain click inside the selection still collapses it.
    await page.mouse.click(letter.x, letter.y);
    await page.waitForTimeout(150);
    expect(await selected()).toBe("");
  });
}
