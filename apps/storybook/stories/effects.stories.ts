import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { dragTo, pressAt, readyGrid, readyHost, release } from "./helpers.ts";
import type { Point } from "./helpers.ts";

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

/**
 * Layers (specs/layers.md): an element with a transform or a filter
 * paints its subtree into a grid of its own, a box in the shadow
 * viewport carrying the native transform and filter, so the browser
 * turns, scales, and blurs the cells — a rotated badge, a scaled
 * dialog whose button stays clickable where it shows, filters, a
 * layer inside a scroll container, and nested layers composing.
 */
export const Layers: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div data-test="rotated" class="rotate-6 border px-1">rotated</div>
        <div data-test="scaled" class="origin-top-left scale-125 border bg-sky-900 px-1 text-white">
          scaled dialog
          <button data-test="ok" class="mt-1 border px-1">ok</button>
        </div>
        <div data-test="blurred" class="border px-1 blur-[1px]">blurred</div>
        <div data-test="grayscale" class="border px-1 text-red-500 grayscale">grayscale</div>
        <div data-test="shifted" class="translate-x-2 translate-y-1 border px-1 shadow-md">
          translated
        </div>
        <div data-test="half" class="translate-x-1/2 border px-1">half over</div>
        <div class="relative w-40">
          <p>The quick brown fox jumps over the lazy dog, and the glass over it frosts.</p>
          <div data-test="frosted" class="absolute top-1 left-2 border px-1 backdrop-blur-[2px]">
            frosted
          </div>
        </div>
        <div data-test="scroller" class="h-6 w-40 overflow-y-scroll border">
          <div>line one</div>
          <div data-test="scrolled" class="rotate-3 border px-1">a layer in a scroll container</div>
          <div>line five</div>
          <div>line six</div>
          <div>line seven</div>
        </div>
        <div class="w-40 rotate-2 border p-1">
          <div class="-rotate-2 border px-1">nested layers</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(
      () => {
        const boxes = Array.from(
          host.shadowRoot!.getElementById("layers")!.querySelectorAll<HTMLElement>(".layer"),
        );
        // A box per layer root, its effects the light element's, its
        // rect the element's where nothing overflows the border box.
        const roots = [
          "rotated",
          "scaled",
          "blurred",
          "grayscale",
          "shifted",
          "half",
          "frosted",
        ].map((name) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!);
        // The roots above, the scrolled one, and the nested pair.
        expect(boxes.length).toBe(roots.length + 3);
        // A translate percentage resolves on the element natively, on
        // the box in px of the border box: compare both in px.
        const translateOf = (value: string, el: HTMLElement): number[] =>
          value === "none"
            ? [0, 0]
            : value.split(" ").map((part, axis) => {
                const box = el.getBoundingClientRect();
                const extent = axis === 0 ? box.width : box.height;
                return part.endsWith("%") ? (parseFloat(part) / 100) * extent : parseFloat(part);
              });
        const sameTranslate = (a: number[], b: number[]) =>
          Math.abs(a[0]! - b[0]!) < 0.5 && Math.abs((a[1] ?? 0) - (b[1] ?? 0)) < 0.5;
        for (const root of roots) {
          const own = getComputedStyle(root);
          const box = boxes.find((box) => {
            const cs = getComputedStyle(box);
            return (
              cs.transform === own.transform &&
              sameTranslate(translateOf(cs.translate, box), translateOf(own.translate, root)) &&
              cs.rotate === own.rotate &&
              cs.scale === own.scale &&
              cs.filter === own.filter
            );
          });
          expect(box, root.dataset.test).toBeDefined();
          if (root.dataset.test === "shifted") continue;
          const a = box!.getBoundingClientRect();
          const b = root.getBoundingClientRect();
          for (const side of ["left", "top", "right", "bottom"] as const) {
            expect(Math.abs(a[side] - b[side]), `${root.dataset.test} ${side}`).toBeLessThan(1.5);
          }
        }
        // The backdrop filter is the layer's alone: locked off the light
        // element, whose backdrop would take in the layer's own cells.
        const frosted = canvasElement.querySelector<HTMLElement>('[data-test="frosted"]')!;
        expect(getComputedStyle(frosted).backdropFilter).toBe("none");
        expect(boxes.some((box) => getComputedStyle(box).backdropFilter === "blur(2px)")).toBe(
          true,
        );
        // The nested layer's box sits inside its parent's.
        const nested = boxes.filter((box) => box.parentElement!.classList.contains("layer"));
        expect(nested.length).toBe(1);
        // The layers' text lives in their grids alone.
        expect(host.shadowRoot!.getElementById("grid")!.textContent).not.toContain("rotated");
        // The native button is under the pointer where the layer shows
        // it: the light element follows the same transform.
        const ok = canvasElement.querySelector<HTMLElement>('[data-test="ok"]')!;
        const rect = ok.getBoundingClientRect();
        expect(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
        ).toBe(ok);
      },
      { timeout: 10_000 },
    );
    // A layer inside a scroll container follows the scroll: its box
    // moves up by the rows scrolled, its cells with it.
    const scroller = canvasElement.querySelector<HTMLElement>('[data-test="scroller"]')!;
    const scrolled = canvasElement.querySelector<HTMLElement>('[data-test="scrolled"]')!;
    const boxOf = (root: HTMLElement) => {
      const own = getComputedStyle(root);
      return Array.from(
        host.shadowRoot!.getElementById("layers")!.querySelectorAll<HTMLElement>(".layer"),
      ).find((box) => getComputedStyle(box).rotate === own.rotate)!;
    };
    const before = boxOf(scrolled).getBoundingClientRect().top;
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    scroller.scrollTop = cellHeight;
    await waitFor(
      () => expect(boxOf(scrolled).getBoundingClientRect().top).toBeCloseTo(before - cellHeight, 0),
      { timeout: 10_000 },
    );
  },
};

/**
 * The pointer through a layer (specs/layers.md): a text-mode drag
 * across the scaled dialog, and across the rotated badge, selects the
 * characters under the pointer — a cell of the scaled layer's grid is
 * half again as wide as the main grid's, and the badge's cells turn
 * with it, so the press and the drag are mapped through the effects.
 */
export const LayerSelection: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind select="text">
      <div class="flex gap-8 p-2">
        <div data-test="scaled" class="origin-top-left scale-150 border px-1">
          scaled dialog text
        </div>
        <div data-test="rotated" class="rotate-12 border px-1">a rotated badge</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    // The middle of a character as the browser shows it, through the
    // element's own transform.
    const middle = (el: HTMLElement, index: number): Point => {
      const text = el.firstChild as Text;
      const start = text.data.search(/\S/) + index;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    await waitFor(() => expect(host.shadowRoot!.querySelectorAll(".layer").length).toBe(2));
    // The character under the pointer is selected whole.
    const drag = async (name: string, from: number, to: number, selected: string) => {
      const el = canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
      expect(pressAt(el, middle(el, from), 1)).toBe(false);
      dragTo(el, middle(el, to));
      await waitFor(() => expect(document.getSelection()!.toString()).toBe(selected));
      release();
      document.getSelection()!.removeAllRanges();
    };
    await drag("scaled", 2, 10, "aled dial");
    await drag("rotated", 2, 9, "rotated ");
  },
};

/**
 * A transform transition on a layer root (specs/layers.md "Animation
 * is sampled"): the engine re-copies the root's computed effects onto
 * the layer's box every frame — the box follows the browser's own
 * easing and lands on the target — the one layout the settle at its
 * end.
 */
export const LayerTransition: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="p-2">
        <div
          data-test="dialog"
          class="origin-top-left border px-1 transition-transform duration-500"
        >
          a dialog that scales in
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const dialog = canvasElement.querySelector<HTMLElement>('[data-test="dialog"]')!;
    const layers = host.shadowRoot!.getElementById("layers")!;
    let layouts = 0;
    const observer = new MutationObserver(() => layouts++);
    observer.observe(host, { attributes: true, attributeFilter: ["measuring"] });
    dialog.classList.add("scale-125");
    await waitFor(() => expect(layers.querySelector(".layer")).not.toBeNull(), {
      timeout: 10_000,
    });
    const box = layers.querySelector<HTMLElement>(".layer")!;
    const scales = new Set<string>();
    const until = performance.now() + 700;
    while (performance.now() < until) {
      scales.add(getComputedStyle(box).scale);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    observer.disconnect();
    expect(scales.size, "sampled intermediate scales").toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(box).scale).toBe(getComputedStyle(dialog).scale);
    expect(getComputedStyle(dialog).scale).toBe("1.25");
    // At most three layouts, the attribute set and removed by each: the
    // class change's, the transition's start, and the settle at its end.
    expect(layouts, "layouts during the transition").toBeLessThanOrEqual(6);
  },
};
