import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

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

const readyHost = async (canvasElement: HTMLElement): Promise<HTMLElement> => {
  const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  return host;
};

const gridSpanFor = (host: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(host.shadowRoot!.getElementById("grid")!.querySelectorAll("span")).find((span) =>
    span.textContent!.includes(text),
  );

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
