import { expect, test, type Locator, type Page } from "@playwright/test";
import { engineQuiet, openStory } from "./helpers.ts";

/** A relayout that no key's hold kept back: under the 500 ms a hold
 * lasts, with room for a loaded machine. */
const NO_HOLD = 450;

/**
 * Keyboard scrolling end to end (specs/scrolling.md "Keyboard
 * scrolling"): a real key press on a focused container scrolls it
 * natively, and the engine settles the position on a cell. Runs in all
 * three engines, each scrolling a key its own distance, smoothly or not.
 */
test("an arrow key scrolls a focused container, settled on a cell", async ({ page }) => {
  // The story's own play dispatches keys on this box and provokes a
  // relayout of its own; the real keys below come after it.
  await openStory(page, "features-overflow--keyboard");
  const box = page.locator('[data-test="box"]');
  const cell = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector("mono-wind")!).getPropertyValue("--mw-ch")),
  );
  /** One press and the position it settles on. */
  const pressAndSettle = async (): Promise<number> => {
    const from = await box.evaluate((el) => el.scrollTop);
    await page.keyboard.press("ArrowDown");
    return settledPast(box, from);
  };
  await box.focus();
  const first = await pressAndSettle();
  expect(first).toBeGreaterThan(0);
  expect(Math.abs(first - Math.round(first / cell) * cell)).toBeLessThanOrEqual(0.5);
  expect(await pressAndSettle()).toBe(2 * first);
});

/**
 * A relayout never lands under a key's scroll (specs/scrolling.md
 * "Keyboard scrolling"): here the key's own listener restyles a line,
 * which asks for one in the key's frame, and the scroll still goes its
 * whole step — run then, the relayout would cancel it in Firefox and
 * WebKit — while the grid follows it.
 */
test("a relayout asked for at a scrolling key waits for its scroll", async ({ page }) => {
  await openStory(page, "features-overflow--keyboard");
  const box = page.locator('[data-test="box"]');
  await box.focus();
  await engineQuiet(page);
  // A plain press first, for the whole step the key takes here.
  const step = await keyStep(box, () => page.keyboard.press("ArrowDown"));
  await box.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await engineQuiet(page);
  await page.evaluate(() => {
    const host = document.querySelector("mono-wind")!;
    const box = host.querySelector('[data-test="box"]')!;
    const grid = host.shadowRoot!.getElementById("grid")!;
    const state = window as { relayouts?: number; followed?: boolean };
    state.relayouts = 0;
    state.followed = false;
    new MutationObserver(() => state.relayouts!++).observe(host, {
      attributes: true,
      attributeFilter: ["measuring"],
    });
    box.addEventListener(
      "keydown",
      () => {
        box.firstElementChild!.classList.toggle("underline");
        // The grid follows the scroll while the relayout waits.
        const before = grid.textContent;
        const watch = () => {
          if (state.relayouts! > 0) return;
          if (grid.textContent !== before) state.followed = true;
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      },
      { once: true },
    );
  });
  expect(await keyStep(box, () => page.keyboard.press("ArrowDown")), "the whole step").toBe(step);
  const state = () =>
    page.evaluate(() => {
      const { relayouts, followed } = window as { relayouts?: number; followed?: boolean };
      return { relayouts, followed };
    });
  // Held, not dropped: the relayout still runs.
  await expect.poll(async () => (await state()).relayouts).toBeGreaterThan(0);
  expect((await state()).followed, "the grid painted the scroll before the relayout").toBe(true);
});

/**
 * A key a handler past the host cancels — a framework's root listener,
 * the document's — scrolls nothing, and holds no relayout.
 */
test("a scrolling key a later handler cancels holds no relayout", async ({ page }) => {
  await openStory(page, "features-overflow--keyboard");
  const box = page.locator('[data-test="box"]');
  await box.focus();
  await engineQuiet(page);
  await page.evaluate(() => {
    const host = document.querySelector("mono-wind")!;
    const box = host.querySelector('[data-test="box"]')!;
    const state = window as { pressedAt?: number; relaidAt?: number };
    new MutationObserver(() => {
      if (state.pressedAt !== undefined) state.relaidAt ??= performance.now();
    }).observe(host, {
      attributes: true,
      attributeFilter: ["measuring"],
    });
    box.addEventListener(
      "keydown",
      () => {
        state.pressedAt = performance.now();
        box.firstElementChild!.classList.toggle("underline");
      },
      { once: true },
    );
    document.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  });
  await page.keyboard.press("ArrowDown");
  const state = () =>
    page.evaluate(() => {
      const { pressedAt, relaidAt } = window as { pressedAt?: number; relaidAt?: number };
      return { pressedAt, relaidAt };
    });
  await expect.poll(async () => (await state()).relaidAt).toBeDefined();
  const { pressedAt, relaidAt } = await state();
  // The hold would last its whole 500 ms.
  expect(relaidAt! - pressedAt!).toBeLessThan(NO_HOLD);
  expect(await box.evaluate((el) => el.scrollTop)).toBe(0);
});

/** The time from a key in a story's control to the relayout its own
 * keydown listener asks for, and how far the box around it scrolled. */
async function relayoutAfter(
  page: Page,
  name: string,
  key: string,
): Promise<{ delay: number; scrolled: number }> {
  await openStory(page, "features-overflow--keyboard-controls");
  await page.locator(`[data-test="${name}"]`).focus();
  await engineQuiet(page);
  await page.evaluate((name) => {
    const host = document.querySelector("mono-wind")!;
    const state = window as { pressedAt?: number; relaidAt?: number };
    new MutationObserver(() => {
      if (state.pressedAt !== undefined) state.relaidAt ??= performance.now();
    }).observe(host, {
      attributes: true,
      attributeFilter: ["measuring"],
    });
    host.querySelector(`[data-test="${name}"]`)!.addEventListener(
      "keydown",
      () => {
        state.pressedAt = performance.now();
        host.querySelector('[data-test="outer-line"]')!.classList.toggle("underline");
      },
      { once: true },
    );
  }, name);
  await page.keyboard.press(key);
  const state = () =>
    page.evaluate(() => {
      const { pressedAt, relaidAt } = window as { pressedAt?: number; relaidAt?: number };
      return { pressedAt, relaidAt };
    });
  await expect.poll(async () => (await state()).relaidAt).toBeDefined();
  const { pressedAt, relaidAt } = await state();
  const scrolled = await page.evaluate(
    () => (document.querySelector('[data-test="outer"]') as HTMLElement).scrollTop,
  );
  return { delay: relaidAt! - pressedAt!, scrolled };
}

/** A key a focused control keeps scrolls nothing, and holds no relayout
 * (a hold lasts up to 500 ms). */
test("Space on a button and an arrow in a text input hold no relayout", async ({ page }) => {
  const space = await relayoutAfter(page, "button", " ");
  expect(space.scrolled, "Space activates the button").toBe(0);
  expect(space.delay).toBeLessThan(NO_HOLD);
  const arrow = await relayoutAfter(page, "input", "ArrowDown");
  expect(arrow.scrolled, "the arrow is the input's").toBe(0);
  expect(arrow.delay).toBeLessThan(NO_HOLD);
});

/** A box at its end hands the key to the box around it, as the
 * browsers chain it, and the hold follows: a relayout asked for at the
 * key waits for the outer box, which goes its whole step. */
test("a key on a box at its end scrolls the box around it, the relayout waiting", async ({
  page,
}) => {
  await openStory(page, "features-overflow--keyboard-controls");
  const outer = page.locator('[data-test="outer"]');
  const inner = page.locator('[data-test="inner"]');
  await outer.focus();
  await engineQuiet(page);
  const step = await keyStep(outer, () => page.keyboard.press("ArrowDown"));
  await outer.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await inner.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
  await inner.focus();
  await engineQuiet(page);
  await inner.evaluate((el) =>
    el.addEventListener(
      "keydown",
      () => document.querySelector('[data-test="outer-line"]')!.classList.toggle("underline"),
      { once: true },
    ),
  );
  expect(
    await keyStep(outer, () => page.keyboard.press("ArrowDown")),
    "the outer box's whole step",
  ).toBe(step);
});

/**
 * A focus ring drawn by a `focus-visible:outline-*` utility stays
 * native (specs/cell-model.md "Outlines"): once Tab lands on the
 * button, its color appears in the pixels just outside the box, in all
 * three engines.
 */
test("a focus-visible outline utility draws around the focused control", async ({ page }) => {
  // The story's own play focuses and blurs the button.
  await openStory(page, "features-effects--outline");
  await engineQuiet(page);
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

/** The position once the scroll has gone quiet, having MOVED off `from`
 * first: a scroll that has not begun reads as still, and settling on
 * that would take "not yet" for "done". */
async function settledPast(box: Locator, from: number): Promise<number> {
  let last = from;
  let still = 0;
  for (let i = 0; i < 25; i++) {
    const now = await box.evaluate((el) => el.scrollTop);
    if (now !== last) still = 0;
    else if (now !== from && ++still === 2) return now;
    last = now;
    await box.page().waitForTimeout(150);
  }
  throw new Error(`the scroll never moved off ${from}`);
}

/**
 * How far a key scrolls `box`: where its native scroll came to rest,
 * read as the engine's settle moves it onto a cell. A rest on a half
 * cell settles on either neighbour, by the cell last painted
 * (specs/scrolling.md), so two whole steps compare by their rests; a
 * relayout cutting the scroll short rests it early.
 */
async function keyStep(box: Locator, press: () => Promise<void>): Promise<number> {
  const from = await box.evaluate((el) => {
    const recorded = el as HTMLElement & { rest?: number };
    delete recorded.rest;
    const scrollTo = HTMLElement.prototype.scrollTo as (
      this: HTMLElement,
      options?: ScrollToOptions,
    ) => void;
    recorded.scrollTo = function (this: HTMLElement, options?: ScrollToOptions) {
      recorded.rest ??= this.scrollTop;
      scrollTo.call(this, options);
    } as HTMLElement["scrollTo"];
    return el.scrollTop;
  });
  await press();
  const settled = await settledPast(box, from);
  return box.evaluate(
    (el, { from, settled }) => {
      const recorded = el as HTMLElement & { rest?: number };
      Reflect.deleteProperty(recorded, "scrollTo");
      return (recorded.rest ?? settled) - from;
    },
    { from, settled },
  );
}

test("a keystroke that opens a combobox's list leaves the caret where it was", async ({ page }) => {
  await openStory(page, "packages-ui--combobox");
  await engineQuiet(page);
  const input = page.locator('[data-test="input"]');
  // A branch picked closes the list; the next keystroke opens it again.
  await input.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("feature/grid");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue("feature/grid");
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("feture/grid");
  // The opening's focus step runs a frame after the list opens.
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const caret = await input.evaluate(
    (el: HTMLInputElement) =>
      new Promise<number | null>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.selectionStart))),
      ),
  );
  expect(caret).toBe(2);
});
