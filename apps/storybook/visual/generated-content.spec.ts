import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { engineQuiet, hook, openStory } from "./helpers.ts";

/**
 * A press on a card whose link stretches over it, its border included,
 * with an `after:absolute after:-inset-1` (specs/generated-content.md
 * "The light DOM"): the pseudo-element's native box lies where the grid
 * draws it, so the card's border takes the press for the link, and the
 * row past it does not. Needs trusted input, in all three engines.
 */

/** The page point of the centre of a card's cell. */
function cardCell(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ selector, col, row }) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      const style = getComputedStyle(document.querySelector("mono-wind")!);
      const width = parseFloat(style.getPropertyValue("--mw-cw"));
      const height = parseFloat(style.getPropertyValue("--mw-ch"));
      return { x: rect.left + (col + 0.5) * width, y: rect.top + (row + 0.5) * height };
    },
    { selector: hook("card"), col, row },
  );
}

test("a press on a stretched link's card border follows the link, one past the card does not", async ({
  page,
}) => {
  await openStory(page, "features-generated-content--pseudo-element-boxes");
  await engineQuiet(page);
  const past = await cardCell(page, 3, -1);
  await page.mouse.click(past.x, past.y);
  await engineQuiet(page);
  expect(await page.evaluate(() => location.hash), "the row past the card").toBe("");
  const border = await cardCell(page, 0, 2);
  await page.mouse.click(border.x, border.y);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#card");
});
