import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { engineQuiet, openStory } from "./helpers.ts";

/**
 * The in-flow phases against the browser's own (specs/positioning.md
 * "Paint order"), in all three engines, goldenless: a block's text past
 * its box over a later block's fill, and a later block's text over an
 * earlier float, each `█` the same color on the grid as natively — the
 * text's, over the fill beneath.
 */
const GLYPHS = ["over-fill", "over-float"];

test("in-flow text paints over the later fills and the floats", async ({ page }) => {
  await openStory(page, "features-positioning--stacking-twins");
  await engineQuiet(page);
  const points = await page.evaluate(
    (glyphs) =>
      glyphs.flatMap((name) =>
        ["engine", "native"].map((side) => {
          const rect = document
            .querySelector(`[data-test="${side}"] [data-test="${name}"]`)!
            .getBoundingClientRect();
          return {
            name: `${name}, ${side}`,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }),
      ),
    GLYPHS,
  );
  const shot = PNG.sync.read(await page.screenshot());
  const scale = shot.width / page.viewportSize()!.width;
  const pixels = points.map(({ name, x, y }) => {
    const i = (Math.floor(y * scale) * shot.width + Math.floor(x * scale)) * 4;
    return { name, color: [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!] };
  });
  // Each the text's green, not the fill's blue beneath.
  expect(pixels).toEqual(pixels.map(({ name }) => ({ name, color: [0, 255, 0] })));
});
