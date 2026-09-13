import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { copyText, dragTo, pressAt, release } from "./helpers.ts";
import type { Point, PressInit } from "./helpers.ts";

/**
 * `<mono-qr>` behavior (specs/qr-code.md): the transcript matches the
 * grid, selection and copy read it, attributes re-render, the value
 * stays in the light DOM; and the fixture the visual decode spec
 * screenshots. Hidden from the sidebar and the sweep.
 */
const meta: Meta = {
  title: "Test / QR",
  tags: ["!dev", "!golden"],
};
export default meta;

const VALUE = "https://play.monowind.benface.com";

export const Gestures: StoryObj = {
  render: () => html`
    <mono-wind select="text">
      <p data-test="lead">Scan the code below.</p>
      <mono-qr data-test="code" class="px-2 py-1">12345</mono-qr>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const code = canvasElement.querySelector<HTMLElement>("[data-test='code']")!;
    const grid = host.shadowRoot!.getElementById("grid")!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const transcript = code.shadowRoot!.getElementById("mirror")!;
    const mirror = () => transcript.textContent!;
    const lines = () => mirror().split("\n");

    // The grid shows exactly the transcript's rows at the element's
    // content cells (the transcript sits inside the padding too).
    const gridRows = grid.textContent!.split("\n");
    const hostRect = host.getBoundingClientRect();
    const rect = transcript.getBoundingClientRect();
    const col = Math.round((rect.left - hostRect.left) / cellWidth);
    const row = Math.round((rect.top - hostRect.top) / cellHeight);
    const shown = lines().map((line, i) => gridRows[row + i]!.slice(col, col + line.length));
    expect(shown).toEqual(lines());
    expect(lines()).toHaveLength(11);

    // Gestures on the transcript, as on any text.
    const cell = (c: number, r: number): Point => ({
      x: rect.left + (c + 0.5) * cellWidth,
      y: rect.top + (r + 0.5) * cellHeight,
    });
    const press = (at: Point, detail: number, init: PressInit = {}) =>
      pressAt(code, at, detail, init);
    const move = (at: Point) => dragTo(code, at);
    expect(press(cell(2, 3), 1)).toBe(false);
    move(cell(8, 3));
    expect(copyText(host)).toBe(lines()[3]!.slice(2, 9));
    release();
    press(cell(2, 3), 2);
    expect(copyText(host)).toBe(lines()[3]);
    release();
    press(cell(2, 3), 3);
    expect(copyText(host).trim()).toBe(mirror().trim());
    release();
    document.getSelection()!.removeAllRanges();

    // The value stays in the light DOM for assistive technology.
    expect(code.textContent).toBe("12345");

    // An attribute change re-renders: scale 2 doubles the symbol.
    code.setAttribute("scale", "2");
    await waitFor(() => expect(lines()).toHaveLength(21));
    expect(lines()[0]).toHaveLength(42);
  },
};

/** The decode spec's fixture: a code in each font the repo ships —
 * the preview's JetBrains Mono and the dos theme's VGA face — with the
 * standard quiet zone as padding, the decoder's minimum. */
export const Fonts: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-2">
      <mono-wind class="p-1">
        <mono-qr data-test="qr-default" class="px-4 py-2">${VALUE}</mono-qr>
      </mono-wind>
      <mono-wind class="theme-dos p-1">
        <mono-qr data-test="qr-dos" class="px-4 py-2">${VALUE}</mono-qr>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    for (const host of Array.from(canvasElement.querySelectorAll<HTMLElement>("mono-wind"))) {
      await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    }
  },
};
