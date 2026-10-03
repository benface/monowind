import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import { pressAt, readyHost, readyHosts, release, textWith } from "./helpers.ts";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";

const meta: Meta = {
  title: "Features / Select",
  // Test-only (the toolbar's global Select toggle is the showcase):
  // hidden from the sidebar, still exercised by the test runner.
  tags: ["!dev", "!golden"],
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
    await readyHosts(canvasElement);
    const defaultHost = canvasElement.querySelector<MonoWindElement>('[data-test="default"]')!;
    const textHost = canvasElement.querySelector<MonoWindElement>('[data-test="text"]')!;
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
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    const line = canvasElement.querySelector<HTMLElement>('[data-test="line"]')!;
    const selection = window.getSelection()!;
    const anchor = textWith(grid, "bravo");
    const from = anchor.data.indexOf("bravo");
    selection.setBaseAndExtent(anchor, from, anchor, from + 13);
    expect(selection.toString()).toBe("bravo charlie");

    // A one-shot repaint (color change, no transition).
    line.classList.add("text-rose-400");
    await waitFor(() => expect(textWith(grid, "bravo").parentElement!.style.color).not.toBe(""));
    expect(selection.toString(), "survives a restyle repaint").toBe("bravo charlie");

    // A fade: repaints every frame for ~300ms, selection intact
    // throughout (checked mid-fade and at the settled end).
    line.classList.add("transition-colors", "duration-300");
    line.classList.replace("text-rose-400", "text-cyan-400");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(selection.toString(), "survives mid-fade").toBe("bravo charlie");
    await waitFor(() =>
      expect(textWith(grid, "bravo").parentElement!.style.color).toBe(getComputedStyle(line).color),
    );
    expect(selection.toString(), "survives the whole fade").toBe("bravo charlie");
  },
};

/** A text-mode press on the host's text takes the focus off what held
 * it, a field on the page too, as the press the engine takes over would
 * have: the copy command follows the selection. */
export const TextPressTakesFocus: StoryObj = {
  render: () => html`
    <input data-test="field" value="elsewhere" />
    <mono-wind select="text"><p>Hello copy world</p></mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const field = canvasElement.querySelector<HTMLInputElement>('[data-test="field"]')!;
    field.focus();
    const paragraph = host.querySelector("p")!;
    const { left, top, height } = paragraph.getBoundingClientRect();
    expect(pressAt(paragraph, { x: left + 2, y: top + height / 2 }, 1)).toBe(false);
    release();
    expect(document.activeElement).not.toBe(field);
  },
};
