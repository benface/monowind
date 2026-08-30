import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";

const meta: Meta = {
  title: "Features / Plain Text",
  // Test-only (the toolbar's global Plain text toggle is the showcase):
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

export const PlainTextMode: StoryObj = {
  render: () => html`
    <mono-wind data-test="layered">${CONTENT}</mono-wind>
    <mono-wind plain-text class="mt-1" data-test="plain-text">${CONTENT}</mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const layered = canvasElement.querySelector<MonoWindElement>('[data-test="layered"]')!;
    const plainHost = canvasElement.querySelector<MonoWindElement>('[data-test="plain-text"]')!;
    await waitFor(() => expect(plainHost).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // toPlainText() is the golden-test mirror: borders as glyphs, text on
    // its rows, spacing real.
    const art = layered.toPlainText();
    expect(art.split("\n")[0]).toMatch(/^┌─+┐$/);
    expect(art).toContain("│ left");
    expect(art).toContain("right │");
    // The `plain-text` attribute renders the same text as a selectable shadow
    // <pre> — decorations hidden, slotted content invisible and inert.
    const pre = plainHost.shadowRoot!.getElementById("plain-text")!;
    expect(pre.textContent).toBe(plainHost.toPlainText());
    expect(pre.textContent).toBe(art);
    // Colors survive the mode as spans (a copy still yields pure text).
    const spanColors = new Set(
      Array.from(pre.querySelectorAll("span"), (s) => getComputedStyle(s).color),
    );
    expect(spanColors.size).toBeGreaterThanOrEqual(2);
    const slotted = plainHost.querySelector<HTMLElement>(":scope > div")!;
    expect(getComputedStyle(slotted).visibility).toBe("hidden");
    const decorations = plainHost.shadowRoot!.getElementById("decorations")!;
    expect(getComputedStyle(decorations).display).toBe("none");
  },
};
