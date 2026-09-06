import { expect, test } from "@playwright/test";

/**
 * Keyboard scrolling end to end (specs/scrolling.md "Keyboard
 * scrolling"): a real key press on a focused container scrolls it
 * natively, and the engine settles the position on a cell. Runs in all
 * three engines, each scrolling a key its own distance, smoothly or not.
 */
test("an arrow key scrolls a focused container, settled on a cell", async ({ page }) => {
  await page.goto("/iframe.html?id=features-overflow--keyboard&viewMode=story");
  await page.waitForFunction(() =>
    document.querySelector("mono-wind")?.hasAttribute("data-mw-ready"),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const box = page.locator('[data-test="box"]');
  const cell = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector("mono-wind")!).getPropertyValue("--mw-ch")),
  );
  // The position once the scroll has gone quiet.
  const settled = async (): Promise<number> => {
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const now = await box.evaluate((el) => el.scrollTop);
      if (now === last) return now;
      last = now;
      await page.waitForTimeout(300);
    }
    throw new Error("the scroll never settled");
  };
  await box.focus();
  // The focus's own relayout, a frame away, runs before the key.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.keyboard.press("ArrowDown");
  const first = await settled();
  expect(first).toBeGreaterThan(0);
  expect(Math.abs(first - Math.round(first / cell) * cell)).toBeLessThanOrEqual(0.5);
  await page.keyboard.press("ArrowDown");
  expect(await settled()).toBe(2 * first);
});
