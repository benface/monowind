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

/**
 * A focus ring drawn by a `focus-visible:outline-*` utility stays
 * native (specs/cell-model.md "Outlines"): once Tab lands on the
 * button, its color appears in the pixels just outside the box, in all
 * three engines.
 */
test("a focus-visible outline utility draws around the focused control", async ({ page }) => {
  await page.goto("/iframe.html?id=features-effects--outline&viewMode=story");
  await page.waitForFunction(() =>
    document.querySelector("mono-wind")?.hasAttribute("data-mw-ready"),
  );
  // The story's own play focuses and blurs the button; let it finish.
  await page.waitForFunction(() => {
    const preview = (window as { __STORYBOOK_PREVIEW__?: { storyRenders: { phase: string }[] } })
      .__STORYBOOK_PREVIEW__;
    return preview?.storyRenders.every((render) =>
      ["finished", "errored", "aborted"].includes(render.phase),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const button = page.locator('[data-test="button"]');
  // The band of pixels around the box, four px wide.
  const box = (await button.boundingBox())!;
  const clip = { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 };
  // Pixels in the clip near the ring's amber (Tailwind amber-400).
  const amber = async () => {
    const png = (await page.screenshot({ clip })).toString("base64");
    return page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // Within a short distance of amber-400 (251, 191, 36): text
      // antialiasing fringes are far off in blue.
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.abs(data[i]! - 251) + Math.abs(data[i + 1]! - 191) + Math.abs(data[i + 2]! - 36);
        if (distance < 60) count++;
      }
      return count;
    }, png);
  };
  const rest = await amber();
  // The page focused on empty space, so Tab starts from the top.
  await page.mouse.click(5, 590);
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.waitForTimeout(150);
  expect(await amber()).toBeGreaterThan(rest + 200);
});
