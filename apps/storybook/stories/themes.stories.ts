import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import { expectGridOnItsCells, readyHosts } from "./helpers.ts";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * @monowind/themes, test-only (the Backgrounds toggle wears a theme on
 * every story): class-scoped themes modeled on real systems —
 * palette (every Tailwind color token quantized to the system's),
 * period font, fg/bg, ANSI tokens, and era-correct border glyphs, all
 * from one CSS file per theme. Two hosts on one page can wear
 * different themes; no class means core defaults. Hidden from the
 * sidebar; the gallery's resting state stays a golden.
 */
const meta: Meta = {
  title: "Test / Themes",
  tags: ["!dev"],
};
export default meta;

const THEMES = ["dos", "dos-blue", "c64", "green-phosphor", "amber", "teletype", "bbs"] as const;

const card = (theme: string) => html`
  <mono-wind class="theme-${theme} p-1" data-test=${"theme-" + theme}>
    <div class="border px-1">
      <div class="font-bold">${theme}</div>
      <div class="text-red-500">red-500 quantized</div>
      <div class="text-emerald-400">emerald-400 quantized</div>
      <div class="mt-1 border border-double px-1">double border</div>
    </div>
  </mono-wind>
`;

export const Gallery: StoryObj = {
  render: () => html`
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2">${THEMES.map(card)}</div>
  `,
  play: async ({ canvasElement }) => {
    const hosts = await readyHosts(canvasElement);
    expect(hosts).toHaveLength(7);
    const grid = (theme: string) =>
      canvasElement
        .querySelector<HTMLElement>(`[data-test="theme-${theme}"]`)!
        .shadowRoot!.getElementById("grid")!;
    // A token's color as the browser resolves it, whatever the build's
    // spelling of the hex.
    const token = (theme: string, name: string) => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(
        canvasElement.querySelector(`[data-test="theme-${theme}"]`)!,
      ).getPropertyValue(name);
      canvasElement.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };

    await waitFor(() => {
      // Palette quantization is scoped per host: dos snaps red-500 to
      // VGA bright red; the phosphor theme maps it to a green step.
      expect(token("dos", "--color-red-500")).toBe("rgb(255, 85, 85)");
      expect(token("green-phosphor", "--color-red-500")).toBe("rgb(0, 168, 60)");
      // Era borders: c64 rounds corners, amber (single) downgrades
      // the double border, teletype draws 7-bit.
      expect(grid("c64").textContent).toContain("╭");
      expect(grid("dos").textContent).toContain("╔");
      expect(grid("amber").textContent).not.toContain("╔");
      expect(grid("teletype").textContent).toContain("+-");
      expect(grid("bbs").textContent).toContain("██");
      // The DOS themes wear the period bitmap font.
      expect(
        getComputedStyle(canvasElement.querySelector('[data-test="theme-dos"]')!).fontFamily,
      ).toContain("Web IBM VGA 8x16");
    });
  },
};

/** Every border glyph set on every theme's period font, the pairing an
 * author is free to make and a theme cannot foresee: a set names
 * glyphs the font may not have — six of the seven have no arc, so
 * `borders-rounded` would fall back to another font at another advance.
 * Two rules meet here. A theme DECLARES its font's gaps, so nothing it
 * names reaches the grid whatever set was asked for
 * (specs/theming.md); and whatever slips through undeclared is boxed
 * onto its cells rather than drifting the row
 * (specs/wide-characters.md). */
const sets = html`
  <div class="border px-1 borders-default">default</div>
  <div class="border px-1 borders-rounded">rounded</div>
  <div class="border px-1 borders-ascii">ascii</div>
  <div class="border px-1 borders-single">single</div>
  <div class="border px-1 borders-blocks">blocks</div>
  <div class="border px-1 borders-cp437">cp437</div>
`;

export const GlyphSetsOnEveryFont: StoryObj = {
  render: () => html`
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
      ${THEMES.map(
        (theme) => html`
          <mono-wind class="theme-${theme} p-1" data-test=${"theme-" + theme}>
            <div class="flex flex-wrap gap-1">${sets}</div>
          </mono-wind>
        `,
      )}
    </div>
  `,
  play: async ({ canvasElement }) => {
    const hosts = await readyHosts(canvasElement);
    // The period fonts have to be the ones measured: until they land,
    // every glyph is the fallback's and the grid is consistently wrong.
    await document.fonts.ready;
    await waitFor(() => {
      for (const host of hosts) {
        expectGridOnItsCells(host);
        // A glyph the font has not got is boxed onto its cell and
        // cannot also fill the row, so it breaks from the line beside
        // it: nothing a theme declares missing may reach the grid,
        // whatever set an author named (specs/theming.md).
        const art = host.shadowRoot!.getElementById("grid")!.textContent!;
        const declared = getComputedStyle(host).getPropertyValue("--mw-missing-glyphs");
        for (const glyph of declared.replaceAll(/["',\s]/g, "")) {
          expect(art, `${host.className} draws ${glyph}`).not.toContain(glyph);
        }
      }
    });
  },
};
