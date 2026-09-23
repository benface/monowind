import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { datasetOf, engineQuiet, hook, openStory, rectOf } from "./helpers.ts";

/**
 * What takes no pointer events passes the pointer through where it is
 * DRAWN (specs/cell-model.md "Pointer states", specs/layers.md), and
 * what addresses an element with no pointer — a key's activation —
 * reaches it however the grid covers it. Needs trusted input, in all
 * three engines: each hit-tests its own way, and WebKit reports a key's
 * click at the element's centre.
 */

const clicks = async (page: Page, name: string): Promise<number> =>
  Number((await datasetOf(page, name, "clicks")) ?? "0");

const marked = (page: Page, name: string, attribute: string): Promise<boolean> =>
  page.evaluate(
    ({ selector, name: flag }) => document.querySelector(selector)!.hasAttribute(flag),
    { selector: hook(name), name: attribute },
  );

test.beforeEach(async ({ page }) => {
  await openStory(page, "features-interactive--pass-through");
  await engineQuiet(page);
});

test("a translated tip that takes no pointer events leaves the button it is drawn over", async ({
  page,
}) => {
  const tip = await rectOf(page, "tip");
  const button = await rectOf(page, "under");
  const x = tip.left + tip.width / 2;
  const y = tip.top + tip.height / 2;
  expect(x, "the tip is drawn over the button").toBeLessThan(button.right);
  await page.mouse.move(x, y);
  await expect
    .poll(() => marked(page, "under", "data-mw-hover"), { message: "the button hovers" })
    .toBe(true);
  expect(await marked(page, "under", "data-mw-covered"), "and is not covered").toBe(false);
  await page.mouse.click(x, y);
  expect(await clicks(page, "under"), "the press reaches it").toBe(1);
});

test("a link that takes the pointer again in a paragraph that takes none is its own", async ({
  page,
}) => {
  const link = await rectOf(page, "link");
  const zone = await rectOf(page, "zone");
  expect(link.top, "the link lies over the zone").toBeGreaterThanOrEqual(zone.top);
  expect(link.bottom, "the link lies over the zone").toBeLessThanOrEqual(zone.bottom);
  await page.mouse.move(link.left + link.width / 2, link.top + link.height / 2);
  await page.mouse.click(link.left + link.width / 2, link.top + link.height / 2);
  expect(await marked(page, "link", "data-mw-covered"), "not covered").toBe(false);
  expect(await clicks(page, "link"), "the press reaches it").toBe(1);
});

test("a key activates a focused button whose centre another box covers", async ({ page }) => {
  await page.focus(hook("covered"));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect.poll(() => clicks(page, "covered"), { message: "both keys activate" }).toBe(2);
});

test("the hover follows the pointer across a layer's edge inside one cell", async ({ page }) => {
  // Drawn 4px past its laid-out cells: 2px either side of its drawn
  // edge is the same cell of the grid, a layer's on one side alone.
  const edge = await rectOf(page, "edge");
  const y = edge.top + edge.height / 2;
  const hovered = () => marked(page, "edge", "data-mw-hover");
  await page.mouse.move(edge.left - 2, y + 40);
  await page.mouse.move(edge.left - 2, y);
  await expect.poll(hovered, { message: "off it" }).toBe(false);
  await page.mouse.move(edge.left + 2, y);
  await expect.poll(hovered, { message: "on it" }).toBe(true);
  await page.mouse.move(edge.left - 2, y);
  await expect.poll(hovered, { message: "off it again" }).toBe(false);
});

test("a host with its own select nested in another keeps its content clickable", async ({
  page,
}) => {
  // Unsupported, and laid out as the outer host's content: it warns.
  await page.evaluate(() => {
    const inner = document.createElement("mono-wind");
    inner.setAttribute("select", "grid");
    inner.innerHTML = '<button data-test="nested" class="border px-1">nested</button>';
    inner.querySelector("button")!.addEventListener("click", (event) => {
      const el = event.currentTarget as HTMLElement;
      el.dataset.clicks = String(Number(el.dataset.clicks ?? "0") + 1);
    });
    document.querySelector("mono-wind > div")!.appendChild(inner);
  });
  const grid = () =>
    page.evaluate(
      () => document.querySelector("mono-wind")!.shadowRoot!.getElementById("grid")!.textContent,
    );
  await expect.poll(grid, { message: "the outer host lays it out" }).toContain("nested");
  await engineQuiet(page);
  const button = await rectOf(page, "nested");
  await page.mouse.click(button.left + button.width / 2, button.top + button.height / 2);
  expect(await marked(page, "nested", "data-mw-pointer-none"), "reads auto").toBe(false);
  expect(await clicks(page, "nested"), "the press reaches it").toBe(1);
});
