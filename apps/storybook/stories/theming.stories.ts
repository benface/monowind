import { html } from "lit";
import { expect, userEvent, waitFor } from "storybook/test";
import { paintedBackground, readyHost, readyHosts, testHooks } from "./helpers.ts";
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
        <div class="flex flex-wrap gap-x-2 gap-y-1">
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
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    await waitFor(() => {
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
    });
  },
};

/** The fg and bg tokens follow the host's colors (specs/theming.md): a
 * styled host's own, a transparent host's the page's behind it, an
 * explicit token on the host its own, and a descendant's override its
 * subtree's. */
export const Tokens: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-2">
      <mono-wind data-test="styled" class="bg-[#1e1b4b] text-[#fde68a]">
        <div class="p-1">
          <button data-test="button" class="border px-1">focus me</button>
          <div class="mt-1 bg-(--mw-fg) px-1 text-(--mw-bg)">inverted through the tokens</div>
          <div class="mt-1 [--mw-fg:#ff00ff]">
            <button data-test="override" class="border px-1">override</button>
          </div>
        </div>
      </mono-wind>
      <mono-wind data-test="explicit" class="bg-[#1e1b4b] text-[#fde68a] [--mw-fg:#00ff00]">
        <div class="p-1">
          <button data-test="explicit-button" class="border px-1">explicit token</button>
        </div>
      </mono-wind>
      <div data-test="page" class="bg-[#0c4a6e] p-2 text-[#e0f2fe]">
        <mono-wind data-test="clear">
          <div class="p-1">
            <div data-test="box" class="border bg-(--mw-bg) px-1 text-(--mw-fg)">
              the page's colors
            </div>
          </div>
        </mono-wind>
      </div>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const by = testHooks(canvasElement);
    await readyHosts(canvasElement);
    const styled = by("styled");
    const clear = by("clear");
    const token = (host: HTMLElement, name: string) =>
      getComputedStyle(host).getPropertyValue(name).trim();
    // The styled host: its own color and background.
    expect(token(styled, "--mw-fg")).toBe(getComputedStyle(styled).color);
    expect(token(styled, "--mw-bg")).toBe(getComputedStyle(styled).backgroundColor);
    // The focus invert paints with them; a subtree's own token wins there.
    await userEvent.tab();
    expect(document.activeElement).toBe(by("button"));
    await waitFor(() =>
      expect(paintedBackground(styled, "focus me")).toBe(getComputedStyle(styled).color),
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(by("override"));
    await waitFor(() => expect(paintedBackground(styled, "override")).toBe("rgb(255, 0, 255)"));
    // An explicit token on the host outranks the derived one (read
    // through the paint: a build may shorten the authored hex).
    const explicit = by("explicit");
    await userEvent.tab();
    expect(document.activeElement).toBe(by("explicit-button"));
    await waitFor(() =>
      expect(paintedBackground(explicit, "explicit token")).toBe("rgb(0, 255, 0)"),
    );
    // The transparent host: the page's background behind it, its inherited text.
    const page = getComputedStyle(by("page"));
    expect(token(clear, "--mw-bg")).toBe(page.backgroundColor);
    expect(token(clear, "--mw-fg")).toBe(page.color);
    await waitFor(() =>
      expect(paintedBackground(clear, "the page's colors")).toBe(page.backgroundColor),
    );
    // The page recolored above the host: the cascade reaches the tokens.
    by("page").classList.replace("bg-[#0c4a6e]", "bg-[#7f1d1d]");
    await waitFor(() => expect(token(clear, "--mw-bg")).toBe(page.backgroundColor));
    expect(page.backgroundColor).toBe("rgb(127, 29, 29)");
    await waitFor(() =>
      expect(paintedBackground(clear, "the page's colors")).toBe("rgb(127, 29, 29)"),
    );
  },
};
