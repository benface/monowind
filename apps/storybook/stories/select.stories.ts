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
    // Light-DOM ink is invisible (text-fill-color: transparent; the
    // computed `color` stays live for animation sampling) — the grid is
    // what the eye sees.
    const slotted = textHost.querySelector<HTMLElement>(":scope > div")!;
    expect(getComputedStyle(slotted).webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
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

/** A live grid selection must survive repaints: paintGrid rebuilds the
 * <pre>'s nodes (invalidating any Range), so it captures the selection
 * as flat offsets and restores it onto the new nodes (paint.ts). The
 * fade covers the worst case — a repaint EVERY frame for its whole
 * duration. */
export const SelectionSurvivesRepaints: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-max border px-1" data-test="line">alpha bravo charlie delta</div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const line = canvasElement.querySelector<HTMLElement>('[data-test="line"]')!;
    const textNodeWith = (needle: string): Text => {
      const walker = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !(node as Text).data.includes(needle)) node = walker.nextNode();
      return node as Text;
    };
    const selection = window.getSelection()!;
    const anchor = textNodeWith("bravo");
    const from = anchor.data.indexOf("bravo");
    selection.setBaseAndExtent(anchor, from, anchor, from + 13);
    expect(selection.toString()).toBe("bravo charlie");

    // A one-shot repaint (color change, no transition).
    line.classList.add("text-rose-400");
    await waitFor(() => expect(textNodeWith("bravo").parentElement!.style.color).not.toBe(""), {
      timeout: 10_000,
    });
    expect(selection.toString(), "survives a restyle repaint").toBe("bravo charlie");

    // A fade: repaints every frame for ~300ms, selection intact
    // throughout (checked mid-fade and at the settled end).
    line.classList.add("transition-colors", "duration-300");
    line.classList.replace("text-rose-400", "text-cyan-400");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(selection.toString(), "survives mid-fade").toBe("bravo charlie");
    await waitFor(
      () =>
        expect(textNodeWith("bravo").parentElement!.style.color).toBe(getComputedStyle(line).color),
      { timeout: 10_000 },
    );
    expect(selection.toString(), "survives the whole fade").toBe("bravo charlie");
  },
};
