import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { multicolLines } from "monowind";
import { expectBrowserRowsToMatchEngine } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Multicol",
};
export default meta;

const readyHost = async (canvasElement: HTMLElement): Promise<HTMLElement> => {
  const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  return host;
};

const cellsOf = (el: HTMLElement, name: string): number => Number(el.style.getPropertyValue(name));

/** The container's content-box width in cells, from its used vars. */
function contentCellsOf(el: HTMLElement): number {
  return (
    cellsOf(el, "--mw-w") -
    cellsOf(el, "--mw-bl") -
    cellsOf(el, "--mw-br") -
    cellsOf(el, "--mw-pl") -
    cellsOf(el, "--mw-pr")
  );
}

/** Visit every non-whitespace character's client rect under `target`. */
function eachCharRect(target: Element, visit: (rect: DOMRect, char: string) => void): void {
  const range = document.createRange();
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    for (let i = 0; i < data.length; i++) {
      if (/[ \t\r\n\f]/.test(data[i]!)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      visit(range.getBoundingClientRect(), data[i]!);
    }
  }
}

/** Distinct column bands `target`'s characters occupy, derived from the
 * container's used values (stride = column width + gap). */
function charColumns(container: HTMLElement, target: Element, cellWidth: number): Set<number> {
  const gap = cellsOf(container, "--mw-colg");
  const count = cellsOf(container, "--mw-colc");
  const stride = ((contentCellsOf(container) - (count - 1) * gap) / count + gap) * cellWidth;
  const left =
    container.getBoundingClientRect().left +
    (cellsOf(container, "--mw-bl") + cellsOf(container, "--mw-pl")) * cellWidth;
  const columns = new Set<number>();
  eachCharRect(target, (rect) => {
    columns.add(Math.floor((rect.left + rect.width / 2 - left) / stride));
  });
  return columns;
}

/**
 * The load-bearing browser agreement (specs/multicol.md): the native
 * columns must break the leaf's text on exactly the engine's lines, each
 * line in the engine's column at the engine's rows. Rebuilds the
 * browser's lines character by character — each glyph's rect picks its
 * column (by x) and its line within the column (by y) — and compares
 * the sequence against the engine's wrap at the column width.
 */
async function expectBrowserColumnsToMatchEngine(
  canvasElement: HTMLElement,
  testId: string,
): Promise<void> {
  const host = await readyHost(canvasElement);
  // A late font load swaps the cell metrics and triggers an async
  // relayout; the whole comparison retries until both sides settle.
  await document.fonts.ready;
  await waitFor(
    () => {
      const el = canvasElement.querySelector<HTMLElement>(`[data-test="${testId}"]`)!;
      const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
      const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
      const count = cellsOf(el, "--mw-colc");
      const gap = cellsOf(el, "--mw-colg");
      expect(count, "used column count").toBeGreaterThan(1);
      // Leaf columns are equal whole-cell tracks (the remainder is folded
      // into the engine-owned right padding).
      const columnWidth = (contentCellsOf(el) - (count - 1) * gap) / count;
      expect(Number.isInteger(columnWidth), "equal whole-cell columns").toBe(true);
      const rowsPerLine = cellsOf(el, "--mw-lh") || 1;
      const contentRows =
        cellsOf(el, "--mw-h") -
        cellsOf(el, "--mw-bt") -
        cellsOf(el, "--mw-bb") -
        cellsOf(el, "--mw-pt") -
        cellsOf(el, "--mw-pb");
      expect(contentRows).toBeGreaterThan(0);

      const text = el.textContent!.replace(/[ \t\r\n\f]+/g, " ").trim();
      // The engine's own wrap-and-fill code predicts the fragmentation
      // from the rendered element's used values — sequential fill into
      // the final content height reproduces any fill mode's layout.
      const expected = multicolLines(text, {
        columnWidth,
        columnCount: count,
        tracking: cellsOf(el, "--mw-ls") || 0,
        lineGap: rowsPerLine - 1,
        restrictingHeight: contentRows,
      }).map((line) => ({
        column: line.column,
        line: line.top / rowsPerLine,
        chars: line.text.replaceAll(" ", ""),
      }));

      const box = el.getBoundingClientRect();
      const contentLeft = box.left + (cellsOf(el, "--mw-bl") + cellsOf(el, "--mw-pl")) * cellWidth;
      const contentTop = box.top + (cellsOf(el, "--mw-bt") + cellsOf(el, "--mw-pt")) * cellHeight;
      const buckets = new Map<string, string>();
      eachCharRect(el, (rect, char) => {
        const column = Math.floor(
          (rect.left + rect.width / 2 - contentLeft) / ((columnWidth + gap) * cellWidth),
        );
        // The glyph's ink centers in its (rowsPerLine)-row line box;
        // rounding the centre back through the line-box height recovers
        // the index.
        const line = Math.round(
          (rect.top + rect.height / 2 - contentTop) / (rowsPerLine * cellHeight) - 0.5,
        );
        const key = `${column}:${line}`;
        buckets.set(key, (buckets.get(key) ?? "") + char);
      });
      const browserLines = [...buckets.entries()]
        .map(([key, chars]) => {
          const [column, line] = key.split(":").map(Number) as [number, number];
          return { column, line, chars };
        })
        .sort((a, b) => a.column - b.column || a.line - b.line);
      expect(browserLines, `"${text.slice(0, 30)}…" column fragmentation`).toEqual(expected);
    },
    { timeout: 10_000 },
  );
}

const PROSE =
  "The quick brown fox jumps over the lazy dog while a calm river " +
  "winds between mossy stones and tall reeds sway in the warm wind " +
  "as evening light settles gently over the quiet valley.";

export const Prose: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="max-w-80 columns-2 border border-cyan-400 px-3 py-1" data-test="prose">
          [columns-2] ${PROSE}
        </div>
        <div class="max-w-80 columns-3 border border-emerald-400 px-3 py-1" data-test="prose-3">
          [columns-3] ${PROSE}
        </div>
        <div
          class="max-w-80 columns-[--spacing(20)] border border-yellow-400 px-3 py-1"
          data-test="prose-w"
        >
          [columns-[--spacing(20)]] ${PROSE}
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // Direct text flows through the columns at line granularity — the
    // engine's break points and the browser's native columns must agree.
    await expectBrowserColumnsToMatchEngine(canvasElement, "prose");
    // Three columns with the default 1em gap (`column-gap: normal`).
    await expectBrowserColumnsToMatchEngine(canvasElement, "prose-3");
    // Width-derived count (css-multicol §3.4): 20-cell-wide columns fit
    // three tracks, columns flexing to fill.
    await expectBrowserColumnsToMatchEngine(canvasElement, "prose-w");
  },
};

export const Paragraphs: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="max-w-80 columns-2 border border-cyan-400 px-3 py-1" data-test="flow">
          <p>${PROSE}</p>
          <p class="mt-1">A second paragraph follows right after the first one ends.</p>
        </div>
        <div class="max-w-60 columns-2 border border-emerald-400 px-3 py-1" data-test="avoid">
          <p>An opening paragraph of two lines.</p>
          <p class="mt-1 break-inside-avoid">
            This middle paragraph avoids breaking inside and stays whole.
          </p>
          <p class="mt-1">A closing paragraph of two more lines.</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // Paragraph flow (specs/multicol.md "Fragmenting text-leaf
    // children"): chrome-less children fragment at line granularity —
    // the first paragraph SPLITS across columns, and the browser's
    // native in-flow fragmentation lands on the engine's rows.
    const host = await readyHost(canvasElement);
    await document.fonts.ready;
    await waitFor(
      () => {
        const el = canvasElement.querySelector<HTMLElement>('[data-test="flow"]')!;
        const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
        const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
        const gap = cellsOf(el, "--mw-colg");
        const columnWidth = (contentCellsOf(el) - gap) / 2;
        const box = el.getBoundingClientRect();
        const contentLeft =
          box.left + (cellsOf(el, "--mw-bl") + cellsOf(el, "--mw-pl")) * cellWidth;
        const contentTop = box.top + (cellsOf(el, "--mw-bt") + cellsOf(el, "--mw-pt")) * cellHeight;
        const cellsOfParagraph = (p: Element) => {
          const out: { column: number; row: number; char: string }[] = [];
          eachCharRect(p, (rect, char) => {
            out.push({
              column: Math.floor(
                (rect.left + rect.width / 2 - contentLeft) / ((columnWidth + gap) * cellWidth),
              ),
              row: Math.round((rect.top + rect.height / 2 - contentTop) / cellHeight - 0.5),
              char,
            });
          });
          return out;
        };
        const [firstEl, secondEl] = Array.from(el.querySelectorAll("p"));
        // The first paragraph's native lines must sit on EXACTLY the
        // engine's fragmentation (its lines fill first, so the shared
        // predictor reproduces them from the paragraph's own text) —
        // per-character, so a mislaid native layout can't pass by
        // landing in coarsely-right columns.
        const contentRows =
          cellsOf(el, "--mw-h") -
          cellsOf(el, "--mw-bt") -
          cellsOf(el, "--mw-bb") -
          cellsOf(el, "--mw-pt") -
          cellsOf(el, "--mw-pb");
        const firstText = firstEl!.textContent!.replace(/[ \t\r\n\f]+/g, " ").trim();
        const expected = multicolLines(firstText, {
          columnWidth,
          columnCount: 2,
          restrictingHeight: contentRows,
        }).map((line) => ({
          column: line.column,
          row: line.top,
          chars: line.text.replaceAll(" ", ""),
        }));
        const buckets = new Map<string, string>();
        for (const cell of cellsOfParagraph(firstEl!)) {
          const key = `${cell.column}:${cell.row}`;
          buckets.set(key, (buckets.get(key) ?? "") + cell.char);
        }
        const browserLines = [...buckets.entries()]
          .map(([key, chars]) => {
            const [column, row] = key.split(":").map(Number) as [number, number];
            return { column, row, chars };
          })
          .sort((a, b) => a.column - b.column || a.row - b.row);
        expect(browserLines, "first paragraph fragmentation").toEqual(expected);
        expect(
          new Set(browserLines.map((line) => line.column)).size,
          "first paragraph splits",
        ).toBe(2);
        // The second continues in the same column, its mt-1 margin row
        // below the first paragraph's last line.
        const firstEnd = browserLines[browserLines.length - 1]!;
        const secondStart = cellsOfParagraph(secondEl!).reduce((a, b) =>
          b.column < a.column || (b.column === a.column && b.row < a.row) ? b : a,
        );
        expect(secondStart.column, "second paragraph column").toBe(firstEnd.column);
        expect(secondStart.row, "margin row between paragraphs").toBe(firstEnd.row + 2);
        // In the second example, the avoid paragraph would split without
        // `break-inside-avoid`; with it, it moves whole to the second
        // column (probe 9).
        const avoidContainer = canvasElement.querySelector<HTMLElement>('[data-test="avoid"]')!;
        const avoidEl = avoidContainer.querySelector(".break-inside-avoid")!;
        expect(
          charColumns(avoidContainer, avoidEl, cellWidth).size,
          "break-inside-avoid keeps the paragraph whole",
        ).toBe(1);
      },
      { timeout: 10_000 },
    );
  },
};

export const TextProperties: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div
          class="max-w-80 columns-2 border border-fuchsia-400 px-3 py-1 text-end"
          data-test="end"
        >
          [text-end] ${PROSE}
        </div>
        <div
          class="max-w-80 columns-2 border border-cyan-400 px-3 py-1 text-center"
          data-test="center"
        >
          [text-center] ${PROSE}
        </div>
        <div
          class="max-w-80 columns-2 border border-emerald-400 px-3 py-1 leading-loose"
          data-test="loose"
        >
          [leading-loose] ${PROSE}
        </div>
        <div
          class="max-w-80 columns-2 border border-yellow-400 px-3 py-1 tracking-wide"
          data-test="tracked"
        >
          [tracking-wide] ${PROSE}
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // Alignment shifts lines within their column; leading makes every
    // line box span its own leading inside its column (the browser
    // line-box model); tracking widens every advance — fragmentation
    // must agree under each.
    await expectBrowserColumnsToMatchEngine(canvasElement, "end");
    await expectBrowserColumnsToMatchEngine(canvasElement, "center");
    await expectBrowserColumnsToMatchEngine(canvasElement, "loose");
    await expectBrowserColumnsToMatchEngine(canvasElement, "tracked");
  },
};

export const GapDecorations: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-2">
        <div class="max-w-60 columns-3 gap-0" data-test="flush">[gap-0] ${PROSE}</div>
        <div class="max-w-60 columns-3 gap-0 rule rule-neutral-500" data-test="floor">
          [gap-0 rule] ${PROSE}
        </div>
        <div class="max-w-60 columns-3 gap-3 rule rule-neutral-500 rule-double">
          [gap-3 rule rule-double] ${PROSE}
        </div>
        <div class="max-w-60 columns-3 gap-5 rule rule-neutral-500 rule-dashed">
          [gap-5 rule rule-dashed] ${PROSE}
        </div>
        <div class="max-w-60 columns-3 gap-5 rule rule-neutral-500 rule-inset-1">
          [gap-5 rule rule-inset-1] ${PROSE}
        </div>
        <div
          class="max-w-60 columns-3 gap-4 border border-neutral-500 rule rule-neutral-500"
          data-test="tee"
        >
          [rule + border] ${PROSE}
        </div>
        <div class="max-w-60 columns-3 gap-4 rule rule-neutral-500" data-test="vis-default">
          [default] alpha beta
        </div>
        <div
          class="max-w-60 columns-3 gap-4 rule rule-neutral-500 rule-visibility-all"
          data-test="vis-all"
        >
          [visibility all] alpha beta
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // Rules take no toll on the fragmentation agreement: flush columns,
    // a floored gap, and a bordered leaf with teeing rules all still
    // break on the engine's lines.
    await expectBrowserColumnsToMatchEngine(canvasElement, "flush");
    // `gap-0` alone is flush…
    const flush = canvasElement.querySelector<HTMLElement>('[data-test="flush"]')!;
    expect(cellsOf(flush, "--mw-colg")).toBe(0);
    await expectBrowserColumnsToMatchEngine(canvasElement, "floor");
    // …while `gap-0 rule` floors the gap at the rule width — the rule
    // needs its cell (specs/gap-decorations.md deviation 1).
    const floor = canvasElement.querySelector<HTMLElement>('[data-test="floor"]')!;
    expect(cellsOf(floor, "--mw-colg")).toBe(1);
    await expectBrowserColumnsToMatchEngine(canvasElement, "tee");
  },
};

export const Blocks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-80 columns-3 gap-3 rule-zinc-500 rule-x" data-test="cards">
        <div class="border border-cyan-400 px-1">alpha</div>
        <div class="border border-cyan-400 px-1">
          bravo has a bit more text to wrap, but it still won't break across columns
        </div>
        <div class="border border-yellow-400 px-1">charlie</div>
        <div class="border border-yellow-400 px-1">delta</div>
        <div class="border border-emerald-400 px-1">echo wraps across some lines too</div>
        <div class="border border-emerald-400 px-1">foxtrot</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // Children distribute atomically across the three tracks: every card
    // sits on a track origin, never straddling a gap.
    const container = canvasElement.querySelector<HTMLElement>('[data-test="cards"]')!;
    const cards = Array.from(container.querySelectorAll<HTMLElement>(":scope > div"));
    const columns = new Set(cards.map((card) => cellsOf(card, "--mw-x")));
    expect(columns.size).toBe(3);
  },
};

export const Spanner: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-2">
        <div class="max-w-60 columns-2 gap-5 rule-zinc-500 rule-x" data-test="span">
          <p>${PROSE}</p>
          <p class="mt-1">A margined paragraph rides its gap into the flow.</p>
          <h2 class="my-1 bg-fuchsia-500 p-1 text-white [column-span:all]">Spanning heading</h2>
          <p>
            A closing paragraph flows through both columns below the spanning heading — split
            mid-paragraph, except in Safari, which distributes whole paragraphs between spanners.
          </p>
        </div>
        <div class="max-w-60 columns-2 gap-5 rule-zinc-500 rule-x" data-test="span-lead">
          <h2 class="mb-1 bg-sky-500 p-1 text-white [column-span:all]">Leading heading</h2>
          <p>A single paragraph below a leading spanner flows through both columns everywhere.</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // In-flow spanner (specs/multicol.md, probed): on engines whose
    // balancer the engine can predict (Chromium/Firefox), each SINGLE
    // paragraph splits across both columns of its segment. WebKit
    // balances segments in ink-height sub-pixels — unpredictable — and
    // falls back to atomic distribution.
    const host = await readyHost(canvasElement);
    await document.fonts.ready;
    await waitFor(
      () => {
        const el = canvasElement.querySelector<HTMLElement>('[data-test="span"]')!;
        const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
        const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
        const paragraphs = Array.from(el.querySelectorAll("p"));
        const first = paragraphs[0]!;
        const last = paragraphs.at(-1)!;
        if (el.hasAttribute("data-mw-multicol")) {
          // The long opening paragraph splits across its segment's
          // columns (the short margined one need not).
          expect(charColumns(el, first, cellWidth).size, "first paragraph splits").toBe(2);
        }
        // The spanner sits at full width between the two segments.
        const spanner = el.querySelector("h2")!.getBoundingClientRect();
        expect(spanner.top).toBeGreaterThan(first.getBoundingClientRect().top);
        expect(spanner.bottom).toBeLessThan(last.getBoundingClientRect().bottom);
        expect(Math.round(spanner.width / cellWidth), "spanner full width").toBe(
          contentCellsOf(el),
        );
        if (el.hasAttribute("data-mw-multicol")) {
          // …and so does the closing paragraph below it.
          expect(charColumns(el, last, cellWidth).size, "last paragraph splits").toBe(2);
        }
        // The margin-as-padding translation must never leave native text
        // between cells: every character lands on a whole engine row,
        // whichever path laid it out.
        const box = el.getBoundingClientRect();
        const contentTop = box.top + (cellsOf(el, "--mw-bt") + cellsOf(el, "--mw-pt")) * cellHeight;
        eachCharRect(el, (rect, char) => {
          const row = (rect.top + rect.height / 2 - contentTop) / cellHeight - 0.5;
          expect(Math.abs(row - Math.round(row)), `"${char}" on a whole row`).toBeLessThan(0.2);
        });
        // With every paragraph in ONE segment (spanner only at the
        // edge), the flow path holds in EVERY engine — WebKit's
        // ink-fractional segment heights can't corrupt an origin that
        // has no balanced segment above it.
        const lead = canvasElement.querySelector<HTMLElement>('[data-test="span-lead"]')!;
        expect(lead.hasAttribute("data-mw-multicol"), "leading-spanner container flows").toBe(true);
        expect(
          charColumns(lead, lead.querySelector("p")!, cellWidth).size,
          "single paragraph splits below a leading spanner",
        ).toBe(2);
      },
      { timeout: 10_000 },
    );
  },
};

export const SpannerMarginFallback: StoryObj = {
  // Test-only: hidden from the Storybook sidebar (and the visual suite),
  // still run by the Vitest story tests. A MARGINED single-segment
  // spanner container — visually a repeat of the Spanner story, but the
  // margin is the one trigger its visible containers can't isolate:
  // glue engines keep the flow; WebKit (slice) falls back to atomic
  // distribution.
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="max-w-60 columns-2 gap-5 rule-zinc-500 rule-x" data-test="margins">
        <h2 class="mb-1 bg-emerald-500 p-1 text-white [column-span:all]">Margined prose</h2>
        <p>${PROSE}</p>
        <p class="mt-1">A margined trailer.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    await document.fonts.ready;
    await waitFor(
      () => {
        const el = canvasElement.querySelector<HTMLElement>('[data-test="margins"]')!;
        const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
        const paragraphs = Array.from(el.querySelectorAll("p"));
        if (el.hasAttribute("data-mw-multicol")) {
          expect(charColumns(el, paragraphs[0]!, cellWidth).size, "margined prose splits").toBe(2);
        } else {
          // Atomic: whole paragraphs, each about one column wide
          // (gap-5 across 2 tracks; a split one would span the full
          // content width), give or take a quantized cell.
          const columnWidth = (contentCellsOf(el) - 5) / 2;
          for (const p of paragraphs) {
            expect(
              p.getBoundingClientRect().width / cellWidth,
              "paragraph stays in one column",
            ).toBeLessThanOrEqual(columnWidth + 1);
          }
        }
      },
      { timeout: 10_000 },
    );
  },
};

export const FixedHeight: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="h-4 max-w-40 columns-2 gap-4 border border-cyan-400" data-test="overfill">
          <div>[overfill]</div>
          <div>alpha</div>
          <div>bravo</div>
          <div>charlie</div>
          <div>delta</div>
          <div>echo</div>
          <div>foxtrot</div>
        </div>
        <div
          class="h-7 max-w-40 columns-2 gap-4 border border-emerald-400 [column-fill:auto]"
          data-test="underfill"
        >
          <div>[underfill]</div>
          <div>alpha</div>
          <div>bravo</div>
          <div>charlie</div>
          <div>delta</div>
          <div>echo</div>
          <div>foxtrot</div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    // A definite height RESTRICTS column heights (css-multicol §7).
    // Overfilled (seven children, two-row columns): two per column, the
    // third and fourth OVERFLOW columns past the content box — the fill
    // mode doesn't matter here, default `balance` clamps to the same
    // restriction. Underfilled (same children, five-row columns) is
    // where `column-fill: auto` shows: the first column packs five and
    // the second gets the remaining two, where `balance` would split
    // them four and three.
    const host = await readyHost(canvasElement);
    await document.fonts.ready;
    await waitFor(
      () => {
        const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
        const overfill = canvasElement.querySelector<HTMLElement>('[data-test="overfill"]')!;
        expect([...charColumns(overfill, overfill, cellWidth)].sort(), "overflow columns").toEqual([
          0, 1, 2, 3,
        ]);
        const underfill = canvasElement.querySelector<HTMLElement>('[data-test="underfill"]')!;
        const children = Array.from(underfill.querySelectorAll("div"));
        expect(
          [...charColumns(underfill, children[4]!, cellWidth)],
          "fifth child still in the first column",
        ).toEqual([0]);
        expect(
          [...charColumns(underfill, children[5]!, cellWidth)],
          "the sixth child starts the second column",
        ).toEqual([1]);
      },
      { timeout: 10_000 },
    );
  },
};
