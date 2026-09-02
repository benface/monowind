import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import { registerLeafRenderer } from "monowind";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Public leaf-renderer API (specs/leaf-renderers.md): a registered
 * custom element supplies its own grid content — children skipped,
 * light DOM untouched (a11y + select semantics), paint runs on the
 * grid, declared attributes triggering re-renders.
 */
const meta: Meta = {
  title: "Features / Leaf renderers",
  // Test-only: the API's real showcase arrives with <mono-ascii>.
  tags: ["!dev"],
};
export default meta;

if (!customElements.get("test-leaf")) {
  customElements.define("test-leaf", class extends HTMLElement {});
  registerLeafRenderer({
    tag: "test-leaf",
    observedAttributes: ["glyph"],
    render: (el) => {
      const glyph = el.getAttribute("glyph") ?? "*";
      return {
        lines: [glyph.repeat(4), `${glyph}  ${glyph}`],
        runs: [{ line: 0, start: 0, end: 4, paint: { color: "rgb(255, 0, 0)" } }],
      };
    },
  });
}

export const LeafRenderer: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-max border px-1">
        <test-leaf>semantic fallback text</test-leaf>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const leaf = canvasElement.querySelector<HTMLElement>("test-leaf")!;
    await waitFor(
      () => {
        // The renderer's art is on the grid; the semantic text is NOT.
        expect(grid.textContent).toContain("****");
        expect(grid.textContent).toContain("*  *");
        expect(grid.textContent).not.toContain("semantic");
        // Paint runs land as span styling.
        const painted = Array.from(grid.querySelectorAll("span")).find((s) =>
          s.textContent!.includes("****"),
        )!;
        expect(painted.style.color).toBe("rgb(255, 0, 0)");
      },
      { timeout: 10_000 },
    );
    // The light DOM keeps the semantic content (a11y, select="text").
    expect(leaf.textContent).toBe("semantic fallback text");
    // A declared observed attribute re-renders the leaf — proves the
    // registry extends the host's mutation filter.
    leaf.setAttribute("glyph", "#");
    await waitFor(() => expect(grid.textContent).toContain("####"), { timeout: 10_000 });
  },
};
