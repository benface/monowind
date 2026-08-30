import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expectBrowserRowsToMatchEngine } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Table",
};
export default meta;

const cellsOf = (el: HTMLElement, name: string): number => Number(el.style.getPropertyValue(name));

export const Basic: StoryObj = {
  render: () => html`
    <mono-wind>
      <table data-test="table">
        <thead>
          <tr>
            <th class="border border-cyan-400 px-1">Name</th>
            <th class="border border-cyan-400 px-1">Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="border px-1">Ada</td>
            <td class="border px-1">Engineer</td>
          </tr>
          <tr>
            <td class="border px-1">Grace</td>
            <td class="border px-1">Admiral</td>
          </tr>
        </tbody>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // Preflight collapses table borders: neighbors share single lattice
    // lines, so the table is column sums + 3 lines wide, row sums + 4
    // lines tall — geometry-derived from the cell boxes.
    const table = canvasElement.querySelector<HTMLElement>('[data-test="table"]')!;
    const cells = Array.from(table.querySelectorAll<HTMLElement>("th, td"));
    const [name, role] = cells;
    expect(cellsOf(role!, "--mw-x")).toBe(cellsOf(name!, "--mw-x") + cellsOf(name!, "--mw-w") + 1);
    expect(cellsOf(table, "--mw-w")).toBe(cellsOf(name!, "--mw-w") + cellsOf(role!, "--mw-w") + 3);
    // Collapsed cells surrender their borders to the lattice: zero border
    // cells on the cell boxes themselves.
    for (const cell of cells) expect(cellsOf(cell, "--mw-bl")).toBe(0);
  },
};

export const Spans: StoryObj = {
  render: () => html`
    <mono-wind>
      <table data-test="table">
        <tbody>
          <tr>
            <td colspan="2" class="border border-double px-1">span two</td>
            <td rowspan="2" class="border border-double px-1">tall</td>
          </tr>
          <tr>
            <td class="border border-double px-1">a</td>
            <td class="border border-double px-1">b</td>
          </tr>
          <tr>
            <td class="border border-double px-1">c</td>
            <td class="border border-double px-1">d</td>
            <td class="border border-double px-1">e</td>
          </tr>
        </tbody>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const table = canvasElement.querySelector<HTMLElement>('[data-test="table"]')!;
    const rows = Array.from(table.querySelectorAll<HTMLElement>("tr"));
    const spanTwo = table.querySelector<HTMLElement>('[colspan="2"]')!;
    const tall = table.querySelector<HTMLElement>('[rowspan="2"]')!;
    const [a, b] = Array.from(rows[1]!.querySelectorAll<HTMLElement>("td"));
    // The colspan covers both columns plus the shared line between them.
    expect(cellsOf(spanTwo, "--mw-w")).toBe(cellsOf(a!, "--mw-w") + cellsOf(b!, "--mw-w") + 1);
    // The rowspan covers both rows plus the shared line between them.
    expect(cellsOf(tall, "--mw-h")).toBe(
      cellsOf(rows[0]!, "--mw-h") + cellsOf(rows[1]!, "--mw-h") + 1,
    );
  },
};

export const PercentColumns: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1" data-test="container">
        <table class="w-full" data-test="table">
          <tbody>
            <tr>
              <td class="w-1/2 border px-1">half the table</td>
              <td class="border px-1">the</td>
              <td class="border px-1">rest</td>
            </tr>
          </tbody>
        </table>
        <table data-test="greedy">
          <tbody>
            <tr>
              <td class="w-full border px-1">greedy</td>
              <td class="border px-1">min</td>
            </tr>
          </tbody>
        </table>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const container = canvasElement.querySelector<HTMLElement>('[data-test="container"]')!;
    const table = canvasElement.querySelector<HTMLElement>('[data-test="table"]')!;
    const tds = Array.from(table.querySelectorAll<HTMLElement>("td"));
    // w-1/2 pins its column to half the column space: the sum of the
    // OTHER columns equals it, ±1 integer remainder — however many
    // sibling columns the markup has.
    const [half, ...others] = tds.map((td) => cellsOf(td, "--mw-w"));
    const othersSum = others.reduce((sum, w) => sum + w, 0);
    expect(Math.abs(half! - othersSum)).toBeLessThanOrEqual(1);
    // w-full cell: the auto-width table inflates to the full available
    // width, the other column staying at its content width.
    const greedy = canvasElement.querySelector<HTMLElement>('[data-test="greedy"]')!;
    expect(cellsOf(greedy, "--mw-w")).toBe(cellsOf(container, "--mw-w"));
  },
};

export const CaptionAndAlignment: StoryObj = {
  render: () => html`
    <mono-wind>
      <table>
        <caption>
          Quarterly totals
        </caption>
        <tbody>
          <tr>
            <td class="border px-1">line one<br />line two<br /><br /></td>
            <td class="border px-1" data-test="middle">middle</td>
            <td class="border px-1 align-top" data-test="top">top</td>
            <td class="border px-1 align-bottom" data-test="bottom">bottom</td>
          </tr>
        </tbody>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const caption = canvasElement.querySelector<HTMLElement>("caption")!;
    const top = canvasElement.querySelector<HTMLElement>('[data-test="top"]')!;
    const middle = canvasElement.querySelector<HTMLElement>('[data-test="middle"]')!;
    const bottom = canvasElement.querySelector<HTMLElement>('[data-test="bottom"]')!;
    // The caption sits above the grid (default caption-side: top) —
    // rows live under the parser-inserted <tbody>, so compare siblings:
    // caption vs the group, both table-relative.
    const group = canvasElement.querySelector<HTMLElement>("tbody")!;
    expect(cellsOf(caption, "--mw-y")).toBeLessThan(cellsOf(group, "--mw-y"));
    // All three cells share the row box; alignment lives in the content
    // padding: top pads nothing, middle centers, bottom pads fully. The
    // first cell's trailing <br /><br /> makes the row three lines tall
    // (one blank line — a final <br> adds none, the one before it does).
    expect(cellsOf(middle, "--mw-y")).toBe(cellsOf(top, "--mw-y"));
    expect(cellsOf(bottom, "--mw-y")).toBe(cellsOf(top, "--mw-y"));
    expect(cellsOf(top, "--mw-pt")).toBe(0);
    expect(cellsOf(middle, "--mw-pt")).toBe(1);
    expect(cellsOf(bottom, "--mw-pt")).toBe(2);
  },
};

export const AttributesAndGroups: StoryObj = {
  render: () => html`
    <mono-wind>
      <table>
        <colgroup>
          <col class="w-20" />
          <col span="2" />
        </colgroup>
        <tfoot>
          <tr>
            <td colspan="3" class="border px-1">footer, declared first</td>
          </tr>
        </tfoot>
        <thead>
          <tr>
            <th class="border px-1">wide col</th>
            <th class="border px-1">b</th>
            <th class="border px-1">c</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="0" class="h-7 border px-1">all</td>
            <td class="border px-1">b1</td>
            <td valign="top" class="border px-1" data-test="valign">c1</td>
          </tr>
          <tr>
            <td class="border px-1">b2</td>
            <td class="border px-1">c2</td>
          </tr>
        </tbody>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // thead renders first and tfoot last regardless of DOM order.
    const thead = canvasElement.querySelector<HTMLElement>("thead")!;
    const tbody = canvasElement.querySelector<HTMLElement>("tbody")!;
    const tfoot = canvasElement.querySelector<HTMLElement>("tfoot")!;
    expect(cellsOf(thead, "--mw-y")).toBeLessThan(cellsOf(tbody, "--mw-y"));
    expect(cellsOf(tbody, "--mw-y")).toBeLessThan(cellsOf(tfoot, "--mw-y"));
    // The <col> width pins the first column.
    const wide = canvasElement.querySelector<HTMLElement>("th")!;
    expect(cellsOf(wide, "--mw-w")).toBe(20);
    // rowspan="0" spans to the end of its row group: both body rows plus
    // the shared line between them.
    const all = canvasElement.querySelector<HTMLElement>('[rowspan="0"]')!;
    const bodyRows = Array.from(tbody.querySelectorAll<HTMLElement>("tr"));
    expect(cellsOf(all, "--mw-h")).toBe(
      cellsOf(bodyRows[0]!, "--mw-h") + cellsOf(bodyRows[1]!, "--mw-h") + 1,
    );
    // The legacy valign attribute is honored: top instead of the UA's
    // middle, so no alignment padding.
    expect(
      cellsOf(canvasElement.querySelector<HTMLElement>('[data-test="valign"]')!, "--mw-pt"),
    ).toBe(0);
    // The footer colspan covers all three columns plus two shared lines.
    const footer = canvasElement.querySelector<HTMLElement>('[colspan="3"]')!;
    const cells = Array.from(thead.querySelectorAll<HTMLElement>("th"));
    expect(cellsOf(footer, "--mw-w")).toBe(
      cells.reduce((sum, cell) => sum + cellsOf(cell, "--mw-w"), 0) + 2,
    );
  },
};

export const FullHeightChildren: StoryObj = {
  render: () => html`
    <mono-wind>
      <table>
        <tbody>
          <tr>
            <td class="border px-1">
              line one<br />line two<br />line three<br />line four<br />line five
            </td>
            <td class="border px-1" data-test="cell">
              <div class="h-full border border-cyan-400 px-1" data-test="full">fills</div>
            </td>
          </tr>
        </tbody>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true });
    // The h-full child resolves against the final row height (the legacy
    // second cell pass): its border box fills the cell's content box.
    const cell = canvasElement.querySelector<HTMLElement>('[data-test="cell"]')!;
    const full = canvasElement.querySelector<HTMLElement>('[data-test="full"]')!;
    expect(cellsOf(full, "--mw-h")).toBe(cellsOf(cell, "--mw-h"));
  },
};

export const SeparateBorders: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <table class="border-separate border-spacing-0" data-test="tight">
          <tbody>
            <tr>
              <td class="border px-1">border-separate</td>
              <td class="border px-1">with</td>
              <td class="border px-1">border-spacing-0</td>
            </tr>
          </tbody>
        </table>
        <table class="border-separate border-spacing-x-2 border-spacing-y-1" data-test="table">
          <thead>
            <tr>
              <th class="border border-cyan-400 px-1">border-separate</th>
              <th class="border border-cyan-400 px-1">with</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="border px-1">border-spacing-x-2</td>
              <td class="border px-1">and</td>
            </tr>
            <tr>
              <td class="border px-1" colspan="2">border-spacing-y-1</td>
            </tr>
          </tbody>
        </table>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const table = canvasElement.querySelector<HTMLElement>('[data-test="table"]')!;
    const [a, b] = Array.from(table.querySelectorAll<HTMLElement>("th"));
    const span = table.querySelector<HTMLElement>('[colspan="2"]')!;
    // Each cell keeps its own border ring, spacing cells between and
    // around (2 across, 1 down), and the border cells stay on the cell
    // boxes (unlike the collapsed model).
    expect(cellsOf(a!, "--mw-x")).toBe(2);
    expect(cellsOf(b!, "--mw-x")).toBe(2 + cellsOf(a!, "--mw-w") + 2);
    expect(cellsOf(a!, "--mw-bl")).toBe(1);
    // The colspan covers both columns plus the spacing between them.
    expect(cellsOf(span, "--mw-w")).toBe(cellsOf(a!, "--mw-w") + cellsOf(b!, "--mw-w") + 2);
    // border-spacing-0 zeroes the UA's 2px default: rings touch (││),
    // the doubled line being honest CSS — collapse is what merges them.
    const tight = canvasElement.querySelector<HTMLElement>('[data-test="tight"]')!;
    const [r1, r2] = Array.from(tight.querySelectorAll<HTMLElement>("td"));
    expect(cellsOf(r1!, "--mw-x")).toBe(0);
    expect(cellsOf(r2!, "--mw-x")).toBe(cellsOf(r1!, "--mw-w"));
  },
};

export const FixedLayout: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <table class="w-full table-fixed" data-test="full">
          <tbody>
            <tr>
              <td class="border px-1">even</td>
              <td class="border px-1">columns</td>
              <td class="border px-1">regardless of content length</td>
            </tr>
          </tbody>
        </table>
        <table class="w-64 max-w-full table-fixed" data-test="table">
          <tbody>
            <tr>
              <td class="border px-1">this cell has much longer content than its sibling</td>
              <td class="border px-1">short</td>
            </tr>
          </tbody>
        </table>
        <table class="table-fixed" data-test="auto-fallback">
          <tbody>
            <tr>
              <td class="border px-1">content decides column widths here</td>
              <td class="border px-1">short</td>
            </tr>
          </tbody>
        </table>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const table = canvasElement.querySelector<HTMLElement>('[data-test="table"]')!;
    const [long, short] = Array.from(table.querySelectorAll<HTMLElement>("td"));
    // Fixed layout ignores content: both unsized columns split the table
    // evenly (±1 integer remainder), long content wraps.
    expect(Math.abs(cellsOf(long!, "--mw-w") - cellsOf(short!, "--mw-w"))).toBeLessThanOrEqual(1);
    expect(cellsOf(long!, "--mw-h")).toBeGreaterThan(1);
    // w-full + table-fixed: equal columns across the full width.
    const full = canvasElement.querySelector<HTMLElement>('[data-test="full"]')!;
    const fullCols = Array.from(full.querySelectorAll<HTMLElement>("td"), (td) =>
      cellsOf(td, "--mw-w"),
    );
    expect(Math.max(...fullCols) - Math.min(...fullCols)).toBeLessThanOrEqual(1);
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    expect(cellsOf(full, "--mw-w")).toBeGreaterThanOrEqual(
      Math.floor(
        host.clientWidth / parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw")),
      ) - 1,
    );
    // Without an authored width, table-fixed falls back to the auto
    // algorithm (probed browser behavior): columns are content-sized.
    const fallback = canvasElement.querySelector<HTMLElement>('[data-test="auto-fallback"]')!;
    const [wide, narrow] = Array.from(fallback.querySelectorAll<HTMLElement>("td"));
    expect(cellsOf(wide!, "--mw-w")).toBeGreaterThan(cellsOf(narrow!, "--mw-w") + 5);
  },
};
