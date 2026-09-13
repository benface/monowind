import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { readyGrid, readyHost } from "./helpers.ts";

/**
 * Visual effects on the grid: opacity and animated (transitioned)
 * styles. The grid paints spans whose `opacity` composites against the
 * page, and the engine re-samples computed styles every frame while a
 * transition of a sampled property (color, border colors, opacity)
 * runs — see specs/cell-model.md "Opacity" and "Animation".
 */
const meta: Meta = {
  title: "Features / Effects",
};
export default meta;

const gridSpanFor = (host: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(host.shadowRoot!.getElementById("grid")!.querySelectorAll("span")).find((span) =>
    span.textContent!.includes(text),
  );

/**
 * Outlines stay native (specs/cell-model.md "Outlines"): the browser
 * draws them around the engine-sized box in px, above the grid — a
 * static `outline-*`, an offset one, a dashed one, and a focus ring a
 * `focus-visible:outline-*` utility draws over the engine's focus
 * invert.
 */
export const Outline: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-4 p-2">
        <div data-test="solid" class="self-start outline-2 outline-cyan-400">outline-2</div>
        <div data-test="offset" class="border px-1 outline-2 outline-offset-4 outline-cyan-400">
          outline-offset-4
        </div>
        <div data-test="dashed" class="border px-1 outline-2 outline-amber-400 outline-dashed">
          outline-dashed
        </div>
        <button
          data-test="button"
          class="border px-1 focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          focus me
        </button>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    expect(getComputedStyle(by("solid")).outlineStyle).toBe("solid");
    expect(getComputedStyle(by("solid")).outlineWidth).toBe("2px");
    expect(getComputedStyle(by("offset")).outlineOffset).toBe("4px");
    expect(getComputedStyle(by("dashed")).outlineStyle).toBe("dashed");
    // Unfocused, the button has no outline; focused, the utility's ring
    // outranks the engine's `outline: none` and joins the invert.
    expect(getComputedStyle(by("button")).outlineStyle).toBe("none");
    by("button").focus();
    await waitFor(() => expect(by("button").matches(":focus-visible")).toBe(true));
    expect(getComputedStyle(by("button")).outlineStyle).toBe("solid");
    expect(getComputedStyle(by("button")).outlineWidth).toBe("2px");
    by("button").blur();
  },
};

/**
 * `box-shadow` on the grid (specs/box-shadow.md): the box's silhouette
 * moved by its offsets and grown by its spread, in the set's shades,
 * blur stepping through them outward — the DOS shadow, Tailwind's
 * presets, a spread ring, the `ascii` ramp, and inset shadows inside
 * the padding box.
 */
export const BoxShadow: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-4 p-3 pb-6">
        <div data-test="dos" class="border px-1 shadow-[4px_4px_0_0_var(--mw-fg)]">DOS</div>
        <div data-test="md" class="border px-1 shadow-md">shadow-md</div>
        <div data-test="lg" class="border px-1 shadow-lg">shadow-lg</div>
        <div data-test="xl" class="border px-1 shadow-xl">shadow-xl</div>
        <div data-test="ring" class="border px-1 shadow-[0_0_0_4px_rgb(6_182_212)]">ring</div>
        <div
          data-test="ascii"
          class="border px-1 shadow-[4px_4px_8px_0_var(--mw-fg)] borders-ascii"
        >
          ascii blur
        </div>
        <div data-test="inset" class="border p-1 shadow-[inset_4px_4px_0_0_var(--mw-fg)]">
          inset
        </div>
        <div data-test="inner" class="border p-1 shadow-inner">shadow-inner</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, width, height, measure } = await readyGrid(canvasElement);
    const cell = (name: string, dRow: number, dCol: number) => {
      const el = by(name);
      const { rows, boxOf } = measure();
      const { row, col } = boxOf(el);
      return rows[row + dRow]![col + dCol];
    };
    const shade = /[█▓▒░]/;
    // The DOS shadow: a column to the right from the second row, a row
    // below from the second column, nothing on the first row.
    expect(cell("dos", 0, width(by("dos")))).toBe(" ");
    expect(cell("dos", 1, width(by("dos")))).toBe("█");
    expect(cell("dos", height(by("dos")), 1)).toBe("█");
    // shadow-md: black at a tenth, the second-lightest shade one row
    // down, fading to the lightest on its ring below.
    expect(cell("md", height(by("md")), 1)).toBe("▒");
    expect(cell("md", height(by("md")) + 1, 1)).toBe("░");
    // shadow-lg and shadow-xl sit a row down like shadow-md and soften
    // outward: xl's halo reaches two cells past the box on every side.
    expect(cell("lg", height(by("lg")), 1)).toMatch(shade);
    expect(cell("xl", height(by("xl")), 1)).toBe("▒");
    expect(cell("xl", height(by("xl")) + 1, 1)).toBe("░");
    expect(cell("xl", height(by("xl")) + 2, 1)).toBe("░");
    expect(cell("xl", -1, 1)).toBe("░");
    expect(cell("xl", 1, -2)).toBe("░");
    // A spread-only shadow rings the box.
    expect(cell("ring", -1, 0)).toBe("█");
    expect(cell("ring", 0, -1)).toBe("█");
    // The ascii ramp: a solid core, a dotted ring.
    expect(cell("ascii", height(by("ascii")), 1)).toBe("#");
    expect(cell("ascii", height(by("ascii")) + 1, 1)).toBe(".");
    // Inset: the padding box's top row and left column, inside the
    // border, around the text; shadow-inner a faint ring inside.
    expect(cell("inset", 1, 1)).toBe("█");
    expect(cell("inset", 2, 1)).toBe("█");
    expect(cell("inset", 3, 2)).toBe(" ");
    expect(cell("inner", 1, 1)).toMatch(shade);
  },
};

export const Opacity: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex gap-2">
          <div class="border border-cyan-400 px-1">opacity-100</div>
          <div class="border border-cyan-400 px-1 opacity-75">opacity-75</div>
          <div class="border border-cyan-400 px-1 opacity-50">opacity-50</div>
          <div class="border border-cyan-400 px-1 opacity-25">opacity-25</div>
          <div class="border border-cyan-400 px-1 opacity-0" data-test="ghost">opacity-0</div>
        </div>
        <div class="border border-fuchsia-400 px-1 opacity-50" data-test="nested">
          <div>Ancestors multiply:</div>
          <div class="opacity-50">nested opacity-50 renders at 0.25</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(
      () => {
        // Every paint of a translucent element carries the effective
        // alpha; the span composites against the page.
        expect(gridSpanFor(host, "opacity-75")!.style.opacity).toBe("0.75");
        expect(gridSpanFor(host, "opacity-50")!.style.opacity).toBe("0.5");
        // Ancestors multiply (CSS opacity nests, it doesn't inherit).
        expect(gridSpanFor(host, "nested opacity-50")!.style.opacity).toBe("0.25");
        // opacity-0 still paints its glyphs — invisible, but present
        // and selectable in select="grid" mode (unlike `invisible`).
        expect(gridSpanFor(host, "opacity-0")!.style.opacity).toBe("0");
        expect(host.shadowRoot!.getElementById("grid")!.textContent).toContain("opacity-0");
        // A translucent border glyph is boxed to its cell, so its
        // overshoot never composites twice where rows join.
        const line = Array.from(host.shadowRoot!.querySelectorAll("#grid span")).find(
          (span) => span.textContent === "│" && (span as HTMLElement).style.opacity === "0.75",
        ) as HTMLElement | undefined;
        expect(line?.style.display).toBe("inline-block");
        expect(line?.style.overflow).toBe("hidden");
      },
      { timeout: 10_000 },
    );
  },
};

export const Transitions: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        <div
          class="border px-1 transition-colors duration-500 hover:border-rose-400 hover:text-rose-400"
        >
          hover: text and border colors, half a second
        </div>
        <div
          class="border border-cyan-700 px-1 transition-colors duration-500 hover:border-fuchsia-400"
        >
          hover: only my border animates — the text stays put
        </div>
        <div class="border px-1 transition duration-500 hover:bg-indigo-600">
          hover: a background fade — the engine synthesizes this one
        </div>
        <div class="border px-1 transition-opacity duration-500 hover:opacity-20">
          hover: opacity, fading me mostly away
        </div>
        <div
          class="border px-1 transition duration-1000 ease-in hover:bg-emerald-600 hover:text-emerald-950"
        >
          hover: everything at once, a slow ease-in
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    await waitFor(
      () => {
        for (const label of [
          "half a second",
          "stays put",
          "synthesizes",
          "mostly away",
          "a slow ease-in",
        ])
          expect(grid.textContent).toContain(label);
      },
      { timeout: 10_000 },
    );
  },
};

/** Test-only (hidden from the sidebar): drives the class toggles the
 * hoverable Transitions story leaves to the user's pointer, and
 * asserts on the sampled/synthesized frames. */
export const TransitionSampling: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        <div class="border px-1 text-cyan-400 transition duration-500" data-test="fader">
          Toggle my class and I fade — the grid repaints every frame.
        </div>
        <div class="border px-1 transition-colors duration-500" data-test="snapper">
          My opacity snaps — transition-colors doesn't cover it.
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // While a transition runs, the engine repaints the grid per
    // animation frame: text color is sampled from the browser's own
    // interpolation; background-color (which has no native timeline
    // under the bg lock) is SYNTHESIZED by the engine with the authored
    // duration and easing.
    const host = await readyHost(canvasElement);
    const fader = canvasElement.querySelector<HTMLElement>('[data-test="fader"]')!;
    const snapper = canvasElement.querySelector<HTMLElement>('[data-test="snapper"]')!;
    await waitFor(() => expect(gridSpanFor(host, "Toggle")).toBeDefined(), { timeout: 10_000 });
    const colors = new Set<string>();
    const backgrounds = new Set<string>();
    const opacities = new Set<string>();
    fader.classList.replace("text-cyan-400", "text-rose-400");
    fader.classList.add("bg-indigo-600");
    snapper.classList.add("opacity-25");
    const until = performance.now() + 900;
    while (performance.now() < until) {
      const span = gridSpanFor(host, "Toggle");
      if (span) {
        colors.add(span.style.color);
        backgrounds.add(span.style.backgroundColor);
      }
      const snapped = gridSpanFor(host, "My opacity");
      if (snapped) opacities.add(snapped.style.opacity);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // Several distinct interpolated values each, ending exactly on the
    // authored targets.
    expect(colors.size, "sampled intermediate colors").toBeGreaterThanOrEqual(3);
    expect(backgrounds.size, "synthesized intermediate backgrounds").toBeGreaterThanOrEqual(3);
    // The authored transition-property list is respected: opacity is
    // not in transition-colors, so it snaps — full (no opacity string)
    // straight to the target, nothing interpolated.
    expect(Array.from(opacities).sort(), "opacity snaps").toEqual(["", "0.25"]);
    await waitFor(
      () => expect(gridSpanFor(host, "Toggle")!.style.color).toBe(getComputedStyle(fader).color),
      { timeout: 10_000 },
    );
  },
};

/**
 * Gradient backgrounds (specs/gradients.md): a color per cell at the
 * cell's center — Tailwind's linear presets and angles, stops with
 * positions, radial and conic forms, layers, a translucent stop over
 * a plain color, the oklch and hsl spaces with a hue mode, and
 * `background-clip`: the padding box, and `text`, the gradient
 * through transparent glyphs; elsewhere glyphs keep their own color.
 */
export const Gradients: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div data-test="to-r" class="bg-linear-to-r from-cyan-500 to-blue-600 px-1">
          bg-linear-to-r from-cyan-500 to-blue-600
        </div>
        <div data-test="angle" class="bg-linear-45 from-amber-400 to-pink-600 px-1 py-4">
          bg-linear-45 from-amber-400 to-pink-600
        </div>
        <div
          data-test="via"
          class="bg-linear-to-br from-emerald-400 via-teal-600 to-slate-900 px-1 py-4"
        >
          bg-linear-to-br from-emerald-400 via-teal-600 to-slate-900
        </div>
        <div
          data-test="positions"
          class="bg-linear-to-r from-red-500 from-10% to-yellow-400 to-90% px-1"
        >
          from-10% to-90%
        </div>
        <div data-test="srgb" class="bg-linear-to-r/srgb from-cyan-500 to-blue-600 px-1">
          bg-linear-to-r/srgb
        </div>
        <div data-test="radial" class="bg-radial from-violet-500 to-fuchsia-900 px-1 py-4">
          bg-radial from-violet-500 to-fuchsia-900
        </div>
        <div data-test="radial-at" class="bg-radial-[at_25%_25%] from-white to-zinc-900 px-1 py-4">
          bg-radial-[at_25%_25%]
        </div>
        <div data-test="conic" class="bg-conic from-red-500 via-lime-400 to-red-500 px-1 py-4">
          bg-conic from-red-500 via-lime-400 to-red-500
        </div>
        <div data-test="conic-from" class="bg-conic-180 from-sky-400 to-indigo-900 px-1 py-4">
          bg-conic-180
        </div>
        <div
          data-test="layers"
          class="bg-[linear-gradient(to_right,rgb(255_0_0/0.5),transparent),radial-gradient(circle,white,black)] px-1 py-4"
        >
          two layers
        </div>
        <div data-test="over" class="bg-red-500 bg-linear-to-r from-transparent to-white px-1">
          bg-red-500 under from-transparent to-white
        </div>
        <div
          data-test="current"
          class="bg-linear-to-r from-current to-transparent px-1 text-cyan-500"
        >
          from-current
        </div>
        <div data-test="oklch" class="bg-linear-to-r/oklch from-cyan-500 to-blue-600 px-1">
          bg-linear-to-r/oklch
        </div>
        <div data-test="longer" class="bg-linear-to-r/longer from-cyan-500 to-blue-600 px-1">
          bg-linear-to-r/longer
        </div>
        <div data-test="hsl" class="bg-linear-to-r/hsl from-red-500 to-blue-500 px-1">
          bg-linear-to-r/hsl
        </div>
        <div
          data-test="clip-padding"
          class="border-2 border-neutral-400 bg-linear-to-r from-amber-400 to-pink-600 bg-clip-padding px-1"
        >
          border-2 bg-clip-padding
        </div>
        <div
          data-test="clip-text"
          class="bg-linear-to-r from-amber-400 via-pink-600 to-violet-600 bg-clip-text px-1 font-bold text-transparent"
        >
          bg-clip-text text-transparent: the gradient through the glyphs
        </div>
        <div class="bg-sky-900 px-1 py-1">
          <div
            data-test="clip-text-over"
            class="bg-linear-to-r from-amber-400 via-pink-600 to-violet-600 bg-clip-text text-transparent"
          >
            … and over a parent's bg-sky-900, which stays under the glyphs
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(
      () => {
        const spans = Array.from(host.shadowRoot!.getElementById("grid")!.querySelectorAll("span"));
        // A color per cell, a row of them one span's hard stops: far
        // more distinct colors than boxes.
        const colors = spans.flatMap(
          (span) => span.style.backgroundImage.match(/rgb\([^)]*\)/g) ?? [],
        );
        expect(new Set(colors).size).toBeGreaterThan(200);
        // The transparent stop over bg-red-500 starts beside red-500 at
        // the left edge, its text over the same colors.
        const over = spans.find((span) => span.textContent!.startsWith("bg-red-500"))!;
        const [r, g, b] = over.style.backgroundImage
          .match(/rgb\((\d+),? (\d+),? (\d+)/)!
          .slice(1)
          .map(Number);
        expect(Math.abs(r! - 251) + Math.abs(g! - 44) + Math.abs(b! - 54)).toBeLessThan(12);
        // The longer hue arc from cyan to blue runs the long way round:
        // its middle is nowhere near the oklch row's.
        const middle = (name: string) => {
          const span = spans.find((span) => span.textContent!.startsWith(name))!;
          const stops = span.style.backgroundImage.match(/rgb\([^)]*\)/g)!;
          return stops[Math.floor(stops.length / 2)]!;
        };
        expect(middle("bg-linear-to-r/longer")).not.toBe(middle("bg-linear-to-r/oklch"));
        // Clipped to text, the row is one span whose hard stops show
        // through its glyphs.
        const clipped = spans.find((span) => span.textContent!.startsWith("bg-clip-text"))!;
        expect(clipped.style.backgroundClip).toBe("text");
        expect(clipped.style.color).toBe("transparent");
        expect(clipped.style.backgroundImage.match(/rgb\(/g)!.length).toBeGreaterThan(40);
        // Over a filled parent the glyphs keep a span each, the
        // parent's color under every one.
        const onSky = spans.filter(
          (span) =>
            span.textContent!.length === 1 &&
            span.style.color.startsWith("rgb(") &&
            span.style.backgroundColor !== "" &&
            span.style.backgroundClip === "",
        );
        expect(onSky.length).toBeGreaterThan(40);
      },
      { timeout: 10_000 },
    );
  },
};
