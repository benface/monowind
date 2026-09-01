import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";

const meta: Meta = {
  title: "Features / Select",
  // Test-only (the toolbar's global Select toggle is the showcase):
  // hidden from the sidebar, still exercised by the test runner.
  tags: ["!dev"],
};
export default meta;

const CONTENT = html`
  <div class="flex justify-between border border-cyan-400 px-1 text-yellow-400">
    <div>left</div>
    <div>right</div>
  </div>
`;

export const SelectProp: StoryObj = {
  render: () => html`
    <mono-wind data-test="default">${CONTENT}</mono-wind>
    <mono-wind select="text" class="mt-1" data-test="text">${CONTENT}</mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const defaultHost = canvasElement.querySelector<MonoWindElement>('[data-test="default"]')!;
    const textHost = canvasElement.querySelector<MonoWindElement>('[data-test="text"]')!;
    await waitFor(() => expect(textHost).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // The default reflects onto the attribute (the single place it
    // lives), so an attribute-less host reads back select="grid".
    expect(defaultHost.getAttribute("select")).toBe("grid");
    // toPlainText() returns the shadow grid's text — same for both hosts,
    // since every host renders through the unified grid.
    const art = defaultHost.toPlainText();
    expect(art.split("\n")[0]).toMatch(/^┌─+┐$/);
    expect(art).toContain("│ left");
    expect(art).toContain("right │");
    expect(textHost.toPlainText()).toBe(art);
    // The grid <pre> in the shadow paints identically in both — same
    // renderer, same input, same output.
    const defaultGrid = defaultHost.shadowRoot!.getElementById("grid")!;
    const textGrid = textHost.shadowRoot!.getElementById("grid")!;
    expect(defaultGrid.textContent).toBe(art);
    expect(textGrid.textContent).toBe(art);
    // Colors survive as spans (paint from the layout's leaf styles).
    const gridColors = new Set(
      Array.from(textGrid.querySelectorAll("span"), (s) => getComputedStyle(s).color),
    );
    expect(gridColors.size).toBeGreaterThanOrEqual(2);
    // Light-DOM text is visually inert (color: transparent) — the grid
    // is what the eye sees.
    const slotted = textHost.querySelector<HTMLElement>(":scope > div")!;
    expect(getComputedStyle(slotted).color).toBe("rgba(0, 0, 0, 0)");
    // Selection semantics differ: grid is user-selectable under the
    // select="grid" default, inert under select="text". Read via
    // getPropertyValue — WebKit surfaces user-select only as
    // `-webkit-user-select` on the CSSStyleDeclaration property list.
    const userSelect = (el: HTMLElement) =>
      getComputedStyle(el).getPropertyValue("user-select") ||
      getComputedStyle(el).getPropertyValue("-webkit-user-select");
    expect(userSelect(defaultGrid)).toBe("text");
    expect(userSelect(textGrid)).toBe("none");
  },
};
