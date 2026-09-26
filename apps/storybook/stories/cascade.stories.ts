import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { cellSize, expectOnItsCells, paintedSpan, readyHost, testHooks } from "./helpers.ts";

/**
 * The companion's locks against an author's strongest declarations
 * (styles.css, the header): a utility's `!` modifier and an unlayered
 * `!important` rule reach the engine's read, which paints them in the
 * grid, and the light element keeps its cells, its typography, and its
 * own paint off. The grid-mode pointer-events rules stay out of the
 * lock layer, so `pointer-events-none!` still wins (specs/cell-model.md
 * "Pointer states"). Hidden from the sidebar and the story sweep.
 */
const meta: Meta = {
  title: "Test / Cascade",
  tags: ["!dev", "!golden"],
};
export default meta;

export const Important: StoryObj = {
  render: () => html`
    <style>
      .cascade-ruled {
        background-color: #dc2626 !important;
        color: #fafafa !important;
        font-size: 24px !important;
        width: 90px !important;
        padding-left: 20px !important;
        margin-top: 12px !important;
      }
    </style>
    <mono-wind class="border border-neutral-500 p-1">
      <div data-test="utility" class="mt-3! w-22.5! bg-[#f97316]! pl-5! text-2xl! text-[#fafafa]!">
        Utility
      </div>
      <div data-test="ruled" class="cascade-ruled">Ruled</div>
      <p>
        <button data-test="plain">Plain</button>
        <button data-test="through" class="pointer-events-none!">Through</button>
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cell = cellSize(host);
    const hostStyle = getComputedStyle(host);
    const locked = async (name: string, text: string, background: string) => {
      const el = by(name);
      const style = getComputedStyle(el);
      const cells = (property: string) => parseFloat(el.style.getPropertyValue(property)) || 0;
      // The grid paints the authored colors; the light element paints nothing.
      const span = paintedSpan(host, text)!;
      expect(span.style.backgroundColor).toBe(background);
      expect(span.style.color).toBe("rgb(250, 250, 250)");
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
      // Typography is the grid's.
      expect(style.fontSize).toBe(hostStyle.fontSize);
      // Geometry is the engine's cells.
      await expectOnItsCells(host, el);
      const width = el.getBoundingClientRect().width;
      expect(Math.abs(width - cells("--mw-w") * cell.width)).toBeLessThan(1);
      const padding = (cells("--mw-pl") + cells("--mw-bl")) * cell.width;
      expect(Math.abs(parseFloat(style.paddingLeft) - padding)).toBeLessThan(1);
      expect(style.marginTop).toBe("0px");
    };
    await locked("utility", "Utility", "rgb(249, 115, 22)");
    await locked("ruled", "Ruled", "rgb(220, 38, 38)");
    // The pointer-events rules stay unlayered: an important utility wins.
    expect(getComputedStyle(by("plain")).pointerEvents).toBe("auto");
    expect(getComputedStyle(by("through")).pointerEvents).toBe("none");
  },
};
