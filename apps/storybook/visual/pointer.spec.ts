import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { engineQuiet, openStory } from "./helpers.ts";

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
async function openButtonStory(page: Page): Promise<{
  rect: (selector: string) => Promise<DOMRect>;
  clicks: (selector: string) => Promise<number>;
}> {
  await openStory(page, "features-interactive--button");
  await engineQuiet(page);
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
  const { rect, clicks } = await openButtonStory(page);
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
    const { rect, clicks } = await openButtonStory(page);
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

/**
 * A scroll container's border is drawn in cells the NATIVE box gives
 * its content — the engine zeroes the border and paints it as glyphs
 * — so an item scrolled under it is still inside the padding box for
 * the browser to hit. The grid covers it there, and the press
 * addresses the grid instead (element.ts `showsElement`: a descendant
 * with a box of its own would have been the cell's element had the
 * grid shown it).
 */
test("a press on a scroll container's border misses the item clipped under it", async ({
  page,
}) => {
  // The story's play clicks items and ends by selecting one; the press
  // below must come after it.
  await openStory(page, "packages-ui--listbox");
  await engineQuiet(page);
  const selected = (): Promise<string> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-test="content"] [role="option"]')]
        .filter((option) => option.getAttribute("aria-selected") === "true")
        .map((option) => (option as HTMLElement).dataset["value"])
        .join(","),
    );
  const geometry = await page.evaluate(() => {
    const host = document.querySelector("mono-wind")!;
    const content = document.querySelector('[data-test="content"]') as HTMLElement;
    const box = content.getBoundingClientRect();
    const cell = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    return {
      x: box.left + box.width / 2,
      topBorder: box.top + cell / 2,
      scrolled: content.scrollTop,
    };
  });
  // The story leaves its list scrolled, so items sit above the view.
  expect(geometry.scrolled, "the story leaves the list scrolled").toBeGreaterThan(0);
  const before = await selected();
  expect(before, "the story leaves an item selected").not.toBe("");
  await page.mouse.move(geometry.x, geometry.topBorder);
  await page.waitForTimeout(150);
  await page.mouse.click(geometry.x, geometry.topBorder);
  await page.waitForTimeout(200);
  expect(await selected(), "a press on the border selects nothing new").toBe(before);
});

/**
 * A press lands on the element the grid shows at its cell: the
 * combobox's ▼ is a button laid over its input's end, so a press on the
 * glyph reaches the button above the input.
 */
test("a press on a button laid over an input reaches the button", async ({ page }) => {
  await openStory(page, "packages-ui--combobox");
  await engineQuiet(page);
  const state = () =>
    page.evaluate(() =>
      document.querySelector('[data-test="content"]')!.getAttribute("data-state"),
    );
  await page.keyboard.press("Escape");
  await expect.poll(state).toBe("closed");
  const geometry = await page.evaluate(() => {
    const host = document.querySelector("mono-wind")!;
    const rows = host.shadowRoot!.getElementById("grid")!.textContent!.split("\n");
    const row = rows.findIndex((text) => text.includes("▼"));
    const col = [...rows[row]!].indexOf("▼");
    const style = getComputedStyle(host);
    const box = host.getBoundingClientRect();
    return {
      x: box.left + (col + 0.5) * parseFloat(style.getPropertyValue("--mw-cw")),
      y: box.top + (row + 0.5) * parseFloat(style.getPropertyValue("--mw-ch")),
    };
  });
  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.click(geometry.x, geometry.y);
  await expect.poll(state, { message: "a press on the ▼ opens the list" }).toBe("open");
});

/**
 * The gutter bar is grid ink, so every gesture on it is the engine's
 * (specs/scrolling.md): a press beside the thumb pages toward it and
 * keeps paging while held, stopping where the thumb reaches the
 * pointer, and a press ON the thumb drags instead.
 */
test.describe("a press on the scrollbar track", () => {
  // Narrow enough that the story's text wraps past its six rows: at a
  // wide viewport it fits and there is no range to page through.
  test.use({ viewport: { width: 420, height: 800 } });

  /** Long enough for the repeat to have fired several times. */
  const HELD = 900;

  async function openOverflow(page: Page) {
    await openStory(page, "features-overflow--overflow");
    await engineQuiet(page);
    const box = await page.evaluate(() => {
      const host = document.querySelector("mono-wind")!;
      const element = document.querySelector('[data-test="scroll"]') as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(host);
      return {
        right: rect.right,
        top: rect.top,
        cellWidth: parseFloat(style.getPropertyValue("--mw-cw")),
        cellHeight: parseFloat(style.getPropertyValue("--mw-ch")),
        max: element.scrollHeight - element.clientHeight,
      };
    });
    expect(box.max, "the story's box overflows at this width").toBeGreaterThan(0);
    const scrollTop = (): Promise<number> =>
      page.evaluate(
        () => (document.querySelector('[data-test="scroll"]') as HTMLElement).scrollTop,
      );
    /** The box's rows inside its border as the grid paints them: each
     * one's text and its gutter glyph. */
    const painted = (): Promise<{ lines: string[]; gutter: string[] }> =>
      page.evaluate(() => {
        const host = document.querySelector("mono-wind")!;
        const rect = document.querySelector('[data-test="scroll"]')!.getBoundingClientRect();
        const cell = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
        const top = host.getBoundingClientRect().top;
        const rows = host
          .shadowRoot!.getElementById("grid")!
          .textContent!.split("\n")
          .slice(
            Math.round((rect.top - top) / cell) + 1,
            Math.round((rect.bottom - top) / cell) - 1,
          );
        return {
          lines: rows.map((row) => row.slice(1, -2).trim()),
          gutter: rows.map((row) => row.at(-2)!),
        };
      });
    // The bar is the last column INSIDE the border, which the engine
    // draws in a cell of its own; `row` counts the track from 0.
    const trackRow = (row: number) => ({
      x: box.right - box.cellWidth * 1.5,
      y: box.top + box.cellHeight * (row + 1.5),
    });
    const press = async (row: number, hold: number) => {
      const at = trackRow(row);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await page.mouse.up();
      await engineQuiet(page);
    };
    return { box, scrollTop, painted, press, trackRow };
  }

  test("pages a visible extent less one row, skipping nothing", async ({ page }) => {
    const { scrollTop, painted, press } = await openOverflow(page);
    const before = await painted();
    expect(before.gutter[0], "the thumb sits at the track's start").toBe("█");
    // The row just below the thumb: one page brings the thumb under it,
    // so the press pages exactly once however long it is held.
    await press(1, HELD);
    const after = await painted();
    expect(await scrollTop(), "it paged").toBeGreaterThan(0);
    expect(after.lines[0], "the last row seen stays, for context").toBe(before.lines.at(-1));
  });

  test("keeps paging while held, on to the end", async ({ page }) => {
    const { box, scrollTop, painted, press } = await openOverflow(page);
    await press((await painted()).lines.length - 1, HELD);
    expect(await scrollTop()).toBe(box.max);
  });

  test("stops with the thumb under the pointer, paging down", async ({ page }) => {
    const { box, scrollTop, painted, press } = await openOverflow(page);
    // Two rows below the thumb: more than one page, short of the end.
    await press(2, HELD);
    expect(await scrollTop(), "it paged").toBeGreaterThan(0);
    expect(await scrollTop(), "it stopped short of the end").toBeLessThan(box.max);
    expect((await painted()).gutter[2], "the thumb under the pressed row").toBe("█");
  });

  test("stops with the thumb under the pointer, paging up", async ({ page }) => {
    const { box, scrollTop, painted, press } = await openOverflow(page);
    await page.evaluate(() => {
      const element = document.querySelector('[data-test="scroll"]') as HTMLElement;
      element.scrollTop = element.scrollHeight;
    });
    await engineQuiet(page);
    expect(await scrollTop()).toBe(box.max);
    await press(1, HELD);
    expect(await scrollTop(), "it paged up").toBeLessThan(box.max);
    expect(await scrollTop(), "it stopped short of the start").toBeGreaterThan(0);
    expect((await painted()).gutter[1], "the thumb under the pressed row").toBe("█");
  });

  test("pages once for a quick press, and not again after the release", async ({ page }) => {
    const { box, scrollTop, painted, press } = await openOverflow(page);
    const before = await painted();
    // The track's last row, far past the thumb: a press shorter than
    // the repeat's delay pages once.
    await press(before.lines.length - 1, 30);
    const after = await painted();
    expect(after.lines[0], "exactly one page").toBe(before.lines.at(-1));
    const paged = await scrollTop();
    expect(paged).toBeLessThan(box.max);
    await page.waitForTimeout(500);
    expect(await scrollTop(), "nothing pages after the release").toBe(paged);
  });

  test("stops paging when released mid-repeat", async ({ page }) => {
    const { box, scrollTop, painted, trackRow } = await openOverflow(page);
    // Released from the page as the repeat's first page lands, before
    // its next beat 50 ms on: a release timed from outside would race it.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-test="scroll"]') as HTMLElement;
      const scrollTo = scroller.scrollTo.bind(scroller) as (options: ScrollToOptions) => void;
      let pages = 0;
      scroller.scrollTo = ((options: ScrollToOptions) => {
        scrollTo(options);
        if (++pages !== 2) return;
        queueMicrotask(() => {
          window.dispatchEvent(new PointerEvent("pointerup", { isPrimary: true }));
          (window as { released?: boolean }).released = true;
        });
      }) as HTMLElement["scrollTo"];
    });
    const at = trackRow((await painted()).lines.length - 1);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForFunction(() => (window as { released?: boolean }).released === true);
    const paged = await scrollTop();
    expect(paged, "released before the end").toBeLessThan(box.max);
    await page.waitForTimeout(500);
    expect(await scrollTop(), "no page after the release").toBe(paged);
    await page.mouse.up();
  });

  test("pages a horizontal bar toward the press", async ({ page }) => {
    await openStory(page, "features-overflow--styled");
    // The box sits below the fold of this narrow page.
    await page.locator('[data-test="xtrack"]').scrollIntoViewIfNeeded();
    await engineQuiet(page);
    const at = await page.evaluate(() => {
      const host = document.querySelector("mono-wind")!;
      const rect = document.querySelector('[data-test="xtrack"]')!.getBoundingClientRect();
      const style = getComputedStyle(host);
      const cellWidth = parseFloat(style.getPropertyValue("--mw-cw"));
      const cellHeight = parseFloat(style.getPropertyValue("--mw-ch"));
      // The bar's row inside the bottom border, near the track's end.
      return { x: rect.right - cellWidth * 2.5, y: rect.bottom - cellHeight * 1.5 };
    });
    const scrollLeft = () =>
      page.evaluate(
        () => (document.querySelector('[data-test="xtrack"]') as HTMLElement).scrollLeft,
      );
    expect(await scrollLeft()).toBe(0);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await engineQuiet(page);
    expect(await scrollLeft(), "it paged right").toBeGreaterThan(0);
  });

  test("on the thumb a press drags instead of paging", async ({ page }) => {
    const { scrollTop, trackRow } = await openOverflow(page);
    // At rest the thumb sits at the track's start.
    const from = trackRow(0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(HELD);
    expect(await scrollTop(), "a held press on the thumb pages nothing").toBe(0);
    const to = trackRow(3);
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    await engineQuiet(page);
    expect(await scrollTop(), "the content followed the thumb").toBeGreaterThan(0);
  });

  test("a drag from the track moves nothing", async ({ page }) => {
    const { scrollTop, trackRow } = await openOverflow(page);
    // The row just below the thumb: one page brings the thumb under it.
    const from = trackRow(1);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(HELD);
    const paged = await scrollTop();
    expect(paged, "the press paged").toBeGreaterThan(0);
    const to = trackRow(4);
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.waitForTimeout(HELD);
    await page.mouse.up();
    await engineQuiet(page);
    expect(await scrollTop(), "the drag moved nothing").toBe(paged);
  });
});
