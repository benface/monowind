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
 * until its section's end pushes it out and the next takes over — and a
 * footer pinned to the bottom until its own row scrolls into view.
 */
export const SectionHeadings: StoryObj = {
  name: "Section Headings",
  render: () => html`
    <mono-wind>
      <div data-test="scroller" class="h-8 max-w-64 overflow-y-auto border border-neutral-500 px-2">
        ${SECTIONS.map(
          ({ title, text }, i) => html`
            <section>
              <h2 data-test="heading-${i}" class="sticky top-0 bg-clear font-bold text-amber-300">
                ${title}
              </h2>
              <p class="mb-1">${text}</p>
            </section>
          `,
        )}
        <p data-test="footer" class="sticky bottom-0 bg-clear text-neutral-400">
          — end of the list —
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, height, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const headings = SECTIONS.map((_, i) => by(`heading-${i}`));
    const footer = by("footer");
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const { boxOf } = measure();
    // The scrollport's first and last rows and its first column: past the
    // scroller's border and padding cells.
    const edge = (side: string) =>
      cells(scroller, `--mw-b${side}`) + cells(scroller, `--mw-p${side}`);
    const top = boxOf(scroller).row + edge("t");
    const bottom = boxOf(scroller).row + height(scroller) - edge("b") - 1;
    const col = boxOf(scroller).col + edge("l");
    const sectionRows = boxOf(headings[1]!).row - boxOf(headings[0]!).row;
    // Scrolled by whole rows; the paint that shifts a box writes its
    // native shift too, so a box's var says when it has landed.
    const scrollTo = async (rows: number, landed: () => void) => {
      scroller.scrollTo({ top: rows * cellHeight, behavior: "instant" });
      await waitFor(landed, { timeout: 5_000 });
    };
    const atTop = (title: string) => expect(measure().rows[top]!.indexOf(title)).toBe(col);
    // At rest: the first heading at the top by itself, the footer pinned
    // to the bottom row from the end of the list.
    expect(boxOf(headings[0]!).row).toBe(top);
    expect(measure().rows[bottom]!.indexOf("— end")).toBe(col);
    expect(boxOf(footer).row).toBe(bottom);
    expect(cells(footer, "--mw-sy")).toBeLessThan(0);
    // Into the first section: its heading stays, natively too.
    await scrollTo(3, () => expect(cells(headings[0]!, "--mw-sy")).toBe(3));
    atTop("Section one");
    expect(boxOf(headings[0]!).row).toBe(top);
    // Into the second: the hand-over.
    await scrollTo(sectionRows + 2, () => expect(cells(headings[1]!, "--mw-sy")).toBe(2));
    atTop("Section two");
    expect(boxOf(headings[1]!).row).toBe(top);
    expect(boxOf(headings[0]!).row).toBeLessThan(top);
    // At the end: the footer sits on its own row, no longer shifted.
    await scrollTo(1000, () => expect(cells(footer, "--mw-sy")).toBe(0));
    atTop("Section three");
    expect(boxOf(footer).row).toBe(bottom);
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
