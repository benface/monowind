import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { glyphSetFor, registerBorderGlyphs } from "monowind";
import { besideNative, cellSize, readyGrid, type Engine, type Unit } from "./helpers.ts";

// A set drawing 2px as two rings of the default lines (the rings a
// theme without heavy glyphs registers, specs/theming.md).
if (!glyphSetFor("rings"))
  registerBorderGlyphs("rings", { solid: { weights: [{ width: 2, cells: 2 }] } });

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

/**
 * `border-width` is a WEIGHT the glyph set interprets (specs/cell-model.md
 * "Box model"): the defaults draw 2px and up heavy in one cell (double
 * has no heavier), a corner between weights draws the heavier, a set
 * without heavy glyphs draws two rings (`ascii`, `single`, `rounded`,
 * `blocks`), and `cp437` draws double.
 */
export const BorderWidths: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div class="border border-purple-500 px-3 py-1">border</div>
        <div data-test="heavy" class="border-2 border-emerald-400 px-3 py-1">border-2</div>
        <div class="border-2 border-dashed border-yellow-400 px-3 py-1">border-2 border-dashed</div>
        <div class="border-2 border-dotted border-blue-400 px-3 py-1">border-2 border-dotted</div>
        <div data-test="double" class="border-3 border-double border-fuchsia-400 px-3 py-1">
          border-3 border-double
        </div>
        <div data-test="mixed" class="border-x-2 border-y border-emerald-400 px-3 py-1">
          border-x-2 border-y
        </div>
        <div data-test="ascii" class="border-2 border-neutral-400 px-3 py-1 borders-ascii">
          border-2 borders-ascii
        </div>
        <div data-test="cp437" class="border-2 border-neutral-400 px-3 py-1 borders-cp437">
          border-2 borders-cp437
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, cells, measure } = await readyGrid(canvasElement);
    // The box's top-left corner, the top edge's first cell, and the
    // left edge's first cell.
    const cornerOf = (name: string) => {
      const { rows, boxOf } = measure();
      const { row, col } = boxOf(by(name));
      return rows[row]!.slice(col, col + 2) + rows[row + 1]![col];
    };
    expect(cornerOf("heavy")).toBe("┏━┃");
    expect(cornerOf("double")).toBe("╔═║");
    // A heavy side meets a light one at Unicode's mixed corner.
    expect(cornerOf("mixed")).toBe("┎─┃");
    expect(cornerOf("ascii")).toBe("+-|");
    expect(cornerOf("cp437")).toBe("╔═║");
    // One cell per edge for heavy and double, two for the ascii rings.
    expect(cells(by("heavy"), "--mw-bt")).toBe(1);
    expect(cells(by("cp437"), "--mw-bt")).toBe(1);
    expect(cells(by("ascii"), "--mw-bt")).toBe(2);
  },
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
 * less (under a set drawing 2px as two rings), heavy and double with
 * no arcs, a set keeping its own corners.
 */
export const BorderRadius: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div data-test="rounded" class="rounded border px-1">rounded</div>
        <div data-test="top" class="rounded-t-lg border px-1">rounded-t-lg</div>
        <div data-test="heavy" class="rounded-lg border-2 px-1">border-2 rounded-lg</div>
        <div data-test="rings" class="rounded-lg border-2 px-1 [--mw-border-glyphs:rings]">
          rings rounded-lg
        </div>
        <div data-test="inner-square" class="rounded border-2 px-1 [--mw-border-glyphs:rings]">
          rings rounded
        </div>
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
    expect(cornersOf("heavy")).toBe("┏┓┗┛");
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

/** `aspect-ratio` is physical (specs/cell-model.md "Aspect ratio"): a
 * square looks square whatever the font's cell, its derived side
 * rounded to whole cells. Backgrounds show the box; a border's glyphs
 * draw mid-cell, half a row inside it. */
export const AspectRatio: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap items-start gap-2">
        <div class="aspect-square w-12 bg-cyan-800 px-1 text-white">square</div>
        <div class="aspect-video w-24 bg-yellow-700 px-1 text-white">video</div>
        <div class="aspect-3/2 h-8 bg-purple-800 px-1 text-white">h-8 3/2</div>
      </div>
    </mono-wind>
  `,
};

/** The aspect-ratio probes (specs/cell-model.md, flex.md, grid.md,
 * positioning.md), each a `data-test="box"` in its setting, lengths in
 * `u`; `departs` names the engines the spec says depart from CSS, and
 * `rounds` the roundings on the way to the box, each half a cell. */
const aspectCases = (u: Unit): { markup: string; departs?: Engine[]; rounds?: number }[] => {
  const words = "aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo";
  return [
    { markup: `<div data-test="box" style="width:${u(20)};aspect-ratio:1"></div>` },
    { markup: `<div data-test="box" style="aspect-ratio:4/1"></div>` },
    { markup: `<div data-test="box" style="height:${u(10, "y")};aspect-ratio:16/9"></div>` },
    { markup: `<div data-test="box" style="max-height:${u(5, "y")};aspect-ratio:1"></div>` },
    { markup: `<div data-test="box" style="min-height:${u(20, "y")};aspect-ratio:4/1"></div>` },
    { markup: `<div data-test="box" style="width:${u(12)};aspect-ratio:4/1">${words}</div>` },
    {
      markup: `<div data-test="box" style="width:${u(12)};aspect-ratio:4/1;overflow:hidden">${words}</div>`,
    },
    {
      markup: `<div style="width:${u(20)};aspect-ratio:2"><div data-test="box" style="height:50%"></div></div>`,
      rounds: 2,
    },
    {
      markup: `<div style="float:left"><div data-test="box" style="height:${u(5, "y")};aspect-ratio:2"></div></div>`,
    },
    {
      markup: `<span data-test="box" style="display:inline-block;width:${u(10)};aspect-ratio:2"></span>`,
    },
    {
      markup: `<div style="display:flex;height:${u(10, "y")}"><div data-test="box" style="aspect-ratio:1"></div></div>`,
    },
    {
      markup: `<div style="display:flex;align-items:start"><div data-test="box" style="flex:1 1 0%;aspect-ratio:4/1"></div></div>`,
    },
    {
      markup: `<div style="display:flex"><div data-test="box" style="width:${u(8)};aspect-ratio:1"></div><div style="width:${u(1)};height:${u(10, "y")}"></div></div>`,
    },
    {
      markup: `<div style="display:flex;flex-direction:column"><div data-test="box" style="aspect-ratio:4/1"></div></div>`,
    },
    {
      markup: `<div style="display:flex;flex-direction:column;align-items:start"><div data-test="box" style="aspect-ratio:4/1">ab</div></div>`,
      departs: ["webkit"],
    },
    {
      markup: `<div style="display:grid;grid-template-columns:${u(20)}"><div data-test="box" style="aspect-ratio:16/9"></div></div>`,
    },
    {
      markup: `<div style="display:grid;grid-template-columns:${u(20)};grid-template-rows:${u(20, "y")}"><div data-test="box" style="aspect-ratio:16/9"></div></div>`,
    },
    {
      markup: `<div style="display:grid;grid-template-columns:${u(20)};grid-template-rows:${u(20, "y")}"><div data-test="box" style="aspect-ratio:2;justify-self:start">ab</div></div>`,
      departs: ["chromium"],
    },
    {
      markup: `<div style="display:grid;grid-template-columns:${u(10)} ${u(10)}"><div data-test="box" style="aspect-ratio:2;align-self:stretch"></div><div style="height:${u(20, "y")}"></div></div>`,
      departs: ["firefox"],
    },
    {
      markup: `<div style="display:grid;grid-template-columns:auto 1fr"><div data-test="box" style="height:${u(5, "y")};aspect-ratio:2"></div><div>x</div></div>`,
    },
    {
      markup: `<div style="position:relative;height:${u(30, "y")}"><div data-test="box" style="position:absolute;inset:0;aspect-ratio:2"></div></div>`,
    },
    {
      markup: `<div style="position:relative;height:${u(30, "y")}"><div data-test="box" style="position:absolute;top:0;bottom:${u(25, "y")};left:0;aspect-ratio:2"></div></div>`,
    },
    {
      markup: `<div style="position:relative;height:${u(30, "y")}"><div data-test="box" style="position:absolute;top:0;left:0;aspect-ratio:2">abcd</div></div>`,
    },
  ];
};

/** A case's `box` against the browser's, in cells on each axis. */
const boxDrift = (host: HTMLElement, native: HTMLElement) => {
  const cell = cellSize(host);
  const box = host.querySelector<HTMLElement>('[data-test="box"]')!;
  const want = native.querySelector('[data-test="box"]')!.getBoundingClientRect();
  const cells = (name: string) => Number(box.style.getPropertyValue(name));
  return {
    width: Math.abs(cells("--mw-w") - want.width / cell.width),
    height: Math.abs(cells("--mw-h") - want.height / cell.height),
  };
};

/** Each aspect-ratio probe beside the browser's: its box within half a
 * cell of the browser's on both axes per rounding on the way. */
export const AspectRatioAgainstNative: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(
    aspectCases,
    (host, native, i) => {
      const { rounds = 1 } = aspectCases(() => "")[i]!;
      const drift = boxDrift(host, native);
      expect(drift.width, `case ${i} width`).toBeLessThan(rounds * 0.5 + 0.01);
      expect(drift.height, `case ${i} height`).toBeLessThan(rounds * 0.5 + 0.01);
    },
    "w-40",
  ),
};

/** Percentages beside margins (specs/cell-model.md "Units and value
 * mapping"): each case's `box`, lengths in `u`, its percent width or
 * limit against its parent's width, the margins aside. */
const percentCases = (u: Unit): string[] => {
  const box = (style: string) => `<div data-test="box" style="${style}">x</div>`;
  return [
    box(`width:100%;margin:0 ${u(4)}`),
    box(`width:50%;margin-left:${u(2)}`),
    box(`width:100%;max-width:50%;margin:0 ${u(2)}`),
    box(`float:left;width:50%;margin-right:${u(2)}`),
    `<div style="display:flex;flex-direction:column">${box(`width:100%;margin:0 ${u(4)}`)}</div>`,
    `<div style="display:grid;grid-template-columns:100%">${box(
      `width:50%;margin-left:${u(2)};justify-self:start`,
    )}</div>`,
    `aa <span data-test="box" style="display:inline-block;width:50%;margin:0 ${u(2)}">x</span>`,
  ];
};

/** Each percentage case beside the browser's: its box's width within
 * half a cell. */
export const PercentBesideMargins: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(percentCases, (host, native, i) =>
    expect(boxDrift(host, native).width, `case ${i}`).toBeLessThanOrEqual(0.5),
  ),
};

/** Baseline alignment (specs/flex.md, grid.md, table.md): each case's
 * words, lengths in `u`, in a flex row, a div-table and a grid whose
 * boxes their padding or a box drawing no line sets apart. */
const baselineCases = (u: Unit): string[] => [
  `<div style="display:flex;align-items:baseline;gap:${u(1)}"><div>alpha</div><div style="padding-top:${u(1, "y")}">bravo</div><div><div style="padding-top:${u(2, "y")}">charlie</div></div></div>`,
  `<div style="display:flex;align-items:baseline;gap:${u(1)}"><div style="width:${u(2)};height:${u(3, "y")};background:gray"></div><div>delta</div></div>`,
  `<div style="display:table"><div style="display:table-row"><div style="display:table-cell">echo</div><div style="display:table-cell;padding-top:${u(1, "y")}">foxtrot</div></div></div>`,
  `<div style="display:grid;grid-template-columns:1fr 1fr;align-items:baseline"><div>golf</div><div style="padding-top:${u(2, "y")}">hotel</div></div>`,
];

export const Baseline: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(baselineCases),
};
