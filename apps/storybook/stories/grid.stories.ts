import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expectBrowserRowsToMatchEngine } from "./helpers.ts";

const meta: Meta = {
  title: "Features/Grid",
};
export default meta;

const readyHost = async (canvasElement: HTMLElement): Promise<HTMLElement> => {
  const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  return host;
};

const cellsOf = (el: HTMLElement, name: string): number => Number(el.style.getPropertyValue(name));

export const Columns: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-3 gap-x-1" data-test="cols">
        <div class="border border-cyan-400 px-1">one</div>
        <div class="border border-cyan-400 px-1">two with more text</div>
        <div class="border border-cyan-400 px-1">three</div>
        <div class="border border-yellow-400 px-1">four</div>
        <div class="col-span-2 border border-emerald-400 px-1">five col-span-2</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // grid-cols-3 = repeat(3, minmax(0, 1fr)): even columns regardless of
    // content — up to the ±1 cell of integer remainder distribution — that
    // fill the content box exactly. This also proves the degrid template
    // read survived (a failed fr parse could not divide).
    const container = canvasElement.querySelector<HTMLElement>('[data-test="cols"]')!;
    const items = Array.from(container.querySelectorAll<HTMLElement>(":scope > div"));
    const widths = items.slice(0, 3).map((el) => cellsOf(el, "--mw-w"));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(widths.reduce((s, w) => s + w, 0)).toBe(cellsOf(container, "--mw-w") - 2);
    // The span covers the second and third tracks plus the gap between.
    expect(cellsOf(items[4]!, "--mw-w")).toBe(widths[1]! + widths[2]! + 1);
  },
};

export const MixedTracks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-[6rem_1fr_auto] gap-1" data-test="mixed">
        <div class="border border-cyan-400 px-1">24-cell track</div>
        <div class="border border-yellow-400 px-1">1fr takes the leftover space</div>
        <div class="border border-fuchsia-400 px-1">auto</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const container = canvasElement.querySelector<HTMLElement>('[data-test="mixed"]')!;
    const [fixed, flexible, autoSized] = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > div"),
    );
    // 6rem = 24 cells; the auto track is its item's max-content ("auto" +
    // padding + borders = 8); 1fr absorbs the rest of the content box.
    expect(cellsOf(fixed!, "--mw-w")).toBe(24);
    expect(cellsOf(autoSized!, "--mw-w")).toBe(8);
    const containerCells = cellsOf(container, "--mw-w");
    expect(cellsOf(flexible!, "--mw-w")).toBe(containerCells - 24 - 8 - 2);
  },
};

export const Placement: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-4 gap-x-2 gap-y-1 *:min-w-0">
        <div class="col-span-2 col-start-2 border border-cyan-400 px-1">col-start-2 col-span-2</div>
        <div class="row-span-2 border border-yellow-400 px-1">row-span-2</div>
        <div class="border border-neutral-500 px-1">auto</div>
        <div class="border border-neutral-500 px-1">auto</div>
        <div class="col-span-full border border-emerald-400 px-1">col-span-full</div>
        <div class="-col-start-2 border border-fuchsia-400 px-1">-col-start-2</div>
      </div>
    </mono-wind>
  `,
  // row-span-2 stretches its leaf taller than its text, so the strict
  // lines-equal check doesn't apply.
  play: ({ canvasElement }) =>
    expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true }),
};

export const DenseFlow: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="grid grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="col-span-2 border border-cyan-400 px-1">span 2</div>
          <div class="col-span-2 border border-cyan-400 px-1">span 2 wraps</div>
          <div class="border border-yellow-400 px-1">sparse leaves the hole</div>
        </div>
        <div class="grid grid-flow-row-dense grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="col-span-2 border border-cyan-400 px-1">span 2</div>
          <div class="col-span-2 border border-cyan-400 px-1">span 2 wraps</div>
          <div class="border border-yellow-400 px-1">dense fills it</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const AutoFlowColumn: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid w-max grid-flow-col grid-rows-2 gap-x-2 gap-y-1">
        <div class="border border-cyan-400 px-1">a1</div>
        <div class="border border-cyan-400 px-1">a2</div>
        <div class="border border-yellow-400 px-1">b1</div>
        <div class="border border-yellow-400 px-1">b2</div>
        <div class="border border-fuchsia-400 px-1">c1</div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

const autoFillMarkup = html`
  <div id="fill-frame">
    <mono-wind>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(min(8rem,100%),1fr))] gap-x-1"
        data-test="fill"
      >
        <div class="border border-cyan-400 px-1">one</div>
        <div class="border border-cyan-400 px-1">two</div>
        <div class="border border-cyan-400 px-1">three</div>
        <div class="border border-cyan-400 px-1">four</div>
        <div class="border border-cyan-400 px-1">five</div>
      </div>
    </mono-wind>
  </div>
`;

export const AutoFill: StoryObj = {
  render: () => autoFillMarkup,
  // The resize sweep lives in the test-only AutoFillResize story below —
  // play functions also run in the dev preview, and the sweep's inline
  // frame width would freeze this story's responsiveness.
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const AutoFillResize: StoryObj = {
  // Test-only: hidden from the Storybook sidebar (and the visual suite),
  // still run by the Vitest story tests.
  tags: ["!dev"],
  render: () => autoFillMarkup,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const frame = canvasElement.querySelector<HTMLElement>("#fill-frame")!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const items = Array.from(
      canvasElement.querySelectorAll<HTMLElement>('[data-test="fill"] > div'),
    );
    const rowCount = () => new Set(items.map((el) => cellsOf(el, "--mw-y"))).size;
    // minmax(8rem, 1fr) = 32-cell minimum: count = ⌊(width + 1) ÷ 33⌋.
    // 68 columns fit 2 tracks (5 items → 3 rows); 100 columns fit 3
    // (→ 2 rows). The count resolving at LAYOUT time against the cell
    // grid is what this asserts — a static read could never adapt.
    frame.style.width = `${Math.floor(68 * cellWidth)}px`;
    await waitFor(() => expect(rowCount()).toBe(3), { timeout: 10_000 });
    frame.style.width = `${Math.floor(100 * cellWidth)}px`;
    await waitFor(() => expect(rowCount()).toBe(2), { timeout: 10_000 });
    await expectBrowserRowsToMatchEngine(canvasElement);
  },
};

export const Alignment: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="grid min-h-7 grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="self-start border border-cyan-400 px-1">self-start</div>
          <div class="self-center border border-yellow-400 px-1">self-center</div>
          <div class="self-end border border-fuchsia-400 px-1">self-end</div>
        </div>
        <div class="grid grid-cols-3 justify-items-center gap-x-1 border border-neutral-500 px-1">
          <div class="border border-cyan-400 px-1">centered</div>
          <div class="border border-cyan-400 px-1">in</div>
          <div class="justify-self-end border border-yellow-400 px-1">justify-self-end</div>
        </div>
        <div class="grid h-8 grid-cols-2 content-between gap-x-1 border border-neutral-500 px-1">
          <div class="border border-emerald-400 px-1">content</div>
          <div class="border border-emerald-400 px-1">between</div>
          <div class="border border-emerald-400 px-1">spreads</div>
          <div class="border border-emerald-400 px-1">rows</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};
