import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { engineQuiet, openStory } from "./helpers.ts";

/**
 * The engine's blends against the browser's own (specs/cell-model.md
 * "Opacity and translucency"), in all three engines, goldenless: every
 * sample of the fixture's engine twin within 2/255 a channel of the
 * same sample of its native twin. The section's deviations (13–18) are
 * not among the cases but for 13's blank, whose native twin hides its
 * text, and 16's clip to sRGB, which every engine shares on an sRGB
 * screen; nor is the clip-text fade, which the engines draw three
 * ways.
 */
/** Each sample: a hook, and where its element is read — a glyph's color
 * at the center of its `█` or `🟥`, a background just inside its box's
 * left padding. */
const SAMPLES: [string, "glyph" | "fill"][] = [
  ["button", "fill"],
  ["button-glyph", "glyph"],
  ["outer", "fill"],
  ["inner", "fill"],
  ["nested-glyph", "glyph"],
  ["shade", "fill"],
  ["text-glyph", "glyph"],
  ["span-glyph", "glyph"],
  ["filled", "fill"],
  ["filled", "glyph"],
  ["inner-glyph", "glyph"],
  ["veil", "fill"],
  ["ghost", "fill"],
  ["ghost-glyph", "glyph"],
  ["layer", "fill"],
  ["layer-glyph", "glyph"],
  ["tailwind", "fill"],
  ["yellow", "fill"],
  ["gamut", "fill"],
  ["gamut-glyph", "glyph"],
  ["popover", "fill"],
  ["popover-glyph", "glyph"],
  ["lab", "fill"],
  ["a98", "fill"],
  ["prophoto", "fill"],
  ["rec2020", "fill"],
  ["system", "fill"],
  ["pixel", "fill"],
  ["pixel-glyph", "glyph"],
  ["emoji", "glyph"],
  ["blanked", "glyph"],
  ["layer-text", "fill"],
  ["layer-text-glyph", "glyph"],
  ["img-veil", "fill"],
  ["img-text-glyph", "glyph"],
  ["img-fade-glyph", "glyph"],
  ["img-button", "fill"],
  ["img-button-glyph", "glyph"],
  ["img-emoji", "glyph"],
  ["img-emoji-alpha", "glyph"],
  ["img-emoji-fill", "glyph"],
  ["img-veiled-button", "fill"],
  ["img-veiled-button-glyph", "glyph"],
  ["img-overlay", "fill"],
];

/** The translucent shades (specs/wide-characters.md "A shade keeps its
 * lattice"), each a hook on the engine's side and one on the browser's,
 * which draws one glyph once — a run of them overlaps at its joints.
 * Each is read at its fullest ink, the least blue pixel under a yellow
 * glyph whose neighbors across match it; a ring's in the row above its
 * box, where the browser draws a shadow and the twin spells out the
 * ring's glyph and color. */
const SHADES: [engine: string, native: string][] = [
  ["shade-glyph", "shade-glyph"],
  ["veiled-shade-glyph", "veiled-shade-glyph"],
  ["ring", "ring-glyph"],
];

test.use({ viewport: { width: 800, height: 1800 } });

test("the engine's blends land on the browser's", async ({ page }) => {
  await openStory(page, "test-blend--twins");
  await engineQuiet(page);
  const points = await page.evaluate((samples) => {
    const at = (side: string, name: string, where: string) => {
      const rect = document
        .querySelector(`[data-test="${side}"] [data-test="${name}"]`)!
        .getBoundingClientRect();
      const x = where === "glyph" ? rect.left + rect.width / 2 : rect.left + 3;
      return { x, y: rect.top + rect.height / 2 };
    };
    return samples.map(([name, where]) => ({
      name: `${name} ${where}`,
      engine: at("engine", name, where),
      native: at("native", name, where),
    }));
  }, SAMPLES);
  const shot = PNG.sync.read(await page.screenshot());
  const scale = shot.width / page.viewportSize()!.width;
  const pixel = (name: string, { x, y }: { x: number; y: number }): number[] => {
    const col = Math.floor(x * scale);
    const row = Math.floor(y * scale);
    if (!(col >= 0 && row >= 0 && col < shot.width && row < shot.height)) {
      throw new Error(`${name} at ${x}, ${y} lies outside the ${shot.width} × ${shot.height} shot`);
    }
    const i = (row * shot.width + col) * 4;
    return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
  };
  const off = points
    .map(({ name, engine, native }) => ({
      name,
      engine: pixel(`${name}, the engine's`, engine),
      native: pixel(`${name}, the browser's`, native),
    }))
    .filter(({ engine, native }) =>
      engine.some((channel, i) => Math.abs(channel - native[i]!) > 2),
    );
  expect(off).toEqual([]);
});

test("a translucent shade draws its lattice once, as the browser draws the glyph", async ({
  page,
}) => {
  await openStory(page, "test-blend--twins");
  await engineQuiet(page);
  const regions = await page.evaluate((shades) => {
    const box = (side: string, name: string) =>
      document
        .querySelector(`[data-test="${side}"] [data-test="${name}"]`)!
        .getBoundingClientRect();
    return shades.map(([engine, native]) => {
      const cells = box("engine", engine);
      // The ring's cells are the row above its box.
      const top = engine === "ring" ? cells.top - 8 : cells.top;
      const height = engine === "ring" ? 6 : cells.height;
      const glyph = box("native", native);
      return {
        name: engine,
        engine: { left: cells.left, top, width: cells.width, height },
        native: { left: glyph.left, top: glyph.top, width: glyph.width, height: glyph.height },
      };
    });
  }, SHADES);
  const shot = PNG.sync.read(await page.screenshot());
  const scale = shot.width / page.viewportSize()!.width;
  const fullest = (region: { left: number; top: number; width: number; height: number }) => {
    let least: number[] = [255, 255, 255];
    for (
      let row = Math.ceil(region.top * scale);
      row < (region.top + region.height) * scale;
      row++
    ) {
      for (
        let col = Math.ceil(region.left * scale);
        col < (region.left + region.width) * scale;
        col++
      ) {
        const i = (row * shot.width + col) * 4;
        // Inside the ink across, where subpixel antialiasing leaves every
        // channel whole.
        const across = [i - 4, i + 4].every((j) =>
          [0, 1, 2].every((k) => shot.data[j + k] === shot.data[i + k]),
        );
        if (across && shot.data[i + 2]! < least[2]!)
          least = [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
      }
    }
    return least;
  };
  const off = regions
    .map(({ name, engine, native }) => ({ name, engine: fullest(engine), native: fullest(native) }))
    .filter(({ engine, native }) =>
      engine.some((channel, i) => Math.abs(channel - native[i]!) > 2),
    );
  expect(off).toEqual([]);
});

test("a faded color emoji draws where a whole one does, its underline faded with it", async ({
  page,
}) => {
  await openStory(page, "test-blend--twins");
  await engineQuiet(page);
  // Each glyph's columns, down its row's fill.
  const boxes = await page.evaluate(() =>
    ["engine", "native"].map((side) =>
      ["whole-emoji", "underlined-emoji"].map((name) => {
        const glyph = document.querySelector(`[data-test="${side}"] [data-test="${name}"]`)!;
        const { left, width } = glyph.getBoundingClientRect();
        const { top, height } = glyph.closest("div")!.getBoundingClientRect();
        return { left, top, width, height };
      }),
    ),
  );
  const shot = PNG.sync.read(await page.screenshot());
  const scale = shot.width / page.viewportSize()!.width;
  const green = ([r, g, b]: number[]) => g! - (r! + b!) / 2;
  /** A glyph's top — its first row past half its reddest, which a fade
   * over a fill without red halves throughout — and the greenest pixel
   * down to just below the fill, its underline's. */
  const read = ({ left, top, width, height }: (typeof boxes)[number][number]) => {
    const reds: number[] = [];
    let greenest = [0, 0, 0];
    for (let row = Math.ceil(top * scale); row < (top + height + 4) * scale; row++) {
      let red = 0;
      for (let col = Math.ceil(left * scale); col < (left + width) * scale; col++) {
        const i = (row * shot.width + col) * 4;
        const pixel = [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
        red = Math.max(red, pixel[0]!);
        if (green(pixel) > green(greenest)) greenest = pixel;
      }
      if (row < (top + height) * scale) reds.push(red);
    }
    const half = Math.max(...reds) / 2;
    return { top: reds.findIndex((red) => red > half), underline: greenest };
  };
  const [whole, faded, , native] = boxes.flat().map(read);
  expect(faded!.top).toBe(whole!.top);
  expect(green(native!.underline)).toBeGreaterThan(30);
  const off = faded!.underline.some((channel, i) => Math.abs(channel - native!.underline[i]!) > 2);
  expect(off, `engine ${faded!.underline}, native ${native!.underline}`).toBe(false);
});
