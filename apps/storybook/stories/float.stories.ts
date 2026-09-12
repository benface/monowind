import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { dragTo, pressAt, readyGrid, release } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Float",
};
export default meta;

/**
 * Floats (specs/float.md). The browser floats the same boxes natively,
 * so every line's native glyphs sit on the grid's cells — checked
 * character by character in three engines by each story below.
 */
/**
 * A drop cap — a `<mono-ascii>` floated left — the paragraph wraps
 * around: its lines start past the cap's margin box, then at the
 * content origin once below it. A text-mode drag across the wrapped
 * lines paints its highlight on the glyphs, from the first row after
 * the cap.
 */
export const DropCap: StoryObj = {
  name: "Drop Cap",
  render: () => html`
    <mono-wind>
      <div data-test="article" class="border border-neutral-500 px-3 py-1">
        <mono-ascii data-test="cap" font="small" trim class="float-left mr-2 mb-1 text-amber-300"
          >A</mono-ascii
        >
        <p data-test="first">
          raccoon walked into the corner bakery this Tuesday, took one long look at the display
          case, and left without paying for a sourdough loaf clutched under its left arm. The
          proprietor described the incident as unusually polite: the animal closed the door behind
          itself and made brief eye contact on the way out.
        </p>
        <p class="mt-1">
          The proprietor, Mrs. Henshaw, described the incident as <em>unusually polite</em>: the
          animal reportedly closed the door behind itself and made brief eye contact on the way out.
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, width, height, measure } = await readyGrid(canvasElement);
    const [cap, first] = [by("cap"), by("first")];
    expect(cap).toHaveAttribute("data-mw-float", "left");
    expect(first).toHaveAttribute("data-mw-flow", "text");
    // The cap's exclusion is its margin box: the paragraph's lines start
    // past it, and at the content origin once below it.
    const capRows = height(cap) + cells(cap, "--mw-mb");
    let capRow = 0;
    let textCol = 0;
    await waitFor(
      () => {
        const { rows, boxOf, expectNativeOnGrid } = measure();
        const origin = boxOf(first);
        capRow = origin.row;
        textCol = origin.col + width(cap) + cells(cap, "--mw-mr");
        expect(boxOf(cap)).toEqual(origin);
        expect(rows[capRow]!.slice(origin.col, textCol).trim()).not.toBe("");
        expect(rows[capRow]!.indexOf("raccoon")).toBe(textCol);
        const lines = expectNativeOnGrid(first);
        expect(lines[0]!.row).toBe(capRow);
        for (const { row, col } of lines) {
          expect(col).toBe(row < capRow + capRows ? textCol : origin.col);
        }
      },
      { timeout: 5_000 },
    );
    const { cellOf, cellAt } = measure();
    host.setAttribute("select", "text");
    expect(pressAt(first, cellAt(textCol, capRow), 1)).toBe(false);
    dragTo(first, cellAt(textCol, capRow + 2));
    await waitFor(() =>
      expect(document.getSelection()!.toString().startsWith("raccoon")).toBe(true),
    );
    // The highlight is the grid's native selection, read through the
    // host's shadow (its anchor is retargeted onto the host in Firefox);
    // its rects say which cells each row covers.
    const selected = (row: number) => {
      const sel = document.getSelection()!;
      const live =
        sel.getComposedRanges?.({ shadowRoots: [host.shadowRoot!] })[0] ??
        (host.shadowRoot as { getSelection?: () => Selection | null })
          .getSelection?.()
          ?.getRangeAt(0) ??
        sel.getRangeAt(0);
      const range = document.createRange();
      range.setStart(live.startContainer, live.startOffset);
      range.setEnd(live.endContainer, live.endOffset);
      return Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && cellOf(rect).row === row)
        .map((rect) => cellOf(rect).col);
    };
    expect(Math.min(...selected(capRow))).toBe(textCol);
    expect(Math.min(...selected(capRow + 1))).toBe(textCol);
    expect(selected(capRow + 2).length).toBeGreaterThan(0);
    release();
    document.getSelection()!.removeAllRanges();
  },
};

/**
 * A left and a right float side by side with prose between them; a
 * box with a width passes under the quote — its box at the content
 * origin, its text below the quote, as CSS flows a plain block; a
 * right float declared later starts a row (its top margin) under that
 * box, and the aside's height contains it.
 */
export const PullQuote: StoryObj = {
  name: "Pull Quote",
  render: () => html`
    <mono-wind>
      <div data-test="aside" class="max-w-64 border border-neutral-500 px-3 py-1">
        <div data-test="quote" class="float-left mr-1 w-14 border px-1 text-cyan-300">
          The bread was probably day-old anyway.
        </div>
        <div
          data-test="stamp-1"
          class="float-right ml-1 border border-amber-400 px-1 text-amber-300"
        >
          § 001
        </div>
        <p data-test="prose" class="pt-1">
          Officer J. Kimball is investigating but concedes the bread was probably day-old anyway.
        </p>
        <div data-test="under" class="mt-1 w-16 bg-neutral-800 p-1">
          a box with a defined width goes under
        </div>
        <div
          data-test="stamp-2"
          class="float-right mt-1 ml-1 border border-amber-400 px-1 text-amber-300"
        >
          § 002
        </div>
        <p class="mt-1">
          The bakery's security camera, pointed at a wall for reasons Mrs. Henshaw could not
          remember, offered no leads.
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, width, height, measure } = await readyGrid(canvasElement);
    const [aside, quote, stamp1, prose, under, stamp2] = [
      by("aside"),
      by("quote"),
      by("stamp-1"),
      by("prose"),
      by("under"),
      by("stamp-2"),
    ];
    expect(quote).toHaveAttribute("data-mw-float", "left");
    expect(stamp1).toHaveAttribute("data-mw-float", "right");
    expect(prose).toHaveAttribute("data-mw-flow", "text");
    expect(under).toHaveAttribute("data-mw-flow", "text");
    await waitFor(
      () => {
        const { rows, boxOf, expectNativeOnGrid } = measure();
        const { row: top, col: origin } = boxOf(quote);
        const bandCol = origin + width(quote) + 1;
        const quoteBottom = top + height(quote);
        const stampCol = boxOf(stamp1).col;
        const stampBottom = boxOf(stamp1).row + height(stamp1);
        expect(boxOf(prose).col).toBe(origin);
        expect(stampCol + width(stamp1)).toBe(boxOf(aside).col + width(aside) - 4);
        const lines = expectNativeOnGrid(prose);
        expect(lines[0]!.row).toBe(top + 1);
        expect(lines.some(({ row }) => row >= stampBottom)).toBe(true);
        for (const { row, col, max } of lines) {
          expect(row).toBeLessThan(quoteBottom);
          expect(col).toBe(bandCol);
          if (row < stampBottom) expect(max).toBeLessThan(stampCol - 1);
        }
        expect(boxOf(under)).toEqual({ row: boxOf(prose).row + height(prose) + 1, col: origin });
        expect(boxOf(under).row).toBeLessThan(quoteBottom);
        expect(expectNativeOnGrid(under)[0]!.row).toBe(quoteBottom);
        expect(rows[quoteBottom]!.indexOf("a box")).toBe(origin + 1);
        const stampRow = boxOf(under).row + height(under) + 1;
        expect(boxOf(stamp2)).toEqual({ row: stampRow, col: stampCol });
        // The aside contains its floats: its bottom padding and border
        // come no sooner than the last stamp.
        expect(boxOf(aside).row + height(aside)).toBeGreaterThanOrEqual(
          stampRow + height(stamp2) + 2,
        );
      },
      { timeout: 5_000 },
    );
  },
};

/**
 * Floats wrapping: six tiles of one width float left, four filling the
 * row exactly and the fifth and sixth wrapping under them (CSS 2.1
 * §9.5.1: a float that no longer fits moves down to the first row
 * where it does); the paragraph after them flows into the first band
 * with room, beside the second row, then takes the full width; six
 * tiles floated right after it start where it ended and wrap the same
 * way from the right edge, and the box's height contains them.
 */
export const MultipleFloats: StoryObj = {
  name: "Multiple Floats",
  render: () => html`
    <mono-wind>
      <div data-test="box" class="max-w-64 border border-neutral-500 px-3 py-1">
        ${["one", "two", "three", "four", "five", "six"].map(
          (name) => html`
            <div data-test=${name} class="float-left mr-1 w-13 border px-1 text-cyan-300">
              ${name}
            </div>
          `,
        )}
        <p data-test="prose">
          Floats wrap like words: four tiles fill the row, the fifth starts a new one below them,
          and the text flows into the first band with room for it, then across the whole width.
        </p>
        ${["one", "two", "three", "four", "five", "six"].map(
          (name) => html`
            <div data-test="${name}-right" class="float-right ml-1 w-13 border px-1 text-cyan-300">
              ${name}
            </div>
          `,
        )}
        <p>Howdy!</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, cells, width, height, measure } = await readyGrid(canvasElement);
    const names = ["one", "two", "three", "four", "five", "six"];
    const tiles = names.map(by);
    const rightTiles = names.map((name) => by(`${name}-right`));
    const [box, prose] = [by("box"), by("prose")];
    const tile = tiles[0]!;
    expect(tile).toHaveAttribute("data-mw-float", "left");
    expect(prose).toHaveAttribute("data-mw-flow", "text");
    await waitFor(
      () => {
        const { rows, boxOf, expectNativeOnGrid } = measure();
        const origin = boxOf(prose);
        // A float's native margin is its authored one, in cells.
        expect(cells(tile, "--mw-mr")).toBe(1);
        const stride = width(tile) + 1;
        const rowHeight = height(tile);
        const end = boxOf(box).col + width(box) - 4;
        const perRow = Math.floor((end - origin.col) / stride);
        expect(perRow).toBe(4);
        // Each tile on its row and column, natively and on the grid (its
        // border's corner on that cell).
        tiles.forEach((el, i) => {
          const at = {
            row: origin.row + Math.floor(i / perRow) * rowHeight,
            col: origin.col + (i % perRow) * stride,
          };
          expect(boxOf(el)).toEqual(at);
          expect(rows[at.row]![at.col]).toBe("┌");
        });
        // The prose: the first row of tiles leaves no cell, so its lines
        // start beside the second row, past the two tiles there, and
        // run the full width below them.
        const secondRow = origin.row + rowHeight;
        const lines = expectNativeOnGrid(prose);
        expect(lines[0]!.row).toBe(secondRow);
        expect(lines.some(({ row }) => row >= secondRow + rowHeight)).toBe(true);
        for (const { row, col } of lines) {
          expect(col).toBe(row < secondRow + rowHeight ? origin.col + 2 * stride : origin.col);
        }
        // The right tiles start at the paragraph's bottom and fill their
        // rows from the right edge, each later one to the left.
        const proseBottom = boxOf(prose).row + height(prose);
        rightTiles.forEach((el, i) => {
          const at = {
            row: proseBottom + Math.floor(i / perRow) * rowHeight,
            col: end - (i % perRow) * stride - width(el),
          };
          expect(boxOf(el)).toEqual(at);
          expect(rows[at.row]![at.col]).toBe("┌");
        });
        // The box contains its floats: its bottom padding and border
        // follow the last row of tiles.
        expect(boxOf(box).row + height(box)).toBe(proseBottom + 2 * rowHeight + 2);
      },
      { timeout: 5_000 },
    );
  },
};

/** The three `clear` values, each against a left and a right float of
 * different heights (classes spelled out for Tailwind's scanner). */
const CLEARS = [
  {
    clear: "right",
    cleared: "clear-right",
    left: "h-5",
    right: "h-3",
    note: "below the right float, still beside the left one",
  },
  {
    clear: "left",
    cleared: "clear-left",
    left: "h-3",
    right: "h-5",
    note: "below the left float, still beside the right one",
  },
  { clear: "both", cleared: "clear-both", left: "h-3", right: "h-5", note: "below both floats" },
] as const;

/**
 * `clear`: a paragraph's top moves below the floats it names — the
 * right one, the left one, or both — and its lines still wrap beside
 * the float it did not name (CSS 2.1 §9.5.2). Each section floats a
 * left and a right box of different heights, flows one line between
 * them, then clears.
 */
export const Clear: StoryObj = {
  name: "Clear",
  render: () => html`
    <mono-wind>
      <div data-test="box" class="max-w-64 border border-neutral-500 px-3 py-1">
        ${CLEARS.map(
          ({ clear, cleared, left, right, note }) => html`
            <div
              data-test="${clear}-left"
              class="${left} float-left mr-1 border px-1 text-cyan-300"
            >
              left
            </div>
            <div
              data-test="${clear}-right"
              class="${right} float-right ml-1 border px-1 text-cyan-300"
            >
              right
            </div>
            <p data-test="${clear}-line">Both floats beside this line.</p>
            <p data-test="${clear}-cleared" class="${cleared} not-last:mb-1">
              ${cleared}: ${note}.
            </p>
          `,
        )}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, width, height, measure } = await readyGrid(canvasElement);
    const box = by("box");
    await waitFor(
      () => {
        const { boxOf, expectNativeOnGrid } = measure();
        const end = boxOf(box).col + width(box) - 4;
        for (const { clear } of CLEARS) {
          const [left, right, line, cleared] = [
            by(`${clear}-left`),
            by(`${clear}-right`),
            by(`${clear}-line`),
            by(`${clear}-cleared`),
          ];
          // The section's floats at its top, one at each edge; the
          // uncleared line between them.
          const { row: top, col: origin } = boxOf(line);
          expect(boxOf(left)).toEqual({ row: top, col: origin });
          expect(boxOf(right)).toEqual({ row: top, col: end - width(right) });
          const afterLeft = origin + width(left) + 1;
          const beforeRight = boxOf(right).col - 1;
          const [only] = expectNativeOnGrid(line);
          expect(only).toMatchObject({ row: top, col: afterLeft });
          expect(only!.max).toBeLessThan(beforeRight);
          // The cleared paragraph's top is the named floats' bottom, past
          // the line; its lines wrap beside the float it did not name.
          const leftBottom = top + height(left);
          const rightBottom = top + height(right);
          const bottoms = {
            left: leftBottom,
            right: rightBottom,
            both: Math.max(leftBottom, rightBottom),
          };
          expect(boxOf(cleared)).toEqual({ row: bottoms[clear], col: origin });
          expect(boxOf(cleared).row).toBeGreaterThan(top + height(line));
          const lines = expectNativeOnGrid(cleared);
          if (clear !== "both") expect(lines.length).toBeGreaterThan(1);
          for (const { row, col, max } of lines) {
            expect(col).toBe(row < leftBottom ? afterLeft : origin);
            if (row < rightBottom) expect(max).toBeLessThan(beforeRight);
          }
        }
      },
      { timeout: 5_000 },
    );
  },
};
