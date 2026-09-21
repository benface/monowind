import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Pointer routing end to end (specs/cell-model.md "Pointer states"):
 * the engine's own hit test decides what the pointer addresses, so a
 * box painted over an element takes the hover, the cursor and the
 * press there, while an element the grid does show keeps them — an
 * inline link included, which is no box of its own. Needs a REAL
 * pointer: the correction applies to the browser's hit test, not to a
 * script's `click()`, which addresses its element as natively. Runs in
 * all three engines, each hit-testing its own way.
 */

/** The Button story, with its covered button, links and overlay. */
async function openStory(page: Page): Promise<{
  rect: (selector: string) => Promise<DOMRect>;
  clicks: (selector: string) => Promise<number>;
}> {
  await page.goto("/iframe.html?id=features-interactive--button&viewMode=story");
  await page.waitForFunction(() =>
    document.querySelector("mono-wind")?.hasAttribute("data-mw-ready"),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return {
    rect: (selector) =>
      page.evaluate((s) => document.querySelector(s)!.getBoundingClientRect().toJSON(), selector),
    clicks: (selector) =>
      page.evaluate(
        (s) => Number((document.querySelector(s) as HTMLElement).dataset.clicks ?? "0"),
        selector,
      ),
  };
}

test("a box painted over an element takes the pointer", async ({ page }) => {
  const { rect, clicks } = await openStory(page);
  const button = await rect("#btn-covered");
  const overlay = await rect('[data-test="overlay"]');
  expect(overlay.right, "the overlay covers part of the button").toBeLessThan(button.right);

  // Over the overlay: the button is underneath, and the browser's own
  // hit test finds it — the press is the overlay's cells' all the same.
  await page.mouse.click(overlay.left + overlay.width / 2, button.top + button.height / 2);
  expect(await clicks("#btn-covered"), "a press on the covered cells").toBe(0);
  expect(
    await page.evaluate(() => document.activeElement?.id ?? ""),
    "the focus stays off",
  ).not.toBe("btn-covered");

  // Past it, on the button's own cells: an ordinary press.
  await page.mouse.click((overlay.right + button.right) / 2, button.top + button.height / 2);
  expect(await clicks("#btn-covered"), "a press on the button's own cells").toBe(1);

  // An inline link is part of its paragraph's run, not a box the grid
  // hit-tests: its own cells stay its own. Its free cells are the ones
  // past the overlay — how far the overlay reaches is the layout's.
  const linkFree = await rect("#lnk-free");
  const freeCell = Math.max(linkFree.left, overlay.right) + 2;
  expect(freeCell, "the free link has cells past the overlay").toBeLessThan(linkFree.right);
  await page.mouse.click(freeCell, linkFree.top + linkFree.height / 2);
  expect(await clicks("#lnk-free"), "a press on a link's own cells").toBe(1);

  // Covered, it takes no press either.
  const linkUnder = await rect("#lnk-covered");
  expect(linkUnder.left, "the covered link starts under the overlay").toBeLessThan(overlay.right);
  expect(linkUnder.top, "and on its rows").toBeGreaterThanOrEqual(overlay.top);
  expect(linkUnder.bottom, "and on its rows").toBeLessThanOrEqual(overlay.bottom);
  await page.mouse.click(linkUnder.left + 2, linkUnder.top + linkUnder.height / 2);
  expect(await clicks("#lnk-covered"), "a press on a covered link").toBe(0);

  // Hover and the cursor follow the same rule: over the covered cells
  // the button holds no pointer events, so the browser hovers the grid
  // instead and the grid shows the overlay's cursor.
  const hovered = async (): Promise<{ color: string; events: string; cursor: string }> =>
    page.evaluate(() => {
      const btn = document.querySelector("#btn-covered")!;
      const grid = document.querySelector("mono-wind")!.shadowRoot!.getElementById("grid")!;
      return {
        color: getComputedStyle(btn).color,
        events: getComputedStyle(btn).pointerEvents,
        cursor: grid.style.cursor,
      };
    });
  await page.mouse.move((overlay.right + button.right) / 2, button.top + button.height / 2);
  await expect
    .poll(async () => (await hovered()).events, { message: "the button's own cells" })
    .toBe("auto");
  const free = await hovered();
  expect(free.cursor, "show its own cursor").toBe("pointer");
  await page.mouse.move(overlay.left + overlay.width / 2, button.top + button.height / 2);
  await expect
    .poll(async () => (await hovered()).events, { message: "the covered cells are the overlay's" })
    .toBe("none");
  // The hover style goes with them: the Tailwind variant drops a
  // covered element's `:hover`, and this button fades its color over
  // its own transition (specs/cell-model.md "Pointer states").
  await expect
    .poll(async () => (await hovered()).color, { message: "the button's hover stops applying" })
    .not.toBe(free.color);
  expect((await hovered()).cursor, "the grid shows the overlay's cursor").not.toBe("pointer");

  // A script addresses the element itself, covered or not.
  await page.evaluate(() => (document.querySelector("#btn-covered") as HTMLElement).click());
  expect(await clicks("#btn-covered"), "a script's own click").toBe(2);
});

/**
 * A tap has no hover before it, so the covered element still holds its
 * pointer events when the press lands: the press itself is corrected
 * (element.ts `#isCoveredTarget`). Playwright emulates touch in
 * Chromium and WebKit only.
 */
test.describe("a tap on covered cells", () => {
  test.use({ hasTouch: true });
  test.skip(({ browserName }) => browserName === "firefox", "no touch emulation in Firefox");

  test("goes to the cell, not the element underneath", async ({ page }) => {
    const { rect, clicks } = await openStory(page);
    const button = await rect("#btn-covered");
    const overlay = await rect('[data-test="overlay"]');
    await page.touchscreen.tap(overlay.left + overlay.width / 2, button.top + button.height / 2);
    await page.waitForTimeout(150);
    expect(await clicks("#btn-covered"), "a tap on the covered cells").toBe(0);
    await page.touchscreen.tap((overlay.right + button.right) / 2, button.top + button.height / 2);
    await expect
      .poll(() => clicks("#btn-covered"), { message: "a tap on the button's own cells" })
      .toBe(1);
  });
});
