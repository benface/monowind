import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { clusterAdvances, wrapLines } from "monowind";
import { copyText, expectGridOnItsCells, pressAt, release } from "./helpers.ts";
import type { Point, PressInit } from "./helpers.ts";

/**
 * Wide and fallback glyphs (specs/wide-characters.md): the grid stays
 * on its cells whatever the font draws, and in text mode the engine
 * routes the drag by cell and paints the selection on the grid.
 * Gestures are synthetic events — real clicks are not scriptable here.
 * Hidden from the sidebar and the sweep.
 */
const meta: Meta = {
  title: "Test / Wide",
  tags: ["!dev"],
};
export default meta;

export const Wide: StoryObj = {
  render: () => html`
    <mono-wind select="text">
      <p data-test="mixed" class="w-40">Latin 中文 한글 😀 ★ ✓ end of the line here.</p>
      <p data-test="second" class="mt-1 w-40">Second paragraph after the wide one.</p>
      <div data-test="box" class="mt-1 w-12 border px-1">日本語のテキスト</div>
      <textarea data-test="area" class="mt-1 w-12 border">日本語のテキストが折り返す</textarea>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const cell = (name: string, col: number, row: number): Point => {
      const rect = by(name).getBoundingClientRect();
      return { x: rect.left + (col + 0.5) * cellWidth, y: rect.top + (row + 0.5) * cellHeight };
    };
    const selection = () => document.getSelection()!.toString();
    const press = (name: string, at: Point, detail: number, init: PressInit = {}) =>
      pressAt(by(name), at, detail, init);
    const move = (at: Point) =>
      by("mixed").dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: at.x,
          clientY: at.y,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1,
        }),
      );
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // A selected cell's color is the theme's background (its own has
    // none here); the paint swaps the two.
    const painted = () =>
      Array.from(grid.querySelectorAll("span"))
        .filter((span) => span.style.color === "var(--mw-bg, canvas)")
        .map((span) => span.textContent)
        .join("");

    // Every row on its cells, whatever the fallback fonts draw.
    expectGridOnItsCells(host);
    // The bordered box wraps the ideographs two cells each: 8 clusters
    // in 10 content cells = 5 per row, two rows plus the border.
    expect(Math.round(by("box").getBoundingClientRect().height / cellHeight)).toBe(4);
    // The textarea's rows count its value at cluster widths (13 clusters,
    // 26 cells) against its native content width, plus the border.
    const area = by("area") as HTMLTextAreaElement;
    const areaStyle = getComputedStyle(area);
    const contentCells = Math.floor(
      (area.clientWidth - parseFloat(areaStyle.paddingLeft) - parseFloat(areaStyle.paddingRight)) /
        cellWidth,
    );
    const rows = Math.max(
      2,
      wrapLines(area.value, contentCells, { advances: clusterAdvances(area.value) }).length,
    );
    expect(rows).toBeGreaterThan(2);
    await waitFor(() =>
      expect(Math.round(area.getBoundingClientRect().height / cellHeight)).toBe(rows + 2),
    );

    // A press lands on the character under the cell — 中 at cells 6–7
    // — and the drag extends through the character under the pointer
    // (글 at 13–14), wide clusters whole.
    expect(press("mixed", cell("mixed", 7, 0), 1)).toBe(false);
    expect(selection()).toBe("");
    move(cell("mixed", 13, 0));
    expect(selection()).toBe("中文 한글");
    // Backward: through the character under the pointer.
    move(cell("mixed", 2, 0));
    expect(selection()).toBe("tin ");
    release();
    // Shift extends from the anchor; the copy is the engine's.
    expect(press("mixed", cell("mixed", 16, 0), 1, { shiftKey: true })).toBe(false);
    expect(selection()).toBe("中文 한글 😀");
    expect(copyText(host)).toBe("中文 한글 😀");
    release();
    // The painted highlight: the selected cells, inverted on the grid.
    await nextFrame();
    await waitFor(() => expect(painted()).toBe("中文 한글 😀"));

    // Double-click: the word; triple-click: the paragraph.
    press("mixed", cell("mixed", 11, 0), 2);
    expect(selection()).toBe("한글");
    release();
    press("mixed", cell("mixed", 11, 0), 3);
    expect(selection().trim()).toBe(by("mixed").textContent!.trim());
    release();

    // A press past a row's text lands after its last character; a drag
    // back to the row's start selects the row.
    expect(press("second", cell("second", 38, 0), 1)).toBe(false);
    move(cell("second", 0, 0));
    expect(selection()).toBe("Second paragraph after the wide one.");
    release();
    await nextFrame();
    await waitFor(() => expect(painted()).toBe("Second paragraph after the wide one."));
    document.getSelection()!.removeAllRanges();
    await nextFrame();
    await waitFor(() => expect(painted()).toBe(""));
  },
};
