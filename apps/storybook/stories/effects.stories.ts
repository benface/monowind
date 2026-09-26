import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  cellSize,
  channels,
  countLayouts,
  dragTo,
  expectColor,
  expectRow,
  faded,
  frames,
  gridOf,
  layerBox,
  moveTo,
  nearColor,
  paintedSpan,
  pressAt,
  readyGrid,
  readyHost,
  release,
  rowsOf,
  shown,
  testHooks,
  transitionLayouts,
} from "./helpers.ts";
import type { Point } from "./helpers.ts";

/**
 * Visual effects on the grid: opacity, outlines, box shadows,
 * gradients, and layers (specs/cell-model.md "Opacity and
 * translucency" and "Outlines", specs/box-shadow.md, specs/gradients.md,
 * specs/layers.md), then motion — the transitions and keyframe
 * animations the engine samples every frame (specs/cell-model.md
 * "Animation", specs/animations.md).
 */
const meta: Meta = {
  title: "Features / Effects",
};
export default meta;

export const Opacity: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex gap-2">
          <div data-test="full" class="border border-cyan-400 px-1">opacity-100</div>
          <div class="border border-cyan-400 px-1 opacity-75">opacity-75</div>
          <div class="border border-cyan-400 px-1 opacity-50">opacity-50</div>
          <div class="border border-cyan-400 px-1 opacity-25">opacity-25</div>
          <div class="border border-cyan-400 px-1 opacity-0" data-test="ghost">opacity-0</div>
        </div>
        <div class="border border-fuchsia-400 px-1 opacity-50" data-test="nested">
          <div>Ancestors multiply:</div>
          <div class="opacity-50">nested opacity-50 renders at 0.25</div>
        </div>
        <p>Inline too: <span class="opacity-50">a span at opacity-50</span>.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const ink = getComputedStyle(host).color;
    await waitFor(() => {
      // With nothing beneath it on the grid, a faded element is its
      // spans' opacity, for the browser to composite over the page.
      const spans = Array.from(gridOf(host).querySelectorAll("span"));
      expect(paintedSpan(host, "opacity-75")!.style.opacity).toBe("0.75");
      const color = (text: string) => shown(paintedSpan(host, text))!;
      expectColor(color("opacity-75"), faded(ink, 0.75), "opacity-75");
      expectColor(color("opacity-50"), faded(ink, 0.5), "opacity-50");
      // Groups nest (CSS opacity nests, it doesn't inherit).
      expectColor(color("nested opacity-50"), faded(ink, 0.25), "nested");
      expectColor(color("a span at opacity-50"), faded(ink, 0.5), "a span");
      // opacity-0 still paints its glyphs — transparent, but present
      // and selectable in select="grid" mode (unlike `invisible`).
      expectColor(color("opacity-0"), faded(ink, 0), "opacity-0");
      expect(gridOf(host).textContent).toContain("opacity-0");
      // A border glyph whose color stays translucent is boxed to its
      // cell, its overshoot otherwise composited twice where rows join.
      // Tailwind's cyan-400 lies past sRGB, which the canvas clips.
      const border = getComputedStyle(testHooks(canvasElement)("full")).borderTopColor;
      const cyan = `rgb(${channels(border).slice(0, 3).join(" ")})`;
      const lines = spans.filter((span) => span.textContent === "│");
      const translucent = lines.filter((line) => nearColor(shown(line)!, faded(cyan, 0.75)));
      expect(translucent.length, "the opacity-75 box's lines").toBeGreaterThan(0);
      expect(
        translucent.filter((line) => line.dataset.box === undefined),
        "translucent lines unboxed",
      ).toEqual([]);
    });
  },
};

/** `invisible` (`visibility: hidden`) keeps a box's rows and paints
 * nothing of its own — no text, fill, or border — while a `visible`
 * descendant still paints, and an invisible word leaves its cells
 * blank in its line (specs/visibility.md). */
export const Visibility: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="border border-cyan-400 px-1">shown above</div>
        <div class="invisible border border-cyan-400 bg-cyan-900 px-1">hidden, its rows kept</div>
        <div class="invisible border border-fuchsia-400 px-1">
          <div>hidden parent</div>
          <div class="visible">a visible child shows</div>
        </div>
        <p>a <span class="invisible">secret</span> word kept blank</p>
        <div class="border border-cyan-400 px-1">shown below</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const rowOf = (text: string) => rowsOf(host).findIndex((row) => row.includes(text));
    await waitFor(() => {
      const art = rowsOf(host).join("\n");
      expect(art).toContain("a visible child shows");
      expect(art).not.toContain("hidden");
      expect(art).not.toContain("secret");
    });
    // The hidden box keeps its three rows and its gap: the next box's
    // visible child sits nine rows under the first box's text.
    expect(rowOf("a visible child shows") - rowOf("shown above")).toBe(9);
    // The invisible word's cells stay blank, the words after it where
    // they were.
    expect(rowsOf(host)[rowOf("word kept blank")]).toContain("a        word kept blank");
  },
};

/** Test-only: a fade-out paired with `invisible` keeps its text on the
 * grid until the fade ends, what inherits its visibility included, as
 * CSS shows an element throughout a `visibility` transition; a fade-in
 * closed early with nothing transitioning the close hides at once
 * (specs/visibility.md). */
export const VisibilityFade: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="fading" class="transition-[opacity,visibility] duration-1000">
        fading <b>out</b>
        <p>with its child</p>
      </div>
      <p
        data-test="entering"
        class="invisible data-open:visible data-open:transition-[visibility] data-open:duration-1000"
      >
        entering
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = gridOf(host);
    const by = testHooks(canvasElement);
    by("fading").classList.add("invisible", "opacity-0");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(grid.textContent, "mid-fade").toContain("fading out");
    expect(grid.textContent, "its child mid-fade").toContain("with its child");
    await waitFor(() => expect(grid.textContent).not.toContain("fading"), { timeout: 3000 });
    by("entering").setAttribute("data-open", "");
    await waitFor(() => expect(grid.textContent).toContain("entering"));
    by("entering").removeAttribute("data-open");
    await waitFor(() => expect(grid.textContent).not.toContain("entering"), { timeout: 400 });
  },
};

/** Test-only: a host takes its visibility from the page natively
 * (specs/visibility.md): hidden by an ancestor, it lays its subtree out
 * as if shown, so it shows at once however the ancestor changes — no
 * relayout needed. */
export const HiddenAncestor: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <div data-test="ancestor" class="invisible">
      <mono-wind><p>shown with its host</p></mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = gridOf(host);
    await waitFor(() => expect(grid.textContent).toContain("shown with its host"));
    expect(getComputedStyle(grid).visibility).toBe("hidden");
    // Shown within the same task, before any relayout could run.
    testHooks(canvasElement)("ancestor").classList.remove("invisible");
    expect(getComputedStyle(grid).visibility).toBe("visible");
    expect(grid.textContent).toContain("shown with its host");
  },
};

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
    const by = testHooks(canvasElement);
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
    await waitFor(() => {
      const spans = Array.from(gridOf(host).querySelectorAll("span"));
      // A color per cell, a row of them one span's hard stops: far
      // more distinct colors than boxes.
      const stops = (span: HTMLElement) =>
        span.style.backgroundImage.match(/(?:rgb|color)\([^)]*\)/g) ?? [];
      const colors = spans.flatMap(stops);
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
        const run = stops(spans.find((span) => span.textContent!.startsWith(name))!);
        return run[Math.floor(run.length / 2)]!;
      };
      expect(middle("bg-linear-to-r/longer")).not.toBe(middle("bg-linear-to-r/oklch"));
      // Clipped to text, the row is one span whose hard stops show
      // through its glyphs.
      const clipped = spans.find((span) => span.textContent!.startsWith("bg-clip-text"))!;
      expect(clipped.style.backgroundClip).toBe("text");
      expect(clipped.style.color).toBe("transparent");
      expect(stops(clipped).length).toBeGreaterThan(40);
      // Over a filled parent the glyphs keep a span each, the
      // parent's color under every one.
      const onSky = spans.filter(
        (span) =>
          span.textContent!.length === 1 &&
          /^(?:rgb|color)\(/.test(span.style.color) &&
          span.style.backgroundColor !== "" &&
          span.style.backgroundClip === "",
      );
      expect(onSky.length).toBeGreaterThan(40);
    });
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): a
 * translated layer answers the pointer where the browser draws it, the
 * cells it is laid out at being the main grid's (specs/layers.md). */
export const LayerHit: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-2">
        <div data-test="shifted" class="w-max translate-x-16 border px-1">translated</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const shifted = testHooks(canvasElement)("shifted");
    const layers = host.shadowRoot!.getElementById("layers")!;
    await waitFor(() => expect(layers.querySelector(".layer")).not.toBeNull());
    const { width, height } = cellSize(host);
    const grid = gridOf(host);
    const origin = grid.getBoundingClientRect();
    const cell = (col: number, row: number): Point => ({
      x: origin.left + (col + 0.5) * width,
      y: origin.top + (row + 0.5) * height,
    });
    // The box as the browser draws it, 64px along.
    const box = shifted.getBoundingClientRect();
    const drawn = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const hover = async (at: Point) => {
      moveTo(grid, at);
      await frames();
      return shifted.hasAttribute("data-mw-hover");
    };
    // Its box's first cell untranslated: blank on the main grid.
    expect(await hover(cell(2, 3))).toBe(false);
    expect(await hover(drawn)).toBe(true);
    // A paragraph gesture the same: on its text's first cell untranslated
    // it takes none of it, where the text is drawn it takes it all.
    const selectAt = (at: Point) => {
      document.getSelection()!.removeAllRanges();
      pressAt(grid, at, 3);
      release();
      return document.getSelection()!.toString();
    };
    expect(selectAt(cell(4, 3))).not.toContain("translated");
    expect(selectAt(drawn)).toContain("translated");
    document.getSelection()!.removeAllRanges();
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
    await waitFor(() => {
      const boxes = Array.from(
        host.shadowRoot!.getElementById("layers")!.querySelectorAll<HTMLElement>(".layer"),
      );
      // A box per layer root, its effects the light element's, its
      // rect the element's where nothing overflows the border box.
      const roots = ["rotated", "scaled", "blurred", "grayscale", "shifted", "half", "frosted"].map(
        (name) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!,
      );
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
      expect(boxes.some((box) => getComputedStyle(box).backdropFilter === "blur(2px)")).toBe(true);
      // The nested layer's box sits inside its parent's.
      const nested = boxes.filter((box) => box.parentElement!.classList.contains("layer"));
      expect(nested.length).toBe(1);
      // The layers' text lives in their grids alone.
      expect(gridOf(host).textContent).not.toContain("rotated");
      // The native button is under the pointer where the layer shows
      // it: the light element follows the same transform.
      const ok = canvasElement.querySelector<HTMLElement>('[data-test="ok"]')!;
      const rect = ok.getBoundingClientRect();
      expect(
        document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
      ).toBe(ok);
    });
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
    const cellHeight = cellSize(host).height;
    scroller.scrollTop = cellHeight;
    await waitFor(() =>
      expect(boxOf(scrolled).getBoundingClientRect().top).toBeCloseTo(before - cellHeight, 0),
    );
    // The browser clips the rotated layer to the container's padding
    // box: its box sits in a clipping box at that rect.
    const clip = boxOf(scrolled).parentElement!;
    expect(clip.className).toBe("clip");
    expect(getComputedStyle(clip).overflow).toBe("clip");
    // The container's border is a cell on each side.
    const cellWidth = cellSize(host).width;
    const inner = scroller.getBoundingClientRect();
    const rect = clip.getBoundingClientRect();
    expect(Math.abs(rect.top - (inner.top + cellHeight))).toBeLessThan(1.5);
    expect(Math.abs(rect.left - (inner.left + cellWidth))).toBeLessThan(1.5);
    expect(Math.abs(rect.bottom - (inner.bottom - cellHeight))).toBeLessThan(1.5);
  },
};

/**
 * Later ink covers a layer (specs/layers.md): a modal's overlay and
 * panel, painted after a rotated sticker, cover its cells as they
 * cover everything else — the sticker shows only past the overlay's
 * edge, and the pointer over the overlay reaches the overlay.
 */
export const LayerCover: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="relative h-12 w-64">
        <p class="p-1">A page with a sticker, under a modal.</p>
        <div data-test="sticker" class="absolute top-2 left-2 rotate-6 border px-1">sticker</div>
        <div data-test="overlay" class="absolute inset-y-0 right-0 left-6 bg-black/50">
          <div class="mx-auto mt-3 w-40 border bg-white p-1 text-black">a modal over it</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(() => {
      const box = host.shadowRoot!.querySelector<HTMLElement>(".layer")!;
      expect(box).not.toBeNull();
      // The sticker's cells under the overlay are blank in its grid.
      const rows = box.querySelector("pre")!.textContent!.split("\n");
      expect(rows[1]).toMatch(/^│ st\s*$/);
      // Over the overlay, the engine's hit-test reaches the overlay.
      const overlay = canvasElement.querySelector<HTMLElement>('[data-test="overlay"]')!;
      const rect = overlay.getBoundingClientRect();
      moveTo(overlay, { x: rect.left + 4, y: rect.top + rect.height / 2 });
      expect(overlay.matches("[data-mw-hover], [data-mw-hover] *")).toBe(true);
    });
  },
};

/**
 * Test-only: the pointer through a layer (specs/layers.md): a
 * text-mode drag across the scaled dialog, and across the rotated
 * badge, selects the characters under the pointer — a cell of the
 * scaled layer's grid is half again as wide as the main grid's, and
 * the badge's cells turn with it, so the press and the drag are mapped
 * through the effects.
 */
export const LayerSelection: StoryObj = {
  tags: ["!dev", "!golden"],
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
 * Test-only: a transform transition on a layer root (specs/layers.md
 * "Animation is sampled"): the engine re-copies the root's computed
 * effects onto the layer's box every frame — the box follows the
 * browser's own easing and lands on the target — the one layout the
 * settle at its end.
 */
export const LayerTransition: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-2">
        <div
          data-test="dialog"
          class="origin-top-left border px-1 transition-transform delay-300 duration-1000"
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
    const layouts = countLayouts(host);
    dialog.classList.add("scale-125");
    // The box's scale every frame it exists, until the dialog's lands:
    // the layer opens on the identity the delay holds.
    const scales = new Set<string>();
    while (getComputedStyle(dialog).scale !== "1.25") {
      const box = layers.querySelector<HTMLElement>(".layer");
      if (box) scales.add(getComputedStyle(box).scale);
      await frames();
    }
    await waitFor(() =>
      expect(getComputedStyle(layers.querySelector(".layer")!).scale).toBe("1.25"),
    );
    layouts.stop();
    expect(scales.has("1"), "the box at the identity").toBe(true);
    expect(scales.size, "sampled intermediate scales").toBeGreaterThanOrEqual(4);
    // At most three layouts: the class change's, the transition's start,
    // and the settle at its end.
    expect(layouts.count, "layouts during the transition").toBeLessThanOrEqual(3);
  },
};

/**
 * Test-only: a transform transition on an element that is a layer
 * root already starts with no layout of its own, a rule outside the
 * host setting it: the box its frames copy onto exists.
 */
export const LayerRootTransition: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-2">
        <div
          data-test="tilted"
          class="w-max origin-top-left rotate-3 border px-1 transition-transform duration-3000"
        >
          tilted
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(() => expect(layerBox(host, "tilted")).toBeDefined());
    const layouts = countLayouts(host);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('[data-test="tilted"] { rotate: 6deg; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    try {
      const rotations = new Set<string>();
      for (let i = 0; i < 10; i++) {
        await frames();
        rotations.add(getComputedStyle(layerBox(host, "tilted")!).rotate);
      }
      expect(layouts.count, "layouts over the transition's first frames").toBe(0);
      expect(rotations.size, "the box's sampled rotations").toBeGreaterThanOrEqual(5);
    } finally {
      layouts.stop();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet);
    }
  },
};

/**
 * Test-only: an opacity transition is sampled as its keyframe
 * animation is (specs/animations.md): each frame repaints the last
 * layout at the frame's opacity, no layout between frames, and the end
 * lands the cells; a layer root's fades its box. A color
 * changing beside it relays out each frame, the color reaching what
 * inherits it.
 */
export const OpacityTransitions: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-4 p-2">
        <div
          data-test="fade"
          class="bg-[rgb(37,99,235)] px-1 text-[rgb(255,255,0)] transition-opacity duration-500"
        >
          fade
        </div>
        <div
          data-test="moving"
          class="scale-90 bg-[rgb(37,99,235)] px-1 text-[rgb(255,255,0)] transition duration-500"
        >
          moving
        </div>
        <div
          data-test="colored"
          class="bg-[rgb(37,99,235)] px-1 text-[rgb(255,255,0)] transition duration-500"
        >
          colored
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const layouts = countLayouts(host);
    /** A class change's fade to half: the layouts over its frames to
     * its end, their count, and what they showed. */
    const fade = async (name: string, change: (classes: DOMTokenList) => void) => {
      const el = by(name);
      const seen = new Set<string>();
      const faded = await transitionLayouts(
        layouts,
        () => change(el.classList),
        () => getComputedStyle(el).opacity === "0.5",
        {
          sample: () => {
            const box = layerBox(host, name);
            seen.add(
              box
                ? getComputedStyle(box).opacity
                : shown(paintedSpan(host, name), "backgroundColor")!,
            );
          },
        },
      );
      return { ...faded, shown: seen.size };
    };
    /** The cells landed on the grid, nothing beneath them: the label
     * over the fill, the span at half. */
    const landed = (name: string, label: string) =>
      waitFor(() => {
        expect(layerBox(host, name)).toBeUndefined();
        const cells = paintedSpan(host, name)!;
        expect(cells.style.opacity, `${name}'s opacity`).toBe("0.5");
        expectColor(cells.style.color, label, `${name}'s label`);
        expectColor(cells.style.backgroundColor, "rgb(37, 99, 235)", `${name}'s fill`);
      });
    const opacity = await fade("fade", (classes) => classes.add("opacity-50"));
    expect(opacity.during, "layouts during the fade").toBe(0);
    expect(opacity.shown, "the fade's colors").toBeGreaterThanOrEqual(3);
    await landed("fade", "rgb(255, 255, 0)");
    // Scaling back to the identity: a layer root while it moves.
    const moving = await fade("moving", (classes) => {
      classes.remove("scale-90");
      classes.add("opacity-50");
    });
    expect(moving.during, "layouts during the moving fade").toBe(0);
    expect(moving.shown, "the moving box's opacities").toBeGreaterThanOrEqual(3);
    await landed("moving", "rgb(255, 255, 0)");
    const colored = await fade("colored", (classes) => {
      classes.replace("text-[rgb(255,255,0)]", "text-[rgb(0,255,255)]");
      classes.add("opacity-50");
    });
    expect(colored.during, "layouts during the colored fade").toBeGreaterThanOrEqual(
      colored.frames / 2,
    );
    await landed("colored", "rgb(0, 255, 255)");
    layouts.stop();
  },
};

/** Test-only: transitions staggered to end one after another land with
 * the frames the loop runs anyway — an ended fade's cells repainted at
 * its value, an ended effect's box placed again — and the loop's last
 * layout; none lays out at its own end (specs/animations.md). */
export const StaggeredTransitions: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex gap-2 p-2">
        ${[0, 1, 2, 3].map(
          (i) => html`
            <div
              data-test="moving-${i}"
              class="border px-1 transition-transform duration-200"
              style="transition-delay: ${i * 150}ms"
            >
              m${i}
            </div>
            <div
              data-test="fading-${i}"
              class="px-1 text-[rgb(255,255,0)] transition-opacity duration-200"
              style="transition-delay: ${i * 150}ms"
            >
              f${i}
            </div>
          `,
        )}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const items = [0, 1, 2, 3];
    const runs = (name: string) => by(name).getAnimations().length > 0;
    const layouts = countLayouts(host);
    for (const i of items) {
      by(`moving-${i}`).classList.add("translate-y-2");
      by(`fading-${i}`).classList.add("opacity-50");
    }
    await frames();
    // The first fade's cells, each frame from its end to the last's.
    const landing: string[] = [];
    let ran = 0;
    while (items.some((i) => runs(`moving-${i}`) || runs(`fading-${i}`)) && ran++ < 120) {
      if (!runs("fading-0") && runs("fading-3")) landing.push(shown(paintedSpan(host, "f0"))!);
      await frames();
    }
    await frames(3);
    layouts.stop();
    expect(landing.length, "frames from the first fade's end to the last's").toBeGreaterThan(4);
    const half = faded("rgb(255, 255, 0)", 0.5);
    for (const color of landing.slice(1)) expectColor(color, half, "the first fade's cells");
    await waitFor(() => {
      const box = getComputedStyle(layerBox(host, "m3")!);
      expect(box.translate).toBe(getComputedStyle(by("moving-3")).translate);
    });
    // The class changes' layout, the one opening the moving items'
    // layers, and the loop's last.
    expect(layouts.count, "layouts across the staggered transitions").toBeLessThanOrEqual(3);
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
    const grid = gridOf(host);
    await waitFor(() => {
      for (const label of [
        "half a second",
        "stays put",
        "synthesizes",
        "mostly away",
        "a slow ease-in",
      ])
        expect(grid.textContent).toContain(label);
    });
  },
};

/** Test-only (hidden from the sidebar): drives the class toggles the
 * hoverable Transitions story leaves to the user's pointer, and
 * asserts on the sampled/synthesized frames. */
export const TransitionSampling: StoryObj = {
  tags: ["!dev", "!golden"],
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
    await waitFor(() => expect(paintedSpan(host, "Toggle")).toBeDefined());
    const colors = new Set<string>();
    const backgrounds = new Set<string>();
    const snaps = new Set<string>();
    fader.classList.replace("text-cyan-400", "text-rose-400");
    fader.classList.add("bg-indigo-600");
    snapper.classList.add("opacity-25");
    const until = performance.now() + 900;
    while (performance.now() < until) {
      const span = paintedSpan(host, "Toggle");
      if (span) {
        colors.add(span.style.color);
        backgrounds.add(span.style.backgroundColor);
      }
      const snapped = paintedSpan(host, "My opacity");
      if (snapped) snaps.add(shown(snapped)!);
      await frames();
    }
    // Several distinct interpolated values each, ending exactly on the
    // authored targets.
    expect(colors.size, "sampled intermediate colors").toBeGreaterThanOrEqual(3);
    expect(backgrounds.size, "synthesized intermediate backgrounds").toBeGreaterThanOrEqual(3);
    // The authored transition-property list is respected: opacity is
    // not in transition-colors, so it snaps — its color at full
    // straight to the target's, nothing interpolated.
    const ink = getComputedStyle(snapper).color;
    expect(snaps.size, "opacity snaps").toBe(2);
    expect([...snaps].some((color) => nearColor(color, ink))).toBe(true);
    expect([...snaps].some((color) => nearColor(color, faded(ink, 0.25)))).toBe(true);
    await waitFor(() =>
      expect(paintedSpan(host, "Toggle")!.style.color).toBe(getComputedStyle(fader).color),
    );
  },
};

/** Test-only: one layout a frame while a color transition relays out
 * each one — a change between frames, or in a frame's callbacks before
 * the sampling's, lays out once with it. A frame's layouts are those
 * from its first callback to the next frame's, a stray between frames
 * counting with the frame before it. */
export const OneLayoutAFrame: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="colored" class="text-[rgb(255,255,0)] transition-colors duration-1000">
        colored
      </div>
      <div data-test="timer">0</div>
      <div data-test="frames">0</div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const layouts = countLayouts(host);
    const perFrame: number[] = [];
    let count = 0;
    let timer = 0;
    await new Promise<void>((done) => {
      let frame = 0;
      let last = 0;
      // Registered before the change and again first thing: first in
      // every frame, ahead of the engine's callbacks.
      const onFrame = () => {
        if (frame < 30) requestAnimationFrame(onFrame);
        const now = layouts.count;
        if (frame > 0) perFrame.push(now - last);
        last = now;
        if (frame === 0) {
          by("colored").classList.replace("text-[rgb(255,255,0)]", "text-[rgb(0,255,255)]");
          timer = window.setInterval(() => (by("timer").textContent = String(++count)), 4);
        } else {
          by("frames").textContent = String(count);
        }
        if (frame++ === 30) done();
      };
      requestAnimationFrame(onFrame);
    });
    clearInterval(timer);
    layouts.stop();
    expect(perFrame.filter((each) => each > 1).length, "frames laid out twice").toBe(0);
    expect(perFrame.filter((each) => each === 1).length, "frames laid out").toBeGreaterThanOrEqual(
      15,
    );
    await expectRow(host, String(count));
  },
};

/** Test-only: an element removed mid transition ends its sampling —
 * each frame asks what runs under the host, where the cancel event
 * reaches the host no more (specs/animations.md). */
export const RemovedMidTransition: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="colored" class="text-[rgb(255,255,0)] transition-colors duration-1000">
        colored
      </div>
      <p>stays</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const layouts = countLayouts(host);
    by("colored").classList.replace("text-[rgb(255,255,0)]", "text-[rgb(0,255,255)]");
    await frames(5);
    expect(layouts.count, "layouts while it transitions").toBeGreaterThanOrEqual(3);
    // The removal's layout, and the loop's last.
    by("colored").remove();
    await frames(3);
    const removed = layouts.count;
    await frames(20);
    layouts.stop();
    expect(layouts.count - removed, "layouts once it left").toBe(0);
  },
};

/** Test-only: a layout's settling round (specs/cell-model.md
 * "Animation") masks what a lock's snap back could start a transition
 * on — an element, or the host, with a non-zero duration or delay —
 * and nothing else: an element without either drops its measuring
 * flag with no settling flag, and no layout starts a transition. */
export const SettleRound: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="still" class="border bg-neutral-800 px-1">No transition.</div>
      <div data-test="fading" class="border bg-neutral-800 px-1 transition-colors duration-300">
        A transition.
      </div>
      <div data-test="delayed" class="border bg-neutral-800 px-1 delay-300">A delay alone.</div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const settled = new Set<Element>();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.oldValue === null) settled.add(record.target as Element);
      }
    });
    observer.observe(host, {
      subtree: true,
      attributeFilter: ["settling", "data-mw-settling"],
      attributeOldValue: true,
    });
    const transitions = () =>
      host.getAnimations({ subtree: true }).filter((each) => each instanceof CSSTransition);
    by("still").dataset.state = "a";
    await waitFor(() => expect(settled.has(by("fading"))).toBe(true));
    expect(settled.has(by("delayed"))).toBe(true);
    expect(settled.has(by("still"))).toBe(false);
    expect(settled.has(host)).toBe(false);
    expect(transitions()).toEqual([]);
    // The host's own transition settles it.
    host.classList.add("transition-colors");
    await waitFor(() => expect(settled.has(host)).toBe(true));
    expect(settled.has(by("still"))).toBe(false);
    expect(transitions()).toEqual([]);
    observer.disconnect();
  },
};

/** The fades TransitionEasing runs, each over a second. */
const EASED_FADES = [
  { name: "bezier", easing: "cubic-bezier(0.4, 0, 0.2, 1)", delay: "0s" },
  { name: "ease-in", easing: "ease-in", delay: "300ms" },
  { name: "steps", easing: "steps(4)", delay: "0s" },
  { name: "jump-start", easing: "steps(1, start)", delay: "300ms" },
  { name: "jump-none", easing: "steps(3, jump-none)", delay: "0s" },
  { name: "linear", easing: "linear(0, 0.8 20%, 1)", delay: "0s" },
  // A transition fills backwards: its delay shows the easing's start.
  { name: "halfway", easing: "linear(0.5, 1)", delay: "300ms" },
];

/** Test-only: a synthesized background fade eases as CSS does. Each
 * box's text color, which the browser transitions with the same
 * duration, delay, and timing function, is the reference: each frame's
 * painted red lies within the reds the text took from the fade's lag
 * back through the next frame. The fade trails the browser's by frames
 * — the layout that arms it, its timing starting then or a frame later,
 * and the paint after each read — so the lag is read off those frames'
 * own times, and a long frame keeps the sample before it. */
export const TransitionEasing: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        ${EASED_FADES.map(
          ({ name, easing, delay }) => html`
            <div
              data-test=${name}
              class="px-1"
              style="transition-property: color, background-color; transition-duration: 1s; transition-timing-function: ${easing}; transition-delay: ${delay}; color: rgb(0, 0, 0); background-color: rgb(0, 0, 0)"
            >
              ${name}
            </div>
          `,
        )}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const red = (color = ""): number => channels(color)[0]! / 255;
    const samples = EASED_FADES.map(
      () => [] as { time: number; text: number; background: number }[],
    );
    const running = () => samples.some((fade) => fade.at(-1)!.text < 1);
    const change = 2;
    let held = false;
    let time = await frames();
    for (let frame = 0; frame <= change || (running() && frame < 600); frame++) {
      EASED_FADES.forEach(({ name }, i) =>
        samples[i]!.push({
          time,
          text: red(getComputedStyle(by(name)).color),
          background: red(paintedSpan(host, name)?.style.backgroundColor),
        }),
      );
      if (frame === change) {
        for (const { name } of EASED_FADES) {
          by(name).style.color = "rgb(255, 0, 0)";
          by(name).style.backgroundColor = "rgb(255, 0, 0)";
        }
      }
      // One frame held 200 ms, as a loaded machine holds one, across the
      // delays' end.
      if (!held && frame > change && time - samples[0]![change]!.time > 250) {
        held = true;
        const until = performance.now() + 200;
        while (performance.now() < until);
      }
      time = await frames();
    }
    await waitFor(() => {
      for (const { name } of EASED_FADES) {
        expect(red(paintedSpan(host, name)?.style.backgroundColor), name).toBe(1);
      }
    });
    const lag = samples[0]![change + 2]!.time - samples[0]![change]!.time;
    EASED_FADES.forEach(({ name }, i) => {
      const fade = samples[i]!;
      fade.forEach(({ background }, j) => {
        // The text over time[j − 1] − lag − 1 ms ≤ t ≤ time[j + 1] bounds
        // background[j], ± 0.02. A fade whose timing starts a frame later
        // reads at time[j − 1] − lag itself, a text sample's time, where a
        // step can land and each clock rounds to its own side of it: the
        // millisecond keeps both.
        const since = fade[Math.max(0, j - 1)]!.time - lag - 1;
        const texts = fade
          .slice(0, j + 2)
          .filter((_, k) => (fade[k + 1]?.time ?? Infinity) > since)
          .map(({ text }) => text);
        expect(background, `${name}, frame ${j}`).toBeGreaterThanOrEqual(Math.min(...texts) - 0.02);
        expect(background, `${name}, frame ${j}`).toBeLessThanOrEqual(Math.max(...texts) + 0.02);
      });
    });
    const shades = new Set(samples[0]!.map(({ background }) => background));
    expect(shades.size, "the bezier's intermediate backgrounds").toBeGreaterThanOrEqual(5);
  },
};

/**
 * Keyframe animations (specs/animations.md): the engine samples a
 * running CSS animation as it samples a transition — a spinner's
 * layer turns every frame, a pulsing skeleton's cells fade with a
 * repaint and no layout between frames, `animate-ping` scales and
 * fades its box, a bouncing hint moves its box, an enter keyframe
 * lands on its end state, and a background keyframe reads through the
 * relayout with no synthesized fade on top.
 */
export const Animations: StoryObj = {
  // Infinite animations have no still state a golden could pin.
  tags: ["!golden"],
  render: () => html`
    <style>
      @keyframes story-enter {
        from {
          opacity: 0;
          transform: scale(0.5);
        }
      }
      @keyframes story-bg {
        from {
          background-color: rgb(255, 0, 0);
        }
        to {
          background-color: rgb(0, 0, 255);
        }
      }
      @keyframes story-leave {
        to {
          opacity: 0.25;
          transform: scale(0.5);
        }
      }
    </style>
    <mono-wind>
      <div class="flex flex-wrap items-start gap-x-8 gap-y-4 p-2">
        <div data-test="spin" class="animate-spin border px-1">spin</div>
        <div data-test="pulse" class="animate-pulse border bg-neutral-400 px-1">pulse</div>
        <div data-test="ping" class="animate-ping border px-1">ping</div>
        <div data-test="bounce" class="animate-bounce border px-1">bounce</div>
        <div data-test="enter" class="border px-1" style="animation: story-enter 600ms ease-out">
          enter
        </div>
        <div
          data-test="leave"
          class="border px-1"
          style="animation: story-leave 600ms ease-in forwards"
        >
          leave
        </div>
        <div
          data-test="bg"
          class="border px-1 transition-colors duration-1000"
          style="animation: story-bg 4s linear infinite"
        >
          background
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const layouts = countLayouts(host);
    // Over half a second and at least two dozen frames: the spinner's
    // box turns, the pulse's cells fade, the ping's box scales, the
    // bounce moves.
    const turns = new Set<string>();
    const fades = new Set<string>();
    const pings = new Set<string>();
    const bounces = new Set<string>();
    const until = performance.now() + 600;
    let sampled = 0;
    while (performance.now() < until || sampled < 24) {
      sampled++;
      const spin = layerBox(host, "spin");
      if (spin) turns.add(getComputedStyle(spin).transform);
      const pulse = paintedSpan(host, "pulse");
      fades.add(`${shown(pulse)} ${shown(pulse, "backgroundColor")}`);
      const ping = layerBox(host, "ping");
      if (ping) pings.add(getComputedStyle(ping).transform);
      const bounce = layerBox(host, "bounce");
      if (bounce) bounces.add(getComputedStyle(bounce).transform);
      await frames();
    }
    layouts.stop();
    expect(turns.size, "spinner frames").toBeGreaterThanOrEqual(5);
    expect(fades.size, "pulse frames").toBeGreaterThanOrEqual(5);
    expect(pings.size, "ping frames").toBeGreaterThanOrEqual(5);
    expect(bounces.size, "bounce frames").toBeGreaterThanOrEqual(5);
    // The background keyframe reads through the relayout, a layout a
    // frame; the pulse alone would take the repaint path.
    expect(layouts.count, "layouts under the background keyframe").toBeGreaterThanOrEqual(
      sampled / 4,
    );
    // The enter keyframe has landed: the box is gone, the cells at full
    // opacity. The leave keyframe holds its end (`forwards`): the settle
    // layout reads the filled values, the box scaled and at a quarter,
    // the cells unfaded inside it.
    await waitFor(() => {
      for (const name of ["enter", "leave"]) {
        const running = by(name)
          .getAnimations()
          .some((a) => a.playState === "running");
        expect(running, `${name} running`).toBe(false);
      }
      expect(layerBox(host, "enter")).toBeUndefined();
      expectColor(paintedSpan(host, "enter")!.style.color, getComputedStyle(by("enter")).color);
      const leave = layerBox(host, "leave")!;
      expect(getComputedStyle(leave).transform).toBe(getComputedStyle(by("leave")).transform);
      expect(getComputedStyle(leave).opacity).toBe("0.25");
      const cells = Array.from(leave.querySelectorAll("span")).find((span) =>
        span.textContent!.includes("leave"),
      )!;
      expectColor(cells.style.color, getComputedStyle(by("leave")).color);
    });
    // The spinner keeps its box through the identity at each turn.
    expect(layerBox(host, "spin")).toBeDefined();
  },
};

/**
 * Test-only: the lighter paths of an animation (specs/animations.md):
 * a pulse alone resamples opacity onto its node and repaints, a spin
 * alone places its box again — neither lays out per frame; a paused
 * spin holds its frame and turns again once resumed; an animation
 * ending beside one still running lands its value with a layout.
 */
export const AnimationPaths: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <style>
      @keyframes story-flash {
        from {
          background-color: rgb(255, 0, 0);
        }
        to {
          background-color: rgb(0, 0, 255);
        }
      }
      @keyframes story-fade {
        50% {
          opacity: 0.5;
        }
      }
    </style>
    <mono-wind>
      <div class="flex gap-8 p-2">
        <div data-test="pulse" class="animate-pulse border px-1">pulse</div>
        <div data-test="spin" class="animate-spin border px-1">spin</div>
        <div data-test="mixed" class="border px-1" style="background-color: rgb(0, 128, 0)">
          mixed
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await waitFor(() => expect(layerBox(host, "spin")).toBeDefined());
    // The animations' first layouts have run; from here, frames repaint
    // and place the box with no layout between them.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const layouts = countLayouts(host);
    const sample = async (ms: number) => {
      const fades = new Set<string>();
      const turns = new Set<string>();
      const until = performance.now() + ms;
      while (performance.now() < until) {
        fades.add(shown(paintedSpan(host, "pulse")) ?? "");
        turns.add(getComputedStyle(layerBox(host, "spin")!).transform);
        await frames();
      }
      return { fades, turns };
    };
    const running = await sample(600);
    layouts.stop();
    expect(running.fades.size, "pulse frames").toBeGreaterThanOrEqual(5);
    expect(running.turns.size, "spin frames").toBeGreaterThanOrEqual(5);
    expect(layouts.count, "layouts during the animations").toBe(0);
    // Paused, the spin's box holds its frame while the pulse goes on;
    // resumed, its next iteration brings it back.
    const spin = canvasElement.querySelector<HTMLElement>('[data-test="spin"]')!;
    spin.style.animationPlayState = "paused";
    await new Promise((resolve) => setTimeout(resolve, 100));
    const paused = await sample(300);
    expect(paused.turns.size, "paused spin frames").toBe(1);
    expect(paused.fades.size, "pulse frames beside a paused spin").toBeGreaterThanOrEqual(3);
    spin.style.animationPlayState = "";
    await waitFor(async () => expect((await sample(200)).turns.size).toBeGreaterThanOrEqual(3));
    // A one-shot background keyframe beside an infinite fade: the
    // frames read it through the relayout, and its end lands the
    // authored background while the fade's repaints go on.
    const mixed = canvasElement.querySelector<HTMLElement>('[data-test="mixed"]')!;
    // The authored green at the fade's opacity of the moment, nothing
    // lying beneath the box.
    const green = (): boolean => {
      const span = paintedSpan(host, "mixed");
      return (
        span !== undefined &&
        nearColor(span.style.backgroundColor, "rgb(0, 128, 0)") &&
        Number(span.style.opacity || 1) >= 0.5
      );
    };
    mixed.style.animation = "story-flash 300ms linear, story-fade 1s linear infinite";
    await waitFor(() => expect(green()).toBe(false));
    await waitFor(() => expect(green()).toBe(true));
    expect(mixed.getAnimations().some((a) => a.playState === "running")).toBe(true);
  },
};
