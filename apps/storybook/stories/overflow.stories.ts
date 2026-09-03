import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Overflow (specs/scrolling.md): `clip` culls at the padding box;
 * `scroll` and `auto` make scroll containers — native scroll physics
 * on the light element, cell-quantized mirroring on the grid,
 * engine-drawn bars (track `░`, thumb `█`) through the glyph-set
 * roles. `auto` reserves its gutter only when content overflows and
 * then looks exactly like `scroll`.
 */
const meta: Meta = {
  title: "Features / Overflow",
};
export default meta;

const LINES = Array.from({ length: 12 }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`);
const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

export const Overflow: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div data-test="clip" class="h-6 max-w-full overflow-y-clip border px-1">
          [overflow-y-clip] ${LOREM}
        </div>
        <div data-test="scroll" class="h-6 max-w-full overflow-y-scroll border px-1">
          [overflow-y-scroll] ${LOREM}
        </div>
        <div data-test="scroll-fits" class="h-6 max-w-full overflow-y-scroll border px-1">
          [overflow-y-scroll, fits] short content — the bar still shows, with a full-length thumb.
        </div>
        <div data-test="auto" class="h-6 max-w-full overflow-y-auto border px-1">
          [overflow-y-auto] ${LOREM}
        </div>
        <div data-test="fits" class="h-6 max-w-full overflow-y-auto border px-1">
          [overflow-y-auto, fits] short content — no bar, no gutter.
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const box = (name: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const rows = () => grid.textContent!.split("\n");
    const cellHeight = () => host.getBoundingClientRect().height / rows().length;
    // Invariant-based (the story is RESPONSIVE — resize the viewport
    // to see auto flip): bar presence follows each box's actual
    // overflow state, not a hardcoded expectation.
    const barsIn = (name: string): string => {
      const rect = box(name).getBoundingClientRect();
      const top = host.getBoundingClientRect().top;
      return rows()
        .slice(
          Math.round((rect.top - top) / cellHeight()),
          Math.round((rect.bottom - top) / cellHeight()),
        )
        .map((row) => row.replace(/[^░█]/g, ""))
        .join("");
    };
    // Native range equals the engine's (specs/scrolling.md), give or
    // take a rounding pixel.
    const overflows = (name: string): boolean =>
      box(name).scrollHeight - box(name).clientHeight > 1;
    await waitFor(
      () => {
        // clip: never a bar. scroll: always a bar — full-length thumb
        // (no track glyphs) when content fits.
        expect(barsIn("clip")).toBe("");
        expect(barsIn("scroll")).not.toBe("");
        expect(barsIn("scroll-fits")).not.toContain("░");
        expect(barsIn("scroll-fits")).toContain("█");
        // auto: identical to scroll when overflowing, nothing when not.
        if (overflows("auto")) expect(barsIn("auto")).toBe(barsIn("scroll"));
        else expect(barsIn("auto")).toBe("");
        expect(barsIn("fits")).toBe("");
      },
      { timeout: 10_000 },
    );
  },
};

/** `overscroll-behavior` at a box's end (specs/scrolling.md): a
 * fresh wheel gesture chains to the page under `auto`, stays put
 * under `none` (`contain` behaves the same on the grid — there is no
 * local bounce for `none` to suppress). The spacer below makes the
 * page scrollable so chaining shows. */
export const Overscroll: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div data-test="auto" class="h-6 max-w-full overflow-y-auto border px-1">
          [overscroll-auto] scroll to either end, release, and wheel again: the page scrolls (the
          default). ${LOREM} ${LOREM}
        </div>
        <div data-test="none" class="h-6 max-w-full overflow-y-auto overscroll-none border px-1">
          [overscroll-none] wheeling at an end stays here; the page never moves. ${LOREM} ${LOREM}
        </div>
      </div>
    </mono-wind>
    <div class="h-screen"></div>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Routed wheels are a grid-mode feature (text mode scrolls natively
    // and ignores synthetic ticks) — the visual sweep pins text mode.
    if (host.getAttribute("select") !== "grid") return;
    const box = (name: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    // A fresh wheel tick over the box (gestures are latched by
    // pointer position and quiesce, so each tick waits out the window).
    const wheel = async (name: string, deltaY: number): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const rect = box(name).getBoundingClientRect();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 40,
        clientY: rect.top + rect.height / 2,
        deltaY,
      });
      host.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // At the top: wheeling up chains under auto (not consumed)...
    expect(await wheel("auto", -40)).toBe(false);
    // ...and is consumed, inert, under none.
    expect(await wheel("none", -40)).toBe(true);
    // Wheeling down scrolls every box.
    expect(await wheel("auto", 40)).toBe(true);
  },
};

export const Styled: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div data-test="thin" class="h-6 w-24 scrollbar-thin overflow-y-scroll border px-1">
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div data-test="none" class="h-6 w-24 scrollbar-none overflow-y-scroll border px-1">
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div data-test="inherited" class="h-6 w-24 overflow-y-scroll border px-1 text-sky-300">
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div
          data-test="colored"
          class="h-6 w-24 scrollbar-thumb-yellow-400 scrollbar-track-yellow-400/25 overflow-y-scroll border px-1"
        >
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div data-test="ascii" class="h-6 w-24 overflow-y-scroll border px-1 borders-ascii">
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div data-test="wide" class="h-6 w-24 overflow-y-scroll border px-1 scrollbar-2">
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
        <div
          data-test="overlay"
          class="h-6 w-24 scrollbar-track-transparent overflow-y-scroll border px-1 not-hover:scrollbar-thumb-transparent"
        >
          ${LINES.map((line) => html`<div>${line}</div>`)}
        </div>
      </div>
      <div data-test="xtrack" class="mt-1 w-40 overflow-x-scroll border p-1 pt-0 whitespace-nowrap">
        a horizontal box with a reserved track row under this long line
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const box = (name: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    // The resolved `scrollbar-color` thumb (first of the two colors).
    const thumbColor = (el: HTMLElement) =>
      getComputedStyle(el).scrollbarColor.split(") ")[0] + ")";
    const painted = (glyph: string, color: string) =>
      Array.from(grid.querySelectorAll("span")).some(
        (span) => span.textContent!.includes(glyph) && span.style.color === color,
      );
    await waitFor(
      () => {
        const art = grid.textContent!;
        // scrollbar-none still scrolls (its width is checked below).
        expect(box("none")).toHaveAttribute("data-mw-scroll");
        // ascii glyph set: 7-bit track and thumb.
        expect(art).toContain("|");
        expect(art).toContain("#");
        // Horizontal reserved track under the x-scroll box.
        expect(art.split("\n").some((row) => row.includes("░"))).toBe(true);
        // Default ink is the container's own color, thumb and track alike.
        const inherited = getComputedStyle(box("inherited")).color;
        expect(painted("█", inherited)).toBe(true);
        expect(painted("░", inherited)).toBe(true);
        // scrollbar-color paints the thumb in the resolved color.
        expect(painted("█", thumbColor(box("colored")))).toBe(true);
      },
      { timeout: 10_000 },
    );
    // thin means the default 1-cell gutter; none reserves no gutter,
    // so its content box is one cell wider (the gutter rides the
    // engine-written padding). Headless Firefox computes
    // scrollbar-width: none on every element, where the engine ignores
    // the property (specs/scrolling.md) — probed on the host.
    if (getComputedStyle(host).scrollbarWidth !== "none") {
      expect(parseFloat(getComputedStyle(box("thin")).paddingRight)).toBeGreaterThan(
        parseFloat(getComputedStyle(box("none")).paddingRight),
      );
    }
    // scrollbar-2: a two-cell gutter — the thumb doubles up.
    await waitFor(
      () => expect(grid.textContent!.split("\n").some((row) => row.includes("██"))).toBe(true),
      { timeout: 10_000 },
    );
    // An overlay-style bar: transparent ink until hovered. Hover is the
    // engine's synthesized state in grid mode (the visual sweep pins
    // text mode, where native :hover would need a real pointer).
    if (host.getAttribute("select") !== "grid") return;
    const overlay = box("overlay");
    expect(thumbColor(overlay)).toBe("rgba(0, 0, 0, 0)");
    const rect = overlay.getBoundingClientRect();
    host.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await waitFor(
      () => {
        expect(overlay).toHaveAttribute("data-mw-hover");
        expect(thumbColor(overlay)).not.toBe("rgba(0, 0, 0, 0)");
        expect(painted("█", thumbColor(overlay))).toBe(true);
      },
      { timeout: 10_000 },
    );
    host.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  },
};

/** `overflow-scroll` / `overflow-auto`: both axes scroll, two bars,
 * a blank corner cell where they meet. Responsive: narrow the viewport
 * until the lines overflow sideways and `auto` grows its bottom bar. */
export const BothAxes: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div data-test="scroll" class="h-6 overflow-scroll border px-1 whitespace-nowrap">
          <div>[overflow-scroll] both bars always reserved</div>
          ${LINES.map((line) => html`<div>${line} — runs past the right edge</div>`)}
        </div>
        <div data-test="auto" class="h-6 overflow-auto border px-1 whitespace-nowrap">
          <div>[overflow-auto] a bar per axis that overflows — narrow the viewport</div>
          ${LINES.map((line) => html`<div>${line} — runs past the right edge</div>`)}
        </div>
        <div
          data-test="sized"
          class="h-6 overflow-auto border px-1 whitespace-nowrap scrollbar-x-1 scrollbar-y-2"
        >
          <div>[overflow-auto scrollbar-x-1 scrollbar-y-2] per-bar thickness</div>
          ${LINES.map((line) => html`<div>${line} — runs past the right edge</div>`)}
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const auto = canvasElement.querySelector<HTMLElement>('[data-test="auto"]')!;
    // Invariant-based: the lines overflow sideways only below a certain
    // viewport width (the story is responsive).
    const overflowsX = () => auto.scrollWidth - auto.clientWidth > 1;
    await waitFor(
      () => {
        const rows = grid.textContent!.split("\n");
        // `scroll` always reserves both bars: a bottom bar row ends with
        // the blank corner cell before the border; the right bar runs
        // down the rows above it.
        expect(rows.some((row) => /[░█]+ │/.test(row))).toBe(true);
        expect(rows.filter((row) => /[░█]│/.test(row)).length).toBeGreaterThan(2);
        // The line tails are culled only when they actually overflow.
        if (overflowsX()) expect(grid.textContent).not.toContain("right edge");
        else expect(grid.textContent).toContain("right edge");
        expect(grid.textContent).not.toContain("line 12");
        // scrollbar-y-2 doubles the vertical bar only: a two-cell thumb
        // beside a one-cell-tall bottom bar.
        expect(rows.some((row) => /██│/.test(row))).toBe(true);
      },
      { timeout: 10_000 },
    );
    // Both offsets mirror: scrolled to the far corner, the auto box
    // shows its last line (and, when it overflows sideways, the tail).
    auto.scrollTo(1000, 1000);
    await waitFor(
      () => {
        expect(grid.textContent).toContain("line 12");
        if (overflowsX()) expect(grid.textContent).toContain("right edge");
      },
      { timeout: 10_000 },
    );
    auto.scrollTo(0, 0);
  },
};

export const Nested: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="h-8 w-48 overflow-y-auto border py-1 ps-3 pe-2">
        <div>above the inner box</div>
        <div data-test="inner" class="h-4 overflow-y-auto border">
          ${LINES.map((line) => html`<div>inner ${line}</div>`)}
        </div>
        ${LINES.map((line) => html`<div>outer ${line}</div>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const inner = canvasElement.querySelector<HTMLElement>('[data-test="inner"]')!;
    await waitFor(
      () => {
        expect(inner).toHaveAttribute("data-mw-scroll");
        expect(grid.textContent).toContain("inner line 01");
        // The outer box clips: late outer lines stay outside the grid.
        expect(grid.textContent).not.toContain("outer line 12");
      },
      { timeout: 10_000 },
    );
    // Scrolling the inner box leaves the outer content in place.
    inner.scrollTop = 1000;
    await waitFor(
      () => {
        expect(grid.textContent).not.toContain("inner line 01");
        expect(grid.textContent).toContain("above the inner box");
      },
      { timeout: 10_000 },
    );
    inner.scrollTop = 0;
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): exercises
 * programmatic scrolling, which visibly moves the box — in a visible
 * story that reads as a flash of wrong scroll position on load. */
export const ScrollMirroring: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div data-test="box" class="h-6 w-32 overflow-y-scroll border px-1">
        ${LINES.map((line) => html`<div>${line}</div>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const box = canvasElement.querySelector<HTMLElement>('[data-test="box"]')!;
    await waitFor(() => expect(grid.textContent).toContain("line 01"), { timeout: 10_000 });
    // Native programmatic scrolling mirrors onto the grid.
    const cellHeight = box.getBoundingClientRect().height / 6;
    box.scrollTop = cellHeight * 4;
    await waitFor(
      () => {
        const art = grid.textContent!;
        expect(art).not.toContain("line 01");
        expect(art).toContain("line 05");
      },
      { timeout: 10_000 },
    );
    box.scrollTop = 0;
    await waitFor(() => expect(grid.textContent).toContain("line 01"), { timeout: 10_000 });
  },
};
