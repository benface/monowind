import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { glyphSetFor, registerBorderGlyphs } from "monowind";
import { cellSize, expectGridOnItsCells, readyHost, testHooks } from "./helpers.ts";

/**
 * `<mono-qr>` (@monowind/qr-code, specs/qr-code.md): a QR code packed
 * into the grid's cells through the leaf-renderer API. The light DOM
 * keeps the value (a11y); the grid shows the code.
 */
const meta: Meta = {
  title: "Packages / qr-code",
};
export default meta;

const VALUE = "https://play.monowind.benface.com";

/** The rows of a code in cells: its box's height over the cell. */
const rowsOf = (host: HTMLElement, el: Element): number =>
  Math.round(el.getBoundingClientRect().height / cellSize(host).height);
const colsOf = (host: HTMLElement, el: Element): number =>
  Math.round(el.getBoundingClientRect().width / cellSize(host).width);

export const Default: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-center gap-1">
        <mono-qr data-test="code">${VALUE}</mono-qr>
        <p class="text-neutral-400">scan for the online edition</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const code = canvasElement.querySelector("[data-test='code']")!;
    // The auto aspect reads the measured cell (about 2 in this font):
    // a version-3 code is 29 modules, 29 columns by 15 rows of half
    // blocks.
    expect(colsOf(host, code)).toBe(29);
    expect(rowsOf(host, code)).toBe(15);
    expectGridOnItsCells(host);
  },
};

/** Every attribute on bare codes (the gap between examples is their
 * quiet zone here): uniform scaling, the packing for square, wide, and
 * very tall cells, and the error-correction level — this value at L
 * and H is two versions apart. */
export const Options: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap items-start gap-4">
        <div>
          <div class="mb-1 text-neutral-400">defaults</div>
          <mono-qr data-test="defaults">12345</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">scale="2"</div>
          <mono-qr data-test="scale" scale="2">12345</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">aspect="1"</div>
          <mono-qr data-test="square" aspect="1">12345</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">aspect="0.5"</div>
          <mono-qr data-test="tall" aspect="0.5">12345</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">aspect="4"</div>
          <mono-qr data-test="wide" aspect="4">12345</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">level="L"</div>
          <mono-qr data-test="low" level="L">https://monowind.benface.com</mono-qr>
        </div>
        <div>
          <div class="mb-1 text-neutral-400">level="H"</div>
          <mono-qr data-test="high" level="H">https://monowind.benface.com</mono-qr>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    // A version-1 code is 21 modules.
    expect([colsOf(host, by("defaults")), rowsOf(host, by("defaults"))]).toEqual([21, 11]);
    expect([colsOf(host, by("scale")), rowsOf(host, by("scale"))]).toEqual([42, 21]);
    expect([colsOf(host, by("square")), rowsOf(host, by("square"))]).toEqual([21, 21]);
    expect([colsOf(host, by("tall")), rowsOf(host, by("tall"))]).toEqual([21, 42]);
    expect([colsOf(host, by("wide")), rowsOf(host, by("wide"))]).toEqual([42, 11]);
    // Versions 2 and 4: 25 and 33 modules.
    expect(colsOf(host, by("low"))).toBe(25);
    expect(colsOf(host, by("high"))).toBe(33);
    expectGridOnItsCells(host);
  },
};

/** The modules paint in the element's color on its background, the
 * padding included — a `bg-white text-black` code is normal polarity
 * on any theme. */
export const Colors: StoryObj = {
  render: () => html`
    <mono-wind class="bg-neutral-900 p-1 text-neutral-100">
      <div class="flex flex-wrap items-start gap-4">
        <mono-qr class="px-2 py-1">${VALUE}</mono-qr>
        <mono-qr class="bg-white px-2 py-1 text-black">${VALUE}</mono-qr>
        <mono-qr class="px-2 py-1 text-emerald-400">${VALUE}</mono-qr>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    expectGridOnItsCells(await readyHost(canvasElement));
  },
};

/** A registered glyph set restyles the modules through its `qrFull`,
 * `qrUpper`, `qrLower` roles; one naming `qrFull` alone has no half
 * blocks, so each module is two cells wide. */
export const CustomGlyphs: StoryObj = {
  render: () => {
    if (!glyphSetFor("hashes")) registerBorderGlyphs("hashes", { solid: { qrFull: "#" } });
    return html`
      <mono-wind>
        <mono-qr data-test="code" style="--mw-border-glyphs: hashes">12345</mono-qr>
      </mono-wind>
    `;
  },
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const code = canvasElement.querySelector("[data-test='code']")!;
    expect([colsOf(host, code), rowsOf(host, code)]).toEqual([42, 21]);
    const mirror = code.shadowRoot!.getElementById("mirror")!.textContent!;
    expect(mirror).toContain("##");
    expect(mirror).not.toContain("█");
  },
};
