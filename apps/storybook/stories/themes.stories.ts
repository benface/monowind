import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * @monowind/themes: class-scoped themes modeled on real systems —
 * palette (every Tailwind color token quantized to the system's),
 * period font, fg/bg, ANSI tokens, and era-correct border glyphs, all
 * from one CSS file per theme. Two hosts on one page can wear
 * different themes; no class means core defaults.
 */
const meta: Meta = {
  title: "Themes / Gallery",
};
export default meta;

const THEMES = ["dos", "dos-blue", "c64", "green-phosphor", "amber", "teletype", "bbs"] as const;

const card = (theme: string) => html`
  <mono-wind class="theme-${theme} p-1" data-theme-card=${theme}>
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
    const hosts = Array.from(canvasElement.querySelectorAll<HTMLElement>("mono-wind"));
    expect(hosts).toHaveLength(7);
    await waitFor(
      () => {
        for (const host of hosts) expect(host).toHaveAttribute("data-mw-ready");
      },
      { timeout: 10_000 },
    );
    const grid = (theme: string) =>
      canvasElement
        .querySelector<HTMLElement>(`[data-theme-card="${theme}"]`)!
        .shadowRoot!.getElementById("grid")!;
    const token = (theme: string, name: string) =>
      getComputedStyle(canvasElement.querySelector(`[data-theme-card="${theme}"]`)!)
        .getPropertyValue(name)
        .trim();

    await waitFor(
      () => {
        // Palette quantization is scoped per host: dos snaps red-500 to
        // VGA bright red; the phosphor theme maps it to a green step.
        expect(token("dos", "--color-red-500")).toBe("#ff5555");
        expect(token("green-phosphor", "--color-red-500")).toBe("#00a83c");
        // Era borders: c64 rounds corners, amber (single) downgrades
        // the double border, teletype draws 7-bit.
        expect(grid("c64").textContent).toContain("╭");
        expect(grid("dos").textContent).toContain("╔");
        expect(grid("amber").textContent).not.toContain("╔");
        expect(grid("teletype").textContent).toContain("+-");
        expect(grid("bbs").textContent).toContain("██");
        // The DOS themes wear the period bitmap font.
        expect(
          getComputedStyle(canvasElement.querySelector('[data-theme-card="dos"]')!).fontFamily,
        ).toContain("Web IBM VGA 8x16");
      },
      { timeout: 10_000 },
    );
  },
};
