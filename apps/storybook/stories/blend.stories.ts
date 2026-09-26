import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { readyHosts, testHooks } from "./helpers.ts";

/**
 * The engine's blends against the browser's own (specs/cell-model.md
 * "Opacity and translucency"): each case twice, with the same classes —
 * inside `<mono-wind>`, and natively in a plain monospace block beside
 * it on the same page, flat but for the image the last cases sit over.
 * `visual/blend.spec.ts` samples a `█` for a
 * glyph's color, a `🟥` for a color emoji's, a padding cell for a
 * background, a translucent shade's fullest ink, and a faded emoji's
 * underline, in all three engines. Hidden from the sidebar
 * and the sweep.
 */
const meta: Meta = {
  title: "Test / Blend",
  tags: ["!dev", "!golden"],
};
export default meta;

/** The cases, a `data-test` hook on each element sampled: a `█`, or a
 * box whose left padding is its background and whose middle is its
 * glyph. */
const cases = html`
  <div class="flex w-max flex-col gap-1">
    <div data-test="button" class="bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50">
      <span data-test="button-glyph">█</span> button
    </div>
    <div data-test="outer" class="bg-[rgb(255,0,0)] px-2 opacity-50">
      <div data-test="inner" class="bg-[rgb(0,0,255)] px-2 text-[rgb(0,0,0)] opacity-50">
        <span data-test="nested-glyph">█</span> nested
      </div>
    </div>
    <div class="bg-[rgb(200,0,0)] px-2">
      <div data-test="shade" class="bg-[rgb(0,0,0)]/50 px-2">shade</div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2 text-[rgb(255,255,255)]/50">
      <span data-test="text-glyph">█</span> text
    </div>
    <p class="bg-[rgb(0,0,200)] text-[rgb(255,255,255)]">
      a <span data-test="span-glyph" class="opacity-50">█</span>
      <span data-test="filled" class="bg-[rgb(255,0,0)] px-2 opacity-50">█</span>
      <span class="bg-[rgb(255,0,0)] opacity-50"
        >b <span data-test="inner-glyph" class="opacity-50">█</span></span
      >
    </p>
    <div class="bg-linear-to-r from-[rgb(100,100,100)] to-[rgb(130,130,130)] px-2">
      <div data-test="veil" class="w-max bg-white/30 px-2">over a gradient</div>
    </div>
    <div data-test="ghost" class="bg-[rgb(255,0,0)] px-2 text-[rgb(0,0,0)] opacity-0">
      <span data-test="ghost-glyph">█</span> ghost
    </div>
    <div
      data-test="layer"
      class="bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50 grayscale-0"
    >
      <span data-test="layer-glyph">█</span> layer
    </div>
    <div data-test="tailwind" class="w-max bg-red-500/50 px-2">bg-red-500/50</div>
    <div data-test="yellow" class="w-max bg-yellow-400/50 px-2">bg-yellow-400/50</div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div
        data-test="gamut"
        class="w-max bg-[oklch(0.7_0.3_30)] px-2 text-[oklch(0.9_0.3_140)] opacity-50"
      >
        <span data-test="gamut-glyph">█</span> past sRGB
      </div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div data-test="lab" class="w-max bg-[lab(50%_40_30/0.5)] px-2">lab</div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div data-test="a98" class="w-max bg-[color(a98-rgb_0.2_0.6_0.3/0.5)] px-2">a98</div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div data-test="prophoto" class="w-max bg-[color(prophoto-rgb_0.7_0.2_0.9/0.5)] px-2">
        prophoto
      </div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div data-test="rec2020" class="w-max bg-[color(rec2020_0.3_0.8_0.5/0.5)] px-2">rec2020</div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div data-test="system" class="w-max bg-[canvastext]/50 px-2">system</div>
    </div>
    <div class="bg-[rgb(200,0,0)] px-2">
      <div class="opacity-50">
        <div
          data-test="pixel"
          class="w-max bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50"
        >
          <span data-test="pixel-glyph">█</span> nested
        </div>
      </div>
    </div>
    <div class="w-max bg-[rgb(0,0,200)] px-2">
      <div class="opacity-50"><span data-test="emoji">🟥</span> emoji</div>
    </div>
    <div class="w-max bg-[rgb(0,0,200)] px-2"><span data-test="whole-emoji">🟥</span> whole</div>
    <div class="w-max bg-[rgb(0,0,200)] px-2 text-[rgb(0,255,0)]">
      <span class="opacity-50"><span data-test="underlined-emoji" class="underline">🟥</span></span>
      underlined
    </div>
    <div
      class="relative w-max bg-[rgb(0,0,200)] px-2 text-[rgb(255,255,255)] in-data-[test=native]:text-transparent"
    >
      <span data-test="blanked">██</span> text
      <div class="absolute inset-0 bg-black/50"></div>
    </div>
    <div class="bg-[rgb(0,0,200)] px-2">
      <div
        data-test="layer-text"
        class="w-max bg-[rgb(0,0,0)]/50 px-2 text-[rgb(255,255,255)]/50 grayscale-0"
      >
        <span data-test="layer-text-glyph">█</span> in a layer
      </div>
    </div>
    <div class="text-[rgb(255,255,0)]/50"><span data-test="shade-glyph">▓</span> shade</div>
    <div class="w-max bg-[rgb(0,0,255)]/50 px-2 text-[rgb(255,255,0)]/50">
      <span data-test="veiled-shade-glyph">▓</span> veiled shade
    </div>
    <div class="p-1">
      <div data-test="ring" class="w-max px-1 shadow-[0_0_0_4px_rgb(255_255_0/0.5)]">
        ring
        <span
          data-test="ring-glyph"
          class="hidden text-[color-mix(in_srgb,rgb(255_255_0/0.5)_50%,currentColor)] in-data-[test=native]:inline"
          >▓</span
        >
      </div>
    </div>
  </div>
`;

/** A transparent host over an image the engine cannot read: the
 * browser composites what stays translucent over it, a group with
 * nothing beneath at its span's opacity. */
const imageCases = html`
  <div class="flex w-max flex-col gap-1">
    <div data-test="img-veil" class="w-max bg-black/50 px-2">veil</div>
    <div class="text-[rgb(255,255,255)]/50"><span data-test="img-text-glyph">█</span> text</div>
    <div class="text-[rgb(255,255,0)] opacity-50">
      <span data-test="img-fade-glyph">█</span> faded
    </div>
    <div
      data-test="img-button"
      class="w-max bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50"
    >
      <span data-test="img-button-glyph">█</span> button
    </div>
    <div class="w-max opacity-50"><span data-test="img-emoji">🟥</span> emoji</div>
    <div class="w-max text-[rgb(0,0,0)]/50 opacity-50">
      <span data-test="img-emoji-alpha">🟥</span> emoji
    </div>
    <div class="w-max bg-[rgb(0,0,255)] px-2 opacity-50">
      <span data-test="img-emoji-fill">🟥</span> emoji
    </div>
    <div class="w-max bg-black/50 px-2">
      <div
        data-test="img-veiled-button"
        class="bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50"
      >
        <span data-test="img-veiled-button-glyph">█</span> veiled
      </div>
    </div>
    <div class="relative w-max">
      <div class="bg-[rgb(0,0,255)] px-2 opacity-50">overlaid</div>
      <div data-test="img-overlay" class="absolute inset-0 bg-black/50"></div>
    </div>
  </div>
`;
const IMAGE = "background-image: linear-gradient(rgb(0 128 0), rgb(0 128 0))";

/** A popover at 0.5, over nothing but the page. */
const popover = (style: string) => html`
  <div
    data-test="popover"
    popover="manual"
    class="bg-[rgb(0,0,255)] px-2 text-[rgb(255,255,0)] opacity-50"
    style=${style}
  >
    <span data-test="popover-glyph">█</span> popover
  </div>
`;

export const Twins: StoryObj = {
  render: () => html`
    <div class="flex gap-8 p-2">
      <div data-test="engine" class="flex w-60 flex-col gap-2">
        <mono-wind>${cases}</mono-wind>
        <mono-wind>
          <div class="h-12"></div>
          ${popover("")}
        </mono-wind>
        <div style=${IMAGE}><mono-wind>${imageCases}</mono-wind></div>
      </div>
      <div data-test="native" class="flex w-60 flex-col gap-2 font-mono">
        <div>${cases} ${popover("inset: auto 0.5rem 0.5rem auto; margin: 0")}</div>
        <div class="h-12"></div>
        <div style=${IMAGE}>${imageCases}</div>
      </div>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    for (const side of ["engine", "native"]) {
      by(side).querySelector<HTMLElement>("[popover]")!.showPopover();
    }
  },
};
