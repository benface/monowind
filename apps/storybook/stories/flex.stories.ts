import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";
import { expectBrowserRowsToMatchEngine } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Flex",
};
export default meta;

const cellsOf = (el: HTMLElement, name: string): number => Number(el.style.getPropertyValue(name));

export const JustifyContent: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex justify-start gap-1 border border-neutral-500 px-1">
          <div>justify</div>
          <div>start</div>
        </div>
        <div class="flex justify-center gap-1 border border-neutral-500 px-1">
          <div>justify</div>
          <div>center</div>
        </div>
        <div class="flex justify-end gap-1 border border-neutral-500 px-1">
          <div>justify</div>
          <div>end</div>
        </div>
        <div class="flex justify-between border border-neutral-500 px-1">
          <div>justify</div>
          <div>between</div>
        </div>
        <div class="flex justify-around border border-neutral-500 px-1">
          <div>justify</div>
          <div>around</div>
        </div>
        <div class="flex justify-evenly border border-neutral-500 px-1">
          <div>justify</div>
          <div>evenly</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const AlignItems: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex min-h-7 items-center gap-1 border border-neutral-500 px-1">
        <div class="border border-cyan-400 px-1">center</div>
        <div class="self-start border border-yellow-400 px-1">self-start</div>
        <div class="self-end border border-fuchsia-400 px-1">self-end</div>
        <div class="self-stretch border border-emerald-400 px-1">self-stretch</div>
      </div>
    </mono-wind>
  `,
};

export const AlignContent: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div
          class="flex min-h-10 max-w-32 flex-wrap content-start gap-x-1 border border-neutral-500 px-1"
        >
          <div class="border border-cyan-400 px-1">content</div>
          <div class="border border-cyan-400 px-1">start</div>
          <div class="border border-cyan-400 px-1">packs lines up</div>
        </div>
        <div
          class="flex min-h-10 max-w-32 flex-wrap content-center gap-x-1 border border-neutral-500 px-1"
        >
          <div class="border border-yellow-400 px-1">content</div>
          <div class="border border-yellow-400 px-1">center</div>
          <div class="border border-yellow-400 px-1">centers lines</div>
        </div>
        <div
          class="flex min-h-10 max-w-32 flex-wrap content-between gap-x-1 border border-neutral-500 px-1"
        >
          <div class="border border-fuchsia-400 px-1">content</div>
          <div class="border border-fuchsia-400 px-1">between</div>
          <div class="border border-fuchsia-400 px-1">spreads lines</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const GrowShrinkBasis: StoryObj = {
  name: "Grow / Shrink / Basis",
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex gap-1">
          <div class="shrink-0 border border-yellow-400 px-1">doesn't grow or shrink</div>
          <div class="min-w-24 grow border border-emerald-400 px-1">grows + min width</div>
          <div class="border border-neutral-500 px-1">doesn't grow, but shrinks</div>
        </div>
        <div class="flex gap-1">
          <div class="flex-1 border border-cyan-400 px-1">flex-1</div>
          <div class="flex-1 border border-cyan-400 px-1">flex-1 with much longer content</div>
          <div class="flex-1 border border-cyan-400 px-1">flex-1</div>
        </div>
        <div class="flex gap-1">
          <div class="basis-24 border border-emerald-400 px-1">basis-24</div>
          <div class="grow border border-yellow-400 px-1">grow</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Wrap: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-40 flex-wrap gap-x-1 border border-neutral-500 px-1">
        <div class="border border-cyan-400 px-1">first</div>
        <div class="border border-cyan-400 px-1">second item</div>
        <div class="border border-cyan-400 px-1">a third one</div>
        <div class="border border-cyan-400 px-1">fourth</div>
        <div class="border border-cyan-400 px-1">five</div>
      </div>
    </mono-wind>
  `,
};

export const ReverseAndOrder: StoryObj = {
  name: "Reverse & Order",
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex flex-row-reverse gap-1 border border-neutral-500 px-1">
          <button class="border border-cyan-400 px-1">first</button>
          <button class="border border-cyan-400 px-1">second</button>
          <button class="border border-cyan-400 px-1">third</button>
        </div>
        <div class="flex gap-1 border border-neutral-500 px-1">
          <button class="order-3 border border-yellow-400 px-1">order-3</button>
          <button class="order-1 border border-yellow-400 px-1">order-1</button>
          <button class="order-2 border border-yellow-400 px-1">order-2</button>
        </div>
      </div>
    </mono-wind>
  `,
};

export const AutoMargins: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex border border-neutral-500 px-1">
          <div class="me-auto">me-auto</div>
          <div>end</div>
        </div>
        <div class="flex border border-neutral-500 px-1">
          <div>start</div>
          <div class="ms-auto">ms-auto</div>
        </div>
        <div class="flex min-h-5 border border-neutral-500 px-1">
          <div class="mx-auto my-auto">mx-auto my-auto</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Column: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex min-h-16 flex-col border border-neutral-500 px-1">
        <div class="border border-cyan-400 px-1">header</div>
        <div class="grow border border-emerald-400 px-1">
          content section that grows to fill the container, with a lot of text in it so we can see
          that the default height is a minimum, not a fixed height
        </div>
        <div class="border border-cyan-400 px-1">footer</div>
      </div>
    </mono-wind>
  `,
};

export const GapDecorations: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-2">
        <div
          class="flex border border-double border-neutral-500 rule rule-neutral-500 rule-double"
          data-test="row"
        >
          <div class="grow px-1">files</div>
          <div class="grow px-1">edit</div>
          <div class="grow px-1">view</div>
        </div>
        <div class="flex flex-col rule-neutral-500 rule-dashed rule-y" data-test="column">
          <div>first entry</div>
          <div>second entry</div>
          <div>third entry</div>
        </div>
        <div class="flex max-w-12 flex-wrap gap-1 rule rule-cyan-400">
          <div>rule</div>
          <div>break</div>
          <div>normal</div>
        </div>
        <div class="flex max-w-12 flex-wrap gap-1 rule rule-cyan-400 rule-break-intersection">
          <div>rule</div>
          <div>break</div>
          <div>intersection</div>
        </div>
        <div class="flex items-start gap-5 rule-fuchsia-400 rule-inset-1 rule-x">
          <div class="flex-1">
            Insets: rule-inset-1 retracts each rule one cell from both ends of its band — see the
            top and bottom of the verticals between these columns.
          </div>
          <div class="flex-1">
            The middle column carries enough text to wrap onto several lines at a medium viewport
            width, giving the rules some height.
          </div>
          <div class="flex-1">Last column with almost no text.</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    // `rule-x` with no gap floors the gap at the rule width: adjacent
    // items sit exactly one cell apart, the rule cell.
    const row = canvasElement.querySelector<HTMLElement>('[data-test="row"]')!;
    const [a, b] = Array.from(row.querySelectorAll<HTMLElement>(":scope > div"));
    expect(cellsOf(b!, "--mw-x")).toBe(cellsOf(a!, "--mw-x") + cellsOf(a!, "--mw-w") + 1);
    // Same in the column, between stacked items.
    const column = canvasElement.querySelector<HTMLElement>('[data-test="column"]')!;
    const [c, d] = Array.from(column.querySelectorAll<HTMLElement>(":scope > div"));
    expect(cellsOf(d!, "--mw-y")).toBe(cellsOf(c!, "--mw-y") + cellsOf(c!, "--mw-h") + 1);
    // Flex's slice of the segment features (specs/gap-decorations.md
    // "Segments"; `rule-visibility-items` is grid/multicol-only):
    // normal (= none in flex): the row rule runs through the line-1
    // column gap, teeing the vertical that ends there.
    const lines = host.toPlainText().split("\n");
    const lineWith = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(lines[lineWith("normal") - 1]).toContain("┴");
    // intersection: a hole where the line-1 column gap crosses.
    expect(lines[lineWith("intersection") - 1]).toMatch(/─+ ─+/);
    // inset: the verticals between the columns start one row down and
    // stop one row up — the first text row has no rule glyph.
    const firstRow = lineWith("Insets:");
    expect(lines[firstRow]).not.toContain("│");
    expect(lines[firstRow + 1]).toContain("│");
  },
};
