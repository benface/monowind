import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/** Assert that the browser painted every laid-out leaf's text on exactly
 * the rows the engine allocated — the wrap models must agree in every
 * engine (specs/cell-model.md). */
async function expectBrowserRowsToMatchEngine(canvasElement: HTMLElement): Promise<void> {
  const host = canvasElement.querySelector("mono-wind")!;
  // Generous timeouts throughout: three browser instances share the CPU
  // (worse on CI runners), so a rAF-driven relayout can easily outrun
  // waitFor's default 1s under load.
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  const leaves = Array.from(host.querySelectorAll<HTMLElement>("[data-mw-laid-out]")).filter(
    (el) =>
      el.textContent!.trim() !== "" &&
      !el.querySelector("[data-mw-laid-out], [data-mw-inline-box]"),
  );
  expect(leaves.length).toBeGreaterThan(0);
  const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
  for (const el of leaves) {
    const cells = (name: string) => Number(el.style.getPropertyValue(name));
    const contentRows =
      cells("--mw-h") - cells("--mw-bt") - cells("--mw-bb") - cells("--mw-pt") - cells("--mw-pb");
    // N lines occupy N + (N − 1) × gap rows, with gap = rows per line − 1.
    const rowsPerLine = cells("--mw-lh") || 1;
    const engineLines = (contentRows + rowsPerLine - 1) / rowsPerLine;
    const range = document.createRange();
    range.selectNodeContents(el);
    // Fragments on one line can differ slightly in top (an italic or bold
    // fallback face has its own ascent), so count rows by the fragment's
    // vertical centre rather than distinct tops.
    const top = el.getBoundingClientRect().top;
    const lines = new Set(
      Array.from(range.getClientRects(), (r) =>
        Math.floor((r.top + r.height / 2 - top) / cellHeight),
      ),
    );
    expect(lines.size, `"${el.textContent!.trim()}" lines`).toBe(engineLines);
  }
}

const meta: Meta = {
  title: "Features/Typography",
};
export default meta;

export const Wrapping: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 border border-neutral-500 px-2 py-1">
        This text wraps at word boundaries when it runs out of columns, and breaks long words at
        cell boundaries. Try resizing the window to see how it behaves.
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const Truncating: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 truncate border border-neutral-500 px-2 py-1">
        This text gets truncated when it is wider than the available width.
      </div>
    </mono-wind>
  `,
};

export const HardBreaks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="border border-neutral-500 px-2 py-1">
        first line<br />second line<br /><br />after a blank line
      </div>
    </mono-wind>
  `,
};

export const InlineElements: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 border border-neutral-500 px-2 py-1">
        Inline elements like <b class="text-yellow-400">bold text</b>,
        <i class="text-cyan-400">italic text</i>, and
        <a href="#" class="text-blue-400 underline">links (click me)</a> ride along in the text run.
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const InlineDisplay: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="relative max-w-54 border border-neutral-500 px-2 py-1">
        <!-- A block child turns its parent into a container, and containers
             don't lay out direct text (cell-model deviation 7) — so the
             running text lives in its own div beside the block span. -->
        <div>
          Inline-ness follows computed display: this text run contains
          <div class="inline">an inline div,</div>
          <div class="inline-flex flex-wrap">
            <div>an&nbsp;</div>
            <div>inline-flex&nbsp;</div>
            <div>div,</div>
          </div>
          a <span class="hidden">completely invisible</span> hidden span whose text never joins the
          flow, and an absolute span that leaves the flow to become the corner badge
          <span class="absolute -top-1 right-2 bg-bg-light px-1 text-yellow-500 dark:bg-bg-dark">
            * badge
          </span>
          instead of rendering here.
        </div>
        <span class="block text-cyan-400">Finally, this is a block span on its own line.</span>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // The load-bearing agreement of atomic inline boxes: the BROWSER's own
    // line layout must place the in-flow box exactly where the ENGINE's
    // wrap model computed it (the engine writes its cells to --mw-x/y but
    // no CSS consumes them for inline boxes — the browser flows it).
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    const box = host.querySelector<HTMLElement>("[data-mw-inline-box]")!;
    const leaf = box.parentElement!;
    const engineX = Number(box.style.getPropertyValue("--mw-x")) * cellWidth;
    const engineY = Number(box.style.getPropertyValue("--mw-y")) * cellHeight;
    const boxRect = box.getBoundingClientRect();
    const leafRect = leaf.getBoundingClientRect();
    expect(boxRect.left - leafRect.left).toBeCloseTo(engineX, 0);
    expect(boxRect.top - leafRect.top).toBeCloseTo(engineY, 0);
    expect(boxRect.height).toBeCloseTo(
      Number(box.style.getPropertyValue("--mw-h")) * cellHeight,
      0,
    );
  },
};

export const TextAlign: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="border border-neutral-500 px-1 text-end">text-end lands on the grid</div>
        <div class="border border-neutral-500 px-1 text-center">
          text-center would be off-grid, so it is forced back to start
        </div>
        <div class="border border-neutral-500 px-1 text-justify">same thing for text-justify</div>
      </div>
    </mono-wind>
  `,
};

export const Leading: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-2">
        <div class="max-w-30 border border-neutral-500 px-1">
          leading-normal: wrapped lines sit on consecutive rows, as usual.
        </div>
        <div class="max-w-30 border border-cyan-400 px-1 leading-loose">
          leading-loose: one empty row between every two wrapped lines.
        </div>
        <div class="max-w-30 border border-yellow-400 px-1 leading-[3]">
          leading-[3]: two empty rows between wrapped lines.
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const Tracking: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-start gap-1">
        <div class="border border-neutral-500 px-1 tracking-normal">tracking-normal</div>
        <div class="border border-cyan-400 px-1 tracking-wide">tracking-wide</div>
        <div class="border border-yellow-400 px-1 tracking-wider">tracking-wider</div>
        <div class="border border-fuchsia-400 px-1 tracking-widest">tracking-widest</div>
        <div class="max-w-40 border border-emerald-400 px-1 tracking-wide">
          wrapped text with tracking-wide still breaks at word boundaries
        </div>
        <div class="border border-neutral-500 px-1">
          inline <span class="tracking-wide text-cyan-400">tracking-wide</span> and
          <span class="tracking-wider text-yellow-400">wider</span> spans in a run
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

/**
 * Regression guard for the width headroom in styles.css: engines floor
 * lengths to a layout unit (1/64px), so `cells × cell-width` can land one
 * unit short of the shaped advance of a line that fits exactly, and the
 * browser wraps it. JetBrains Mono's 0.6em advance never trips this, so the
 * story uses a self-hosted DejaVu Sans Mono subset (1233/2048em — Menlo's
 * metrics), which does at several widths; the play sweeps the host width
 * so every line hits an exact fit at some column count.
 */
export const SubpixelHeadroom: StoryObj = {
  // Test-only: hidden from the Storybook sidebar (and the visual suite),
  // still run by the Vitest story tests.
  tags: ["!dev"],
  render: () => html`
    <div id="sweep-frame">
      <mono-wind style="font-family: 'DejaVu Sans Mono Subset', monospace">
        <div class="flex flex-col gap-1">
          <div class="border border-neutral-500 px-1">
            inline <span class="tracking-wide text-cyan-400">tracking-wide</span> and
            <span class="tracking-wider text-yellow-400">wider</span> spans in a run
          </div>
          <div class="tracking-wide">wrapped text with tracking-wide and no border at all</div>
          <div>plain text alpha beta gamma delta epsilon zeta eta theta iota kappa</div>
        </div>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    const frame = canvasElement.querySelector<HTMLElement>("#sweep-frame")!;
    // The fixture font loads lazily and the host re-measures its cell once
    // fonts settle — poll until that layout has landed (a fixed frame count
    // races the re-measure on slow runners).
    await document.fonts.load("14px 'DejaVu Sans Mono Subset'");
    // Wait for the fixture font to measure at its TRUE advance, pumping
    // the frame width so every attempt forces a relayout and a fresh cell
    // measurement (metrics update only on layout, so a passive wait can
    // wedge on a stale value). Root-caused 2026-08: Linux Chromium
    // QUANTIZES glyph advances to whole pixels under default hinting
    // (DejaVu's 8.4287px measures as exactly 8px — the font renders fine),
    // and on the raw CI runner that quantization toggles per renderer
    // process. The engine is self-consistent either way (the browser lays
    // text out with the same advances the probe measures); only this
    // sweep needs the fractional advance to exist.
    const targetCellWidth = (1233 / 2048) * 14;
    // ±0.01px: tight enough to exclude fallback monospace fonts near
    // DejaVu's advance (macOS Monaco is 8.401px, 0.028 away — matching it
    // once desynced the whole sweep), loose enough for engines that round
    // advances slightly (Linux Firefox measures 8.4333px, 0.0046 away).
    const advanceTolerance = 0.01;
    const cellWidthNow = () => parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const fontDeadline = performance.now() + 10_000;
    let pump = false;
    while (
      Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance &&
      performance.now() < fontDeadline
    ) {
      pump = !pump;
      frame.style.width = `${420 + (pump ? 0.5 : 0.25)}px`;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Integer-quantized advances: with whole-pixel advances there is no
    // fractional accumulation, so the exact-fit headroom scenario this
    // sweep guards against PHYSICALLY cannot occur — skipping loses no
    // coverage on this platform. Environments with precise advances
    // (macOS, the other browser engines, most real users) run the full
    // sweep.
    const skipQuantized = (when: string): void => {
      console.warn(
        `[SubpixelHeadroom] glyph advances are pixel-quantized ${when}; the exact-fit sweep does not apply`,
        { mwCw: getComputedStyle(host).getPropertyValue("--mw-cw") },
      );
    };
    if (Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance) {
      if (!document.fonts.check("14px 'DejaVu Sans Mono Subset'")) {
        throw new Error("fixture font failed to load");
      }
      skipQuantized("here");
      return;
    }
    await expectBrowserRowsToMatchEngine(canvasElement);
    const cellWidth = cellWidthNow();
    const first = host.firstElementChild as HTMLElement;
    for (let columns = 20; columns <= 90; columns++) {
      // Resize a plain WRAPPER, not the host (reaches the engine via its
      // ResizeObserver), on an explicitly paced write → wait → check loop
      // (waitFor would re-check on every mutation, and a write per check
      // becomes a microtask storm that starves the engine's rAF). The two
      // alternating widths floor to the same column count but are distinct
      // box sizes, so every attempt forces a relayout and a fresh cell
      // measurement. The platform's advance quantization can flip MID-TEST
      // (seen on CI 2026-08: the font gate above passed at 8.42875px, then
      // the sweep's re-measures read exactly 8px): the engine self-heals on
      // the next layout, but the sweep's frame widths are derived from the
      // now-stale fractional advance, so the expected column count can
      // never land — detect the flip and skip, same rationale as above.
      const deadline = performance.now() + 10_000;
      let landed = false;
      let flipped = false;
      while (!landed && performance.now() < deadline) {
        pump = !pump;
        frame.style.width = `${columns * cellWidth + (pump ? 0.5 : 0.25)}px`;
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance) {
          flipped = true;
          break;
        }
        landed = first.style.getPropertyValue("--mw-w") === String(columns);
      }
      if (flipped) {
        skipQuantized("mid-sweep");
        return;
      }
      if (!landed) {
        // Fail-only diagnostics: capture what the engine actually saw.
        const cs = getComputedStyle(host);
        throw new Error(
          `sweep stalled: ${JSON.stringify({
            columns,
            cellWidth,
            styleWidth: frame.style.width,
            clientWidth: host.clientWidth,
            rectWidth: host.getBoundingClientRect().width,
            mwW: first.style.getPropertyValue("--mw-w"),
            mwCw: cs.getPropertyValue("--mw-cw"),
            fontApplied: document.fonts.check("14px 'DejaVu Sans Mono Subset'"),
            padding: cs.paddingLeft,
            measuring: host.hasAttribute("measuring"),
            visibility: document.visibilityState,
          })}`,
        );
      }
      await expectBrowserRowsToMatchEngine(canvasElement);
    }
  },
};
