import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { engineQuiet, hook, openStory } from "./helpers.ts";

/**
 * A press on a marker's cells, and beside them (specs/lists.md "Hit",
 * "The light DOM"): the grid's cell decides what it reaches, where a
 * native outside marker would hang as much as where the grid draws one.
 * Needs trusted input, in all three engines.
 */

/** The page point of the centre of the grid's cell `dx` cells right of
 * an element's left edge, on its first row. */
async function cellBeside(
  page: Page,
  selector: string,
  dx: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ selector, dx }) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      const style = getComputedStyle(document.querySelector("mono-wind")!);
      const width = parseFloat(style.getPropertyValue("--mw-cw"));
      const height = parseFloat(style.getPropertyValue("--mw-ch"));
      return { x: rect.left + (dx + 0.5) * width, y: rect.top + height / 2 };
    },
    { selector, dx },
  );
}

const isOpen = (page: Page, name: string): Promise<boolean> =>
  page.evaluate(
    (selector) => (document.querySelector(selector) as HTMLDetailsElement).open,
    hook(name),
  );

test("a press on a summary's marker toggles its details, one beside it does not", async ({
  page,
}) => {
  await openStory(page, "features-interactive--details");
  await engineQuiet(page);
  const marker = await cellBeside(page, `${hook("closed")} summary`, 0);
  await page.mouse.click(marker.x, marker.y);
  await expect
    .poll(() => isOpen(page, "closed"), { message: "the marker's cell opens it" })
    .toBe(true);
  await engineQuiet(page);
  // The details' padding, where the summary's native marker would hang.
  const beside = await cellBeside(page, `${hook("open")} summary`, -1);
  await page.mouse.click(beside.x, beside.y);
  await engineQuiet(page);
  expect(await isOpen(page, "open"), "the cell beside the summary is the details'").toBe(true);
});

test("a press on the grid's cells of a link on an inside marker's line lands on the link", async ({
  page,
}) => {
  await openStory(page, "features-lists--lists");
  await engineQuiet(page);
  const at = await page.evaluate(() => {
    const host = document.querySelector("mono-wind")!;
    const grid = host.shadowRoot!.getElementById("grid")!;
    const rows = grid.textContent!.split("\n");
    const row = rows.findIndex((text) => text.includes("a link"));
    const col = rows[row]!.indexOf("a link");
    const box = grid.getBoundingClientRect();
    const style = getComputedStyle(host);
    const width = parseFloat(style.getPropertyValue("--mw-cw"));
    const height = parseFloat(style.getPropertyValue("--mw-ch"));
    return { x: box.left + (col + 0.5) * width, y: box.top + (row + 0.5) * height };
  });
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#wrapped");
});
