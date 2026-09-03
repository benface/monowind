import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Responsive variants (`sm:`, `md:`, …) work out of the box: the browser
 * resolves the cascade before the engine reads computed styles, and any
 * viewport change resizes the host, which re-runs layout. Resize the
 * window (or use the viewport toolbar) to see these switch.
 */
const meta: Meta = {
  title: "Features / Responsive",
};
export default meta;

export const RootFontSize: StoryObj = {
  render: () => html`
    <mono-wind class="text-xs sm:text-sm md:text-base">
      <div class="max-w-max border border-neutral-500 px-1">
        The whole grid scales with the root font size:
        <span class="text-cyan-400">text-xs</span>, then
        <span class="text-yellow-400">sm:text-sm</span>, then
        <span class="text-emerald-400">md:text-base</span>.
      </div>
    </mono-wind>
  `,
};

export const LayoutChange: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-x-1 md:flex-row md:gap-2">
        <div class="border border-cyan-400 px-1 md:flex-1">
          Stacked as a column on narrow viewports…
        </div>
        <div class="border border-yellow-400 px-1 md:flex-1">
          …side by side (flex-row + flex-1) from md up.
        </div>
        <div class="hidden border border-fuchsia-400 px-1 lg:block lg:flex-1">
          This third box only exists from lg up.
        </div>
      </div>
    </mono-wind>
  `,
};

/** The host's width snaps to whole cells (specs/cell-model.md "Host
 * sizing"): here a flex item beside a sidebar, centered in its slot.
 * Shrink the sidebar and the host grows into the freed columns. */
export const HostWidth: StoryObj = {
  render: () => html`
    <div class="flex gap-2">
      <div data-test="sidebar" class="w-64 shrink-0 bg-neutral-800 p-2 text-neutral-400">
        sidebar
      </div>
      <mono-wind data-test="host" class="mx-auto min-w-0 flex-1 bg-neutral-900 text-neutral-200">
        <div class="border border-emerald-400 px-1">
          As wide as the columns that fit — the border ends on the last cell.
        </div>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-test="host"]')!;
    const sidebar = canvasElement.querySelector<HTMLElement>('[data-test="sidebar"]')!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const cellWidth = () => parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cells = () => host.getBoundingClientRect().width / cellWidth();
    const wholeCells = (n: number) => Math.abs(n - Math.round(n)) < 0.01;
    await waitFor(() => expect(wholeCells(cells())).toBe(true), { timeout: 10_000 });
    const before = Math.round(cells());
    // A sibling shrinking grows the host's slot: observed, re-measured,
    // still whole cells.
    sidebar.style.width = "4rem";
    await waitFor(
      () => {
        expect(Math.round(cells())).toBeGreaterThan(before);
        expect(wholeCells(cells())).toBe(true);
      },
      { timeout: 10_000 },
    );
    sidebar.style.width = "";
    await waitFor(() => expect(Math.round(cells())).toBe(before), { timeout: 10_000 });
  },
};
