import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Border glyph sets (specs/theming.md): the vocabulary border STYLES
 * render through — `borders-ascii` draws `border-double` as `+=+`,
 * `borders-single` downgrades it to light lines and draws `border-2`
 * as two rings. Selected via the inherited `--mw-border-glyphs` custom
 * property (the `borders-*` utilities set it); resolved on the
 * decoration's owner.
 */
const meta: Meta = {
  title: "Features / Theming",
};
export default meta;

export const BorderGlyphSets: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        <div class="flex gap-2">
          <div class="border px-1">default</div>
          <div class="border px-1 borders-rounded">rounded</div>
          <div class="border px-1 borders-ascii">ascii</div>
          <div class="border border-double px-1 borders-ascii">ascii double</div>
          <div class="border border-double px-1 borders-single">single, was double</div>
          <div class="border px-1 borders-blocks">blocks</div>
          <div class="border border-dotted px-1 borders-blocks">light shade</div>
        </div>
        <table class="w-full border-collapse text-center borders-rounded">
          <tr>
            <td class="border px-1">a</td>
            <td class="border px-1">b</td>
          </tr>
          <tr>
            <td class="border px-1">c</td>
            <td class="border px-1">d</td>
          </tr>
        </table>
        <table class="w-full border-collapse text-center borders-single">
          <tr>
            <td class="border-2 px-1">a</td>
            <td class="border-2 px-1">b</td>
          </tr>
          <tr>
            <td class="border-2 px-1">c</td>
            <td class="border px-1">d</td>
          </tr>
        </table>
        <div class="flex gap-3 px-1 rule-x borders-ascii">
          <div>left of an ascii rule</div>
          <div>right of it</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    await waitFor(
      () => {
        const art = grid.textContent!;
        // Per-element scoping: the default box keeps square corners
        // while its rounded sibling gets arcs.
        expect(art).toContain("┌");
        expect(art).toContain("╭");
        // ascii renders 7-bit; double keeps emphasis via `=`.
        expect(art).toContain("+-");
        expect(art).toContain("+=");
        // single downgrades double: no ╔ anywhere.
        expect(art).not.toContain("╔");
        // The collapsed lattice resolves with the TABLE's set: rounded
        // outer corners, default interior junctions.
        expect(art).toContain("╭─");
        expect(art).toContain("┼");
        // single has no heavy: border-2 is two rings, whose junction
        // blocks connect (specs/table.md) and end at the 1px cell's edge.
        expect(art).toContain("┌┬─");
        expect(art).toContain("┼┼");
        expect(art).toContain("┴┘");
        // blocks: uniform CP437 blocks; dotted maps to light shade.
        expect(art).toContain("█");
        expect(art).toContain("░");
        // The gap rule renders through the container's ascii set.
        expect(art).toContain("|");
      },
      { timeout: 10_000 },
    );
  },
};
