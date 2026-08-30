import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";
import { expectBrowserRowsToMatchEngine } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Grid",
};
export default meta;

const readyHost = async (canvasElement: HTMLElement): Promise<HTMLElement> => {
  const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  return host;
};

const cellsOf = (el: HTMLElement, name: string): number => Number(el.style.getPropertyValue(name));

export const Columns: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-3 gap-x-1" data-test="cols">
        <div class="border border-cyan-400 px-1">one</div>
        <div class="border border-cyan-400 px-1">two with more text</div>
        <div class="border border-cyan-400 px-1">three</div>
        <div class="border border-yellow-400 px-1">four</div>
        <div class="col-span-2 border border-emerald-400 px-1">five col-span-2</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // grid-cols-3 = repeat(3, minmax(0, 1fr)): even columns regardless of
    // content — up to the ±1 cell of integer remainder distribution — that
    // fill the content box exactly. This also proves the degrid template
    // read survived (a failed fr parse could not divide).
    const container = canvasElement.querySelector<HTMLElement>('[data-test="cols"]')!;
    const items = Array.from(container.querySelectorAll<HTMLElement>(":scope > div"));
    const widths = items.slice(0, 3).map((el) => cellsOf(el, "--mw-w"));
    const gap = cellsOf(items[1]!, "--mw-x") - cellsOf(items[0]!, "--mw-x") - widths[0]!;
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(widths.reduce((s, w) => s + w, 0)).toBe(cellsOf(container, "--mw-w") - 2 * gap);
    // The span covers the second and third tracks plus the gap between.
    expect(cellsOf(items[4]!, "--mw-w")).toBe(widths[1]! + widths[2]! + gap);
  },
};

export const MixedTracks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-[6rem_1fr_auto] gap-1" data-test="mixed">
        <div class="border border-cyan-400 px-1">24-cell track</div>
        <div class="border border-yellow-400 px-1">1fr takes the leftover space</div>
        <div class="border border-fuchsia-400 px-1">auto</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    const container = canvasElement.querySelector<HTMLElement>('[data-test="mixed"]')!;
    const [fixed, flexible, autoSized] = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > div"),
    );
    // 6rem = 24 cells; the auto track is its item's max-content (text +
    // its own padding and border cells); 1fr absorbs the rest.
    const chrome = ["--mw-pl", "--mw-pr", "--mw-bl", "--mw-br"]
      .map((name) => cellsOf(autoSized!, name))
      .reduce((a, b) => a + b, 0);
    const autoCells = autoSized!.textContent!.trim().length + chrome;
    const gap =
      cellsOf(flexible!, "--mw-x") - cellsOf(fixed!, "--mw-x") - cellsOf(fixed!, "--mw-w");
    expect(cellsOf(fixed!, "--mw-w")).toBe(24);
    expect(cellsOf(autoSized!, "--mw-w")).toBe(autoCells);
    const containerCells = cellsOf(container, "--mw-w");
    expect(cellsOf(flexible!, "--mw-w")).toBe(containerCells - 24 - autoCells - 2 * gap);
  },
};

export const Placement: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid grid-cols-4 gap-x-2 gap-y-1 *:min-w-0">
        <div class="col-span-2 col-start-2 border border-cyan-400 px-1">col-start-2 col-span-2</div>
        <div class="row-span-2 border border-yellow-400 px-1">row-span-2</div>
        <div class="border border-neutral-500 px-1">auto</div>
        <div class="border border-neutral-500 px-1">auto</div>
        <div class="col-span-full border border-emerald-400 px-1">col-span-full</div>
        <div class="-col-start-2 border border-fuchsia-400 px-1">-col-start-2</div>
      </div>
    </mono-wind>
  `,
  // row-span-2 stretches its leaf taller than its text, so the strict
  // lines-equal check doesn't apply.
  play: ({ canvasElement }) =>
    expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true }),
};

export const DenseFlow: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="grid grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="col-span-2 border border-cyan-400 px-1">span 2</div>
          <div class="col-span-2 border border-cyan-400 px-1">span 2 wraps</div>
          <div class="border border-yellow-400 px-1">sparse leaves the hole</div>
        </div>
        <div class="grid grid-flow-row-dense grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="col-span-2 border border-cyan-400 px-1">span 2</div>
          <div class="col-span-2 border border-cyan-400 px-1">span 2 wraps</div>
          <div class="border border-yellow-400 px-1">dense fills it</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const AutoFlowColumn: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid w-max grid-flow-col grid-rows-2 gap-x-2 gap-y-1">
        <div class="border border-cyan-400 px-1">a1</div>
        <div class="border border-cyan-400 px-1">a2</div>
        <div class="border border-yellow-400 px-1">b1</div>
        <div class="border border-yellow-400 px-1">b2</div>
        <div class="border border-fuchsia-400 px-1">c1</div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

const autoFillMarkup = html`
  <div id="fill-frame">
    <mono-wind>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(min(8rem,100%),1fr))] gap-x-1"
        data-test="fill"
      >
        <div class="border border-cyan-400 px-1">one</div>
        <div class="border border-cyan-400 px-1">two</div>
        <div class="border border-cyan-400 px-1">three</div>
        <div class="border border-cyan-400 px-1">four</div>
        <div class="border border-cyan-400 px-1">five</div>
      </div>
    </mono-wind>
  </div>
`;

export const AutoFill: StoryObj = {
  render: () => autoFillMarkup,
  // The resize sweep lives in the test-only AutoFillResize story below —
  // play functions also run in the dev preview, and the sweep's inline
  // frame width would freeze this story's responsiveness.
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const AutoFillResize: StoryObj = {
  // Test-only: hidden from the Storybook sidebar (and the visual suite),
  // still run by the Vitest story tests.
  tags: ["!dev"],
  render: () => autoFillMarkup,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const frame = canvasElement.querySelector<HTMLElement>("#fill-frame")!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const items = Array.from(
      canvasElement.querySelectorAll<HTMLElement>('[data-test="fill"] > div'),
    );
    const rowCount = () => new Set(items.map((el) => cellsOf(el, "--mw-y"))).size;
    // minmax(min(8rem, 100%), 1fr): at these widths 100% > 8rem, so the
    // minimum is 32 cells → count = ⌊(width + 1) ÷ 33⌋.
    // 68 columns fit 2 tracks (5 items → 3 rows); 100 columns fit 3
    // (→ 2 rows). The count resolving at LAYOUT time against the cell
    // grid is what this asserts — a static read could never adapt.
    frame.style.width = `${Math.floor(68 * cellWidth)}px`;
    await waitFor(() => expect(rowCount()).toBe(3), { timeout: 10_000 });
    frame.style.width = `${Math.floor(100 * cellWidth)}px`;
    await waitFor(() => expect(rowCount()).toBe(2), { timeout: 10_000 });
    await expectBrowserRowsToMatchEngine(canvasElement);
  },
};

export const Alignment: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="grid min-h-7 grid-cols-3 gap-x-1 border border-neutral-500 px-1">
          <div class="self-start border border-cyan-400 px-1">self-start</div>
          <div class="self-center border border-yellow-400 px-1">self-center</div>
          <div class="self-end border border-fuchsia-400 px-1">self-end</div>
        </div>
        <div class="grid grid-cols-3 justify-items-center gap-x-1 border border-neutral-500 px-1">
          <div class="border border-cyan-400 px-1">centered</div>
          <div class="border border-cyan-400 px-1">in</div>
          <div class="justify-self-end border border-yellow-400 px-1">justify-self-end</div>
        </div>
        <div
          class="grid min-h-10 grid-cols-2 content-between justify-items-center gap-x-1 border border-neutral-500 px-1"
        >
          <div class="border border-emerald-400 px-1">content</div>
          <div class="border border-emerald-400 px-1">between</div>
          <div class="border border-emerald-400 px-1">spreads</div>
          <div class="border border-emerald-400 px-1">rows</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const AbsoluteChildren: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="relative grid grid-cols-3 gap-x-1 border border-neutral-500 px-1" data-test="abs">
        <div class="border border-neutral-500 px-1">one</div>
        <div class="border border-neutral-500 px-1">two</div>
        <div class="border border-neutral-500 px-1">three</div>
        <div class="border border-neutral-500 px-1">four</div>
        <div class="border border-neutral-500 px-1">five</div>
        <div class="border border-neutral-500 px-1">six</div>
        <div
          class="absolute inset-0 col-start-2 col-end-3 row-start-1 row-end-2 border px-1 text-cyan-400"
        >
          inset-0 in area (2, 1)
        </div>
        <!-- No insets at all: an absolute box then lands on its CSS "static
             position", which for a grid child (§10.1) is the content box
             with the child's own self-alignment applied. -->
        <div class="absolute self-center justify-self-end text-yellow-400">
          no insets: self-aligned end/center
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // The overlay's leaf is stretched to its area (taller than its text).
    await expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true });
    const container = canvasElement.querySelector<HTMLElement>('[data-test="abs"]')!;
    const items = Array.from(container.querySelectorAll<HTMLElement>(":scope > div"));
    const [, two, , , , , overlay, badge] = items;
    // Containing block = the (2, 1) grid area: the overlay shares item
    // two's column geometry exactly.
    expect(cellsOf(overlay!, "--mw-x")).toBe(cellsOf(two!, "--mw-x"));
    expect(cellsOf(overlay!, "--mw-w")).toBe(cellsOf(two!, "--mw-w"));
    expect(cellsOf(overlay!, "--mw-h")).toBe(cellsOf(two!, "--mw-h"));
    // No insets → the CSS static position: sole item of the CONTENT box,
    // self-aligned end/center — flush with the content box's right edge
    // and vertically centered in it (computed from the container's own
    // border + padding vars so the markup can change freely).
    const c = (name: string) => cellsOf(container, name);
    const contentTop = c("--mw-bt") + c("--mw-pt");
    const contentHeight = c("--mw-h") - contentTop - c("--mw-bb") - c("--mw-pb");
    expect(cellsOf(badge!, "--mw-x") + cellsOf(badge!, "--mw-w")).toBe(
      c("--mw-w") - c("--mw-br") - c("--mw-pr"),
    );
    expect(cellsOf(badge!, "--mw-y")).toBe(
      contentTop + Math.floor((contentHeight - cellsOf(badge!, "--mw-h")) / 2),
    );
  },
};

export const NamedAreas: StoryObj = {
  render: () => html`
    <mono-wind>
      <div
        class="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1"
        style="grid-template-areas: 'head head' 'nav main' 'nav foot'"
        data-test="areas"
      >
        <div class="border border-cyan-400 px-1 [grid-area:head]">header — grid-area: head</div>
        <div class="border border-yellow-400 px-1 [grid-area:nav]">nav (spans two rows)</div>
        <div class="border border-emerald-400 px-1 [grid-area:main]">main</div>
        <div class="border border-fuchsia-400 px-1 [grid-area:foot]">footer</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // nav is stretched across two rows (taller than its text).
    await expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true });
    const container = canvasElement.querySelector<HTMLElement>('[data-test="areas"]')!;
    const [head, nav, main, foot] = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > div"),
    );
    // Areas, not document order, decide placement: head spans both
    // columns (incl. the gap), nav spans the two lower rows beside main
    // and foot. Gaps are derived from the geometry so the markup's gap
    // utilities can change freely.
    const colGap = cellsOf(main!, "--mw-x") - cellsOf(nav!, "--mw-x") - cellsOf(nav!, "--mw-w");
    const rowGap = cellsOf(foot!, "--mw-y") - cellsOf(main!, "--mw-y") - cellsOf(main!, "--mw-h");
    expect(cellsOf(head!, "--mw-w")).toBe(
      cellsOf(nav!, "--mw-w") + colGap + cellsOf(main!, "--mw-w"),
    );
    expect(cellsOf(nav!, "--mw-h")).toBe(
      cellsOf(main!, "--mw-h") + rowGap + cellsOf(foot!, "--mw-h"),
    );
    expect(cellsOf(nav!, "--mw-w")).toBe(32); // 8rem
    expect(cellsOf(foot!, "--mw-x")).toBe(cellsOf(main!, "--mw-x"));
  },
};

export const Subgrid: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="grid grid-cols-[auto_auto_auto] gap-x-1" data-test="sub-cols">
          <div class="border border-neutral-500 px-1">name</div>
          <div class="border border-neutral-500 px-1">qty</div>
          <div class="border border-neutral-500 px-1">price</div>
          <div class="col-span-3 grid grid-cols-subgrid border border-cyan-400 px-1">
            <div class="border border-cyan-400 px-1">a subgrid row keeps the columns</div>
            <div class="border border-cyan-400 px-1">2</div>
            <div class="border border-cyan-400 px-1">12.50</div>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-x-1" data-test="sub-rows">
          <div class="row-span-3 grid grid-rows-subgrid border border-yellow-400 px-1">
            <div class="text-yellow-400">Card A</div>
            <div>short body</div>
            <div class="border-t border-neutral-500">footer</div>
          </div>
          <div class="row-span-3 grid grid-rows-subgrid border border-yellow-400 px-1">
            <div class="text-yellow-400">Card B</div>
            <div>a much longer body that wraps onto several lines and sets the shared row</div>
            <div class="border-t border-neutral-500">footer</div>
          </div>
          <div class="row-span-3 grid grid-rows-subgrid border border-yellow-400 px-1">
            <div class="text-yellow-400">Card C</div>
            <div>medium body text here</div>
            <div class="border-t border-neutral-500">
              footer with more text to set the height for all the footers
            </div>
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // Subgrid cells stretch to shared rows (taller than their text).
    await expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true });
    const cols = canvasElement.querySelector<HTMLElement>('[data-test="sub-cols"]')!;
    const [name, qty, price, sub] = Array.from(cols.querySelectorAll<HTMLElement>(":scope > div"));
    const [subA, subB, subC] = Array.from(sub!.querySelectorAll<HTMLElement>(":scope > div"));
    // The subgrid's items land on the parent's columns: same widths as
    // the header cells, minus the subgrid's own chrome (padding + border)
    // on the edge tracks — derived from its vars so classes can change.
    const chromeL = cellsOf(sub!, "--mw-pl") + cellsOf(sub!, "--mw-bl");
    const chromeR = cellsOf(sub!, "--mw-pr") + cellsOf(sub!, "--mw-br");
    expect(cellsOf(subA!, "--mw-w")).toBe(cellsOf(name!, "--mw-w") - chromeL);
    expect(cellsOf(subB!, "--mw-w")).toBe(cellsOf(qty!, "--mw-w"));
    expect(cellsOf(subC!, "--mw-w")).toBe(cellsOf(price!, "--mw-w") - chromeR);
    // Row subgrids: every card's footer sits on the same shared row.
    const rows = canvasElement.querySelector<HTMLElement>('[data-test="sub-rows"]')!;
    const footers = Array.from(rows.querySelectorAll<HTMLElement>(":scope > div > div:last-child"));
    const ys = new Set(footers.map((el) => cellsOf(el, "--mw-y")));
    expect(ys.size).toBe(1);
  },
};

export const GapDecorations: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-2">
        <div class="grid grid-cols-3 gap-1 rule rule-cyan-400" data-test="rules">
          <div class="px-1">one</div>
          <div class="px-1">two</div>
          <div class="px-1">three</div>
          <div class="px-1">four</div>
          <div class="px-1">five</div>
          <div class="px-1">six</div>
        </div>
        <div
          class="grid w-max grid-cols-[auto_auto] gap-1 rule rule-cyan-400"
          data-test="span-break"
        >
          <div class="px-1">rule</div>
          <div class="px-1">break</div>
          <div class="col-span-2 px-1">normal (default)</div>
        </div>
        <div
          class="grid w-max grid-cols-[auto_auto] gap-1 rule rule-cyan-400 rule-break-intersection"
          data-test="span-break"
        >
          <div class="px-1">rule</div>
          <div class="px-1">break</div>
          <div class="col-span-2 px-1">intersection</div>
        </div>
        <div
          class="grid w-max grid-cols-[auto_auto] gap-1 rule rule-cyan-400 rule-break-none"
          data-test="span-break"
        >
          <div class="px-1">rule</div>
          <div class="px-1">break</div>
          <div class="col-span-2 px-1">none</div>
        </div>
        <div class="grid w-max grid-cols-[auto_auto] gap-1 rule rule-fuchsia-400 rule-inset-1">
          <div class="px-1">rule</div>
          <div class="px-1">inset</div>
          <div class="px-1">1</div>
        </div>
        <div class="grid w-max auto-rows-1 grid-cols-[auto_auto] gap-1 rule rule-emerald-500">
          <div class="px-1">rule</div>
          <div class="px-1">visibility</div>
          <div class="px-1">all</div>
          <div class="row-start-3 px-1">(empty -&gt;)</div>
        </div>
        <div
          class="grid w-max auto-rows-1 grid-cols-[auto_auto] gap-1 rule rule-emerald-500 rule-visibility-around"
        >
          <div class="px-1">rule</div>
          <div class="px-1">visibility</div>
          <div class="px-1">around</div>
          <div class="row-start-3 px-1">(empty -&gt;)</div>
        </div>
        <div
          class="grid w-max auto-rows-1 grid-cols-[auto_auto] gap-1 rule rule-emerald-500 rule-visibility-between"
        >
          <div class="px-1">rule</div>
          <div class="px-1">visibility</div>
          <div class="px-1">between</div>
          <div class="row-start-3 px-1">(empty -&gt;)</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // Rules paint into the decoration layer as colored glyph spans —
    // crossings included (the ┼ between the four quadrants).
    const host = canvasElement.querySelector("mono-wind")!;
    const decorations = host.shadowRoot!.querySelectorAll("span");
    const glyphs = Array.from(decorations, (span) => span.textContent).join("");
    expect(glyphs).toContain("│");
    expect(glyphs).toContain("─");
    expect(glyphs).toContain("┼");
    // Color assertion, reference-resolved (Tailwind v4 colors are oklch):
    // a span must match the container's own resolved rule-color mirror.
    const rules = canvasElement.querySelector<HTMLElement>('[data-test="rules"]')!;
    const reference = document.createElement("div");
    reference.style.color = getComputedStyle(rules).getPropertyValue("--mw-rule-x-color").trim();
    canvasElement.appendChild(reference);
    const expected = getComputedStyle(reference).color;
    const colored = Array.from(decorations).some(
      (span) => getComputedStyle(span).color === expected,
    );
    expect(colored).toBe(true);
    // Segment features (specs/gap-decorations.md "Segments"), probed
    // against Chromium's native css-gaps rendering.
    const lines = (host as MonoWindElement).toPlainText().split("\n");
    const lineWith = (text: string) => lines.findIndex((line) => line.includes(text));
    // Each card's gap row (above its third item) shows its break mode:
    // normal stops the vertical flush at the spanning item's T (┴);
    // intersection leaves a hole in the row rule at the crossing;
    // none runs the vertical through the crossing (┼).
    expect(lines[lineWith("normal (default)") - 1]).toContain("┴");
    expect(lines[lineWith("intersection") - 1]).toMatch(/─+ ─+/);
    expect(lines[lineWith("none") - 1]).toContain("┼");
    // Inset retracts both rules off the item rows into the gap row,
    // where they still cross.
    expect(lines[lineWith("inset")]).not.toContain("│");
    expect(lines[lineWith("inset") + 1]).toContain("┼");
    // Visibility (each card's rows 2-3 leave column 2 empty; the arrow
    // item points at the empty cell): the default (= `all`) paints the
    // full lattice, ┼ included, even between two empty cells; `around`
    // needs one occupied side, so its row rule stops at the vertical
    // (no ┼); `between` needs both sides, dropping the vertical below
    // row 1 entirely.
    expect(lines[lineWith("all") + 1]).toContain("┼");
    expect(lines[lineWith("around") + 1]).toContain("│");
    expect(lines[lineWith("around") + 1]).not.toContain("┼");
    expect(lines[lineWith("between")]).not.toContain("│");
    expect(lines[lineWith("between") + 1]).not.toContain("│");
    expect(lines[lineWith("between") + 1]).toContain("─");
  },
};
