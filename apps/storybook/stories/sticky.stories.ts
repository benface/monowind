import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { readyGrid } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Sticky",
};
export default meta;

/**
 * Sticky positioning (specs/sticky.md): a box shifted with its scroll
 * container's offset at paint time, the browser's own box following it
 * — each story scrolls natively and checks the grid and the native box
 * agree on the cell, in three engines.
 */

const SECTIONS = [
  {
    title: "Section one",
    text: "A raccoon walked into the corner bakery this Tuesday, took one long look at the display case, and left without paying for a sourdough loaf clutched under its left arm.",
  },
  {
    title: "Section two",
    text: "The proprietor described the incident as unusually polite: the animal reportedly closed the door behind itself and made brief eye contact on the way out.",
  },
  {
    title: "Section three",
    text: "Officer Kimball is investigating but concedes the bakery's security camera, pointed at a wall for reasons nobody could remember, offered no leads.",
  },
];

/**
 * Section headings pinned to the top of a scrolling list — each held
 * until its section's end pushes it out and the next takes over — and
 * each section's footer pinned to the bottom, ahead of its place, until
 * its own row scrolls into view.
 */
export const SectionHeadings: StoryObj = {
  name: "Section Headings",
  render: () => html`
    <mono-wind>
      <div
        data-test="scroller"
        class="flex h-8 max-w-64 flex-col gap-1 overflow-y-auto border border-neutral-500 px-3 py-1"
      >
        ${SECTIONS.map(
          ({ title, text }, i) => html`
            <section>
              <h2
                data-test="heading-${i}"
                class="sticky top-0 z-10 bg-clear font-bold text-amber-300"
              >
                ${title}
              </h2>
              <p>${text}</p>
              <p data-test="footer-${i}" class="sticky bottom-0 bg-clear text-neutral-400">
                — end of the section —
              </p>
            </section>
          `,
        )}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, height, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const headings = SECTIONS.map((_, i) => by(`heading-${i}`));
    const footers = SECTIONS.map((_, i) => by(`footer-${i}`));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const { boxOf } = measure();
    // The scrollport's first and last rows — the padding box's, per CSS
    // — the content's first row and column inside the padding.
    const top = boxOf(scroller).row + cells(scroller, "--mw-bt");
    const bottom = boxOf(scroller).row + height(scroller) - cells(scroller, "--mw-bb") - 1;
    const padding = cells(scroller, "--mw-pt");
    const col = boxOf(scroller).col + cells(scroller, "--mw-bl") + cells(scroller, "--mw-pl");
    const sectionRows = boxOf(headings[1]!).row - boxOf(headings[0]!).row;
    // Scrolled by whole rows; the paint that shifts a box writes its
    // native shift too, so a box's var says when it has landed.
    const scrollTo = async (rows: number, landed: () => void) => {
      scroller.scrollTo({ top: rows * cellHeight, behavior: "instant" });
      await waitFor(landed, { timeout: 5_000 });
    };
    const atTop = (title: string) => expect(measure().rows[top]!.indexOf(title)).toBe(col);
    const atBottom = (footer: HTMLElement) => {
      expect(measure().rows[bottom]!.indexOf("— end")).toBe(col);
      expect(boxOf(footer).row).toBe(bottom);
    };
    // At rest: the first heading on the content's first row, its
    // section's footer already pulled up to the bottom row ahead of its
    // place.
    expect(boxOf(headings[0]!).row).toBe(top + padding);
    atBottom(footers[0]!);
    expect(cells(footers[0]!, "--mw-sy")).toBeLessThan(0);
    // Into the first section: its heading held on the scrollport's first
    // row, natively too; its footer back on its own row, and the second
    // section's on the bottom row (a row clear of that section's
    // heading).
    await scrollTo(4, () => expect(cells(headings[0]!, "--mw-sy")).toBe(4 - padding));
    atTop("Section one");
    expect(boxOf(headings[0]!).row).toBe(top);
    expect(cells(footers[0]!, "--mw-sy")).toBe(0);
    atBottom(footers[1]!);
    // Into the second: the hand-over at both edges.
    await scrollTo(sectionRows + 4, () => expect(cells(headings[1]!, "--mw-sy")).toBe(4 - padding));
    atTop("Section two");
    expect(boxOf(headings[0]!).row).toBeLessThan(top);
    expect(cells(footers[1]!, "--mw-sy")).toBe(0);
    atBottom(footers[2]!);
    // At the end: the last footer on its own row — the content's last,
    // the padding row below it — no longer shifted.
    await scrollTo(1000, () => expect(cells(footers[2]!, "--mw-sy")).toBe(0));
    atTop("Section three");
    expect(boxOf(footers[2]!).row).toBe(bottom - cells(scroller, "--mw-pb"));
  },
};

/**
 * A bar hidden until the scroll reaches it, then holding the
 * scrollport's bottom row for the rest of the scroll — a `top` inset of
 * the scrollport's height less one row, a `calc()` of a percentage and
 * cells (specs/cell-model.md "Mixed-unit calc()").
 */
export const RevealedFooter: StoryObj = {
  name: "Revealed Footer",
  render: () => html`
    <mono-wind>
      <div
        data-test="scroller"
        class="h-8 max-w-64 overflow-y-auto border border-neutral-500 px-3 py-1"
      >
        <p>${SECTIONS[0]!.text}</p>
        <p class="mt-1">${SECTIONS[1]!.text}</p>
        <p
          data-test="footer"
          class="sticky top-[calc(100%-(--spacing(1)))] h-1 bg-clear text-amber-300"
        >
          Please consider subscribing to our newsletter
        </p>
        <p>${SECTIONS[2]!.text}</p>
        <div class="h-2"></div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, height, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const footer = by("footer");
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const { boxOf } = measure();
    const edge = (side: string) =>
      cells(scroller, `--mw-b${side}`) + cells(scroller, `--mw-p${side}`);
    const top = boxOf(scroller).row + edge("t");
    const col = boxOf(scroller).col + edge("l");
    // The scrollport's last row: the padding box's, per CSS.
    const bottom = boxOf(scroller).row + height(scroller) - cells(scroller, "--mw-bb") - 1;
    const text = "Please consider";
    const footerRow = () => measure().rows.findIndex((row) => row.indexOf(text) === col);
    // At rest: below the scrollport, in its own slot.
    const slot = boxOf(footer).row - top;
    expect(top + slot).toBeGreaterThan(bottom);
    expect(footerRow()).toBe(-1);
    // Scrolled to where its slot would sit on the second content row:
    // held on the bottom row instead, natively too.
    scroller.scrollTo({ top: (slot - 1) * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(footer, "--mw-sy")).toBe(bottom - top - 1), {
      timeout: 5_000,
    });
    expect(footerRow()).toBe(bottom);
    expect(boxOf(footer).row).toBe(bottom);
    // At the end: on the content's last row — its containing block's
    // end, the padding row below it — over the trailing blank rows.
    scroller.scrollTo({ top: 1000, behavior: "instant" });
    await waitFor(
      () => {
        expect(footerRow()).toBe(bottom - 1);
        expect(
          measure()
            .rows[bottom - 2]!.slice(col, col + text.length)
            .trim(),
        ).toBe("");
      },
      { timeout: 5_000 },
    );
    expect(boxOf(footer).row).toBe(bottom - 1);
  },
};

const COLUMNS = ["mon", "tue", "wed", "thu", "fri", "sat"];
const ROWS = ["loaves", "rolls", "bagels", "scones", "buns", "rye", "pita", "naan"];

/**
 * A bordered table in a scroller with a sticky header row and a sticky
 * first column: the collapsed lattice follows each — the header's lines
 * with it, joined to the column lines running on below — and the corner
 * cell sticks both ways.
 */
export const Table: StoryObj = {
  name: "Table",
  render: () => html`
    <mono-wind>
      <div data-test="scroller" class="h-8 max-w-40 overflow-auto pe-1 scrollbar-y-2">
        <table class="border-collapse">
          <thead data-test="thead" class="sticky top-0 bg-clear text-amber-300">
            <tr>
              <th data-test="corner" class="sticky left-0 border border-neutral-400 bg-clear px-1">
                #
              </th>
              ${COLUMNS.map((c) => html`<th class="border border-neutral-400 px-1">${c}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${ROWS.map(
              (r, i) => html`
                <tr>
                  <th
                    data-test="row-${i}"
                    class="sticky left-0 border border-neutral-400 bg-clear px-1 text-left text-cyan-300"
                  >
                    ${r}
                  </th>
                  ${COLUMNS.map(
                    (_, j) =>
                      html`<td class="border border-neutral-400 px-1">${(i + 1) * (j + 1)}</td>`,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, width, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const [thead, corner, row0, row2] = [by("thead"), by("corner"), by("row-0"), by("row-2")];
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const { boxOf } = measure();
    // The scrollport's first row and column: past the scroller's border
    // and padding cells.
    const top = boxOf(scroller).row + cells(scroller, "--mw-bt") + cells(scroller, "--mw-pt");
    const left = boxOf(scroller).col + cells(scroller, "--mw-bl") + cells(scroller, "--mw-pl");
    // The first column's cells, lines beside them: its width sets where
    // the first inner line falls.
    const w = width(row0);
    const line = (a: string, b: string, c: string) => a + b.repeat(w) + c;
    const slice = (row: number) => measure().rows[row]!.slice(left, left + w + 2);
    // At rest: the table's top edge on the scrollport's first row.
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    // Scrolled down four rows: the header stays with its lines, its
    // bottom line joined to the column lines below, the third body row
    // under it; natively the same cells.
    scroller.scrollTo({ top: 4 * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(thead, "--mw-sy")).toBe(4), { timeout: 5_000 });
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    expect(slice(top + 1)).toMatch(/^│ +# +│$/);
    expect(slice(top + 2)).toBe(line("├", "─", "┼"));
    expect(slice(top + 3)).toBe("│ bagels │");
    expect(boxOf(thead).row).toBe(top + 1);
    expect(boxOf(row2).row).toBe(top + 3);
    // Scrolled right as well: the first column stays at the left edge,
    // lines included, the corner cell with it.
    scroller.scrollTo({ left: 4 * cellWidth, top: 4 * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(row0, "--mw-sx")).toBe(4), { timeout: 5_000 });
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    expect(slice(top + 1)).toMatch(/^│ +# +│$/);
    expect(slice(top + 3)).toBe("│ bagels │");
    expect(boxOf(corner)).toEqual({ row: top + 1, col: left + 1 });
    expect(boxOf(row2)).toEqual({ row: top + 3, col: left + 1 });
    expect(cells(corner, "--mw-sx")).toBe(4);
  },
};
