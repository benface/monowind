import { expect, test } from "@playwright/test";

/**
 * The top layer's placement end to end (specs/top-layer.md): the UA's
 * `inset: 0` and auto margins resolve in the cells of the host the
 * window shows, so a dialog opens in view however tall the page and
 * wherever it sits — centered in the whole host, it could open past
 * the fold, and a modal locks the page there. Needs a real window and
 * a real scroll, so it runs here rather than in the story.
 */
test("a dialog opens in the cells the window shows", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 260 });
  await page.goto("/iframe.html?id=features-top-layer--dialog-in-a-tall-page&viewMode=story");
  await page.waitForFunction(() =>
    document.querySelector("mono-wind")?.hasAttribute("data-mw-ready"),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  // The dialog's own rect: Chromium's CDP box model comes back empty
  // for a top-layer element, so the page measures it.
  const dialog = async (): Promise<DOMRect> =>
    page.evaluate(() => document.querySelector("dialog")!.getBoundingClientRect().toJSON());
  const view = page.viewportSize()!.height;
  const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(room, "the page is taller than the window").toBeGreaterThan(100);

  // Opened from the page, not by a press: a press would scroll the
  // trigger into view first and move the window under the test.
  const open = async (): Promise<void> => {
    await page.evaluate(() => {
      const dialog = document.querySelector("dialog")!;
      dialog.close();
      dialog.showModal();
    });
    await page.waitForTimeout(150);
  };
  const close = async (): Promise<void> => {
    await page.evaluate(() => document.querySelector("dialog")!.close());
    await page.waitForTimeout(150);
  };

  // At the top of the page.
  await open();
  const first = await dialog();
  expect(first.top, "opened below the window's top").toBeGreaterThanOrEqual(0);
  expect(first.bottom, "opened above its bottom").toBeLessThanOrEqual(view);
  // Its place in the host's own cells, which the scroll must move.
  const row = async (): Promise<number> =>
    page.evaluate(() => Number(document.querySelector("dialog")!.style.getPropertyValue("--mw-y")));
  const firstRow = await row();
  await close();

  // And lower down: the placement follows the cells the window shows.
  await page.evaluate((y) => window.scrollTo(0, y), room);
  await open();
  const lower = await dialog();
  expect(lower.top, "still below the window's top").toBeGreaterThanOrEqual(0);
  expect(lower.bottom, "still above its bottom").toBeLessThanOrEqual(view);
  // Further down the host: the placement moved with the window, where
  // centering in the whole host would have put it in the same row.
  expect(await row(), "moved down the host").toBeGreaterThan(firstRow);
});
