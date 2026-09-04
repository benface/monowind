import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Styling the `<mono-wind>` root itself. Its font, line-height, and
 * letter-spacing define the cell grid (cell width = glyph advance + root
 * letter-spacing, cell height = the root's line box), and every inherited
 * property set on it (color, …) becomes the default for the whole component.
 */
const meta: Meta = {
  title: "Features / Root Styles",
};
export default meta;

const CARD = html`
  <div class="flex gap-2">
    <div class="border border-neutral-500 px-1">
      Every character, border, and gap lands on whole cells.
    </div>
    <div class="max-w-22 border border-cyan-400 px-1">
      A narrow box wraps its text on the same grid.
    </div>
  </div>
`;

const fontCard = (label: string) => html`
  <div class="max-w-max border border-neutral-500 px-2 py-1">
    ${label} — the grid measures this font's own glyph advance and line box.
  </div>
`;

export const FontFamily: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-3">
      <mono-wind>${fontCard("JetBrains Mono (the Storybook default)")}</mono-wind>
      <mono-wind style="font-family: 'DejaVu Sans Mono Subset', monospace">
        ${fontCard("DejaVu Sans Mono (a self-hosted @font-face)")}
      </mono-wind>
      <mono-wind style="font-family: 'Courier New', monospace">
        ${fontCard("Courier New (a system font)")}
      </mono-wind>
    </div>
  `,
};

export const FontSize: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-3">
      <mono-wind class="text-xs">${CARD}</mono-wind>
      <mono-wind>${CARD}</mono-wind>
      <mono-wind class="text-xl">${CARD}</mono-wind>
    </div>
  `,
};

export const Color: StoryObj = {
  render: () => html`
    <mono-wind class="bg-neutral-950 p-2 text-emerald-400">
      <div class="border border-current px-3 py-1">
        The root's <span class="text-yellow-300">color</span>, background, and padding are ordinary
        CSS: text, borders, and inline elements inherit the colors, and the grid sits inside the
        padding.
      </div>
    </mono-wind>
  `,
};

/** The host's own inline content is a leaf like any element's
 * (specs/host-leaf.md): its native text sits under the grid's glyphs
 * without positioning, so the browser's lines must land on the
 * engine's rows in every engine. */
export const OwnText: StoryObj = {
  name: "Own Text",
  render: () => html`
    <mono-wind data-test="host" class="max-w-64 border border-neutral-500 p-1">
      The root can hold text of its own, with <b class="text-cyan-400">inline</b> elements and
      <a href="#" class="underline">links</a>, laid out exactly like a div's — every line on a grid
      row.
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-test="host"]')!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // A late font swap would move the native lines under the measurement.
    await document.fonts.ready;
    expect(host).toHaveAttribute("data-mw-leaf");
    const grid = host.shadowRoot!.getElementById("grid")!;
    const rows = grid
      .textContent!.split("\n")
      .map((row, index) => ({
        row: index,
        col: row.length - row.trimStart().length,
        cells: row.trim().length,
      }))
      .filter((row) => row.cells > 0);
    // The browser's line boxes over the host's own nodes, in cells from
    // the content box, must be the engine's rows.
    const style = getComputedStyle(host);
    const cellWidth = parseFloat(style.getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(style.getPropertyValue("--mw-ch"));
    const box = host.getBoundingClientRect();
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const lines = new Map<number, { start: number; end: number }>();
    for (const node of host.childNodes) {
      // The engine's metrics probe is a child too; it is not content.
      if (node instanceof Element && node.hasAttribute("data-mw-probe")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue;
        const row = Math.floor((rect.top + rect.height / 2 - top) / cellHeight);
        const start = Math.round((rect.left - left) / cellWidth);
        const end = Math.round((rect.right - left) / cellWidth);
        const line = lines.get(row);
        if (line) {
          line.start = Math.min(line.start, start);
          line.end = Math.max(line.end, end);
        } else lines.set(row, { start, end });
      }
    }
    const native = [...lines]
      .sort(([a], [b]) => a - b)
      .map(([row, line]) => ({ row, col: line.start, cells: line.end - line.start }));
    expect(native).toEqual(rows);
  },
};

export const LeadingAndTracking: StoryObj = {
  name: "Leading & Tracking",
  render: () => html` <mono-wind class="leading-[1.75] tracking-[0.25em]">${CARD}</mono-wind> `,
};
