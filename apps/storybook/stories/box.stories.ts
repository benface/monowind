import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { readyGrid } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Box Model",
};
export default meta;
export const BorderStyles: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div class="border border-neutral-400 px-3 py-1">solid</div>
        <div class="border border-dashed border-yellow-400 px-3 py-1">dashed</div>
        <div class="border border-double border-cyan-400 px-3 py-1">double</div>
        <div class="border border-dotted border-blue-400 px-3 py-1">dotted</div>
      </div>
    </mono-wind>
  `,
};

export const BorderWidths: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex gap-x-2 gap-y-1">
        <div class="border-2 border-emerald-400 px-3 py-1">border-2</div>
        <div class="border-3 border-double border-fuchsia-400 px-3 py-1">
          border-3 border-double
        </div>
      </div>
    </mono-wind>
  `,
};

export const BorderSides: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div class="border-t border-red-400 px-3 py-1">top</div>
        <div class="border-b border-red-400 px-3 py-1">bottom</div>
        <div class="border-y border-orange-400 px-3 py-1">top + bottom</div>
        <div class="border-x border-lime-400 px-3 py-1">left + right</div>
        <div
          class="border border-t-cyan-400 border-r-yellow-400 border-b-fuchsia-400 border-l-red-500 px-3 py-1"
        >
          per-side colors
        </div>
        <div
          class="border [border-right-style:dashed] [border-bottom-style:double] [border-left-style:dotted] px-3 py-1"
        >
          per-side styles
        </div>
      </div>
    </mono-wind>
  `,
};

/**
 * `border-radius` picks corner glyphs (specs/cell-model.md "Borders:
 * glyph mapping"): the set's registration nearest the radius — the
 * defaults' arcs from half a cell, per corner, a ring inside a cell
 * less, double with no arcs, a set keeping its own corners.
 */
export const BorderRadius: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-2">
        <div data-test="rounded" class="rounded border px-1">rounded</div>
        <div data-test="top" class="rounded-t-lg border px-1">rounded-t-lg</div>
        <div data-test="rings" class="rounded-lg border-2 px-1">border-2 rounded-lg</div>
        <div data-test="inner-square" class="rounded border-2 px-1">border-2 rounded</div>
        <div data-test="double" class="rounded border border-double px-1">double</div>
        <div data-test="dashed" class="rounded-full border border-dashed px-1">dashed</div>
        <div data-test="ascii" class="rounded border px-1 borders-ascii">ascii</div>
        <div data-test="tiny" class="rounded-[1px] border px-1">rounded-[1px]</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, width, height, measure } = await readyGrid(canvasElement);
    const cornersOf = (name: string, ring = 0) => {
      const el = by(name);
      const { rows, boxOf } = measure();
      const { row, col } = boxOf(el);
      const [right, bottom] = [col + width(el) - 1 - ring, row + height(el) - 1 - ring];
      const at = (r: number, c: number) => rows[r]![c];
      return [
        at(row + ring, col + ring),
        at(row + ring, right),
        at(bottom, col + ring),
        at(bottom, right),
      ].join("");
    };
    expect(cornersOf("rounded")).toBe("╭╮╰╯");
    expect(cornersOf("top")).toBe("╭╮└┘");
    expect(cornersOf("rings")).toBe("╭╮╰╯");
    expect(cornersOf("rings", 1)).toBe("╭╮╰╯");
    expect(cornersOf("inner-square")).toBe("╭╮╰╯");
    expect(cornersOf("inner-square", 1)).toBe("┌┐└┘");
    expect(cornersOf("double")).toBe("╔╗╚╝");
    expect(cornersOf("dashed")).toBe("╭╮╰╯");
    expect(cornersOf("ascii")).toBe("++++");
    expect(cornersOf("tiny")).toBe("┌┐└┘");
  },
};

export const NestedBorders: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="border border-neutral-400">
        <div class="border border-dashed border-neutral-500">
          <div class="border border-dotted border-neutral-600 px-3 py-1">three levels deep</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Margin: StoryObj = {
  render: () => html`
    <mono-wind class="-m-4">
      <div class="min-h-dvh border border-dashed border-neutral-500 px-1">
        <div class="max-w-50 border border-neutral-500 px-1">
          <div class="relative z-10 -my-1 border border-red-400 px-1">-my-1</div>
          <div class="mb-2 border border-cyan-400 px-1">mb-2</div>
          <div class="mt-1 border border-yellow-400 px-1">mt-1 (collapses to 2, not 3)</div>
          <div class="mx-auto w-min max-w-full border border-emerald-400 px-1">w-min mx-auto</div>
          <div class="mx-auto w-max max-w-full border border-amber-400 px-1">w-max mx-auto</div>
        </div>
      </div>
    </mono-wind>
  `,
};
