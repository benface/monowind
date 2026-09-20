import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  cellSize,
  expectOnItsCells,
  expectTouching,
  readyGrid,
  readyHost,
  rowsOf,
  testHooks,
} from "./helpers.ts";

/**
 * Positioning (specs/positioning.md): relative offsets and absolute
 * boxes against their containing blocks; sticky boxes shifted with
 * their scroll container's offset (specs/sticky.md); anchored boxes
 * placed against another box, in cells (specs/anchor-positioning.md).
 */
const meta: Meta = {
  title: "Features / Positioning",
};
export default meta;

export const Relative: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max gap-2 border border-neutral-500 px-1">
        <div class="top-1 border border-neutral-500 px-1">static</div>
        <div class="relative -top-1 border border-cyan-400 px-1">-top-1</div>
        <div class="relative top-1 left-2 border border-yellow-400 px-1">top-1 left-2</div>
        <div class="relative inset-e-2 bottom-1 border border-yellow-400 px-1">
          bottom-1 inset-e-2
        </div>
      </div>
    </mono-wind>
  `,
};

export const Absolute: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="relative min-h-8 max-w-40 border border-neutral-500 px-1">
          <div>anchored corners</div>
          <div class="absolute top-0 right-0 border border-cyan-400 px-1">top-0 right-0</div>
          <div class="absolute bottom-0 left-0 border border-yellow-400 px-1">bottom-0 left-0</div>
        </div>
        <div class="relative min-h-9 max-w-40 border border-neutral-500 px-1">
          <div class="z-10 -mt-1 w-max bg-clear px-1">filled</div>
          <div
            class="absolute inset-0 flex items-center justify-center border border-fuchsia-400 px-1"
          >
            inset-0
          </div>
        </div>
        <div class="relative min-h-9 max-w-40 border border-neutral-500 px-1">
          <div class="z-10 -mt-1 w-max bg-clear px-1">centered</div>
          <div class="absolute inset-0 m-auto size-max max-w-full border border-fuchsia-400 px-1">
            inset-0 m-auto size-max
          </div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const InlineRelative: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-60 border border-neutral-500 px-3 py-1 leading-loose">
        Inline elements can shift on the grid: this word is
        <span class="relative top-1 text-cyan-400">lowered</span> and this one is
        <span class="relative -top-1 text-yellow-400">raised</span> by one row, without affecting
        the flow of the text around them.
      </div>
    </mono-wind>
  `,
};

/*
 * Sticky (specs/sticky.md): a box shifted with its scroll container's
 * offset at paint time, the browser's own box following it — each
 * story scrolls natively and checks the grid and the native box agree
 * on the cell, in three engines.
 */

const SECTIONS = [
  {
    title: "Section one",
    text: "A raccoon walked into the corner bakery this Tuesday, took one long look at the display case, and left without paying for a sourdough loaf clutched under its left arm.",
  },
  {
    title: "Section two",
    text: "The proprietor described the incident as unusually polite: the animal reportedly closed the door behind itself and made brief eye contact on the way out.",
  },
  {
    title: "Section three",
    text: "Officer Kimball is investigating but concedes the bakery's security camera, pointed at a wall for reasons nobody could remember, offered no leads.",
  },
];

/**
 * Section headings pinned to the top of a scrolling list — each held
 * until its section's end pushes it out and the next takes over — and
 * each section's footer pinned to the bottom, ahead of its place, until
 * its own row scrolls into view.
 */
export const StickyHeadings: StoryObj = {
  render: () => html`
    <mono-wind>
      <div
        data-test="scroller"
        class="flex h-8 max-w-64 flex-col gap-1 overflow-y-auto border border-neutral-500 px-3 py-1"
      >
        ${SECTIONS.map(
          ({ title, text }, i) => html`
            <section>
              <h2
                data-test="heading-${i}"
                class="sticky top-0 z-10 bg-clear font-bold text-amber-300"
              >
                ${title}
              </h2>
              <p>${text}</p>
              <p data-test="footer-${i}" class="sticky bottom-0 bg-clear text-neutral-400">
                — end of the section —
              </p>
            </section>
          `,
        )}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, height, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const headings = SECTIONS.map((_, i) => by(`heading-${i}`));
    const footers = SECTIONS.map((_, i) => by(`footer-${i}`));
    const cellHeight = cellSize(host).height;
    const { boxOf } = measure();
    // The scrollport's first and last rows — the padding box's, per CSS
    // — the content's first row and column inside the padding.
    const top = boxOf(scroller).row + cells(scroller, "--mw-bt");
    const bottom = boxOf(scroller).row + height(scroller) - cells(scroller, "--mw-bb") - 1;
    const padding = cells(scroller, "--mw-pt");
    const col = boxOf(scroller).col + cells(scroller, "--mw-bl") + cells(scroller, "--mw-pl");
    const sectionRows = boxOf(headings[1]!).row - boxOf(headings[0]!).row;
    // Scrolled by whole rows; the paint that shifts a box writes its
    // native shift too, so a box's var says when it has landed.
    const scrollTo = async (rows: number, landed: () => void) => {
      scroller.scrollTo({ top: rows * cellHeight, behavior: "instant" });
      await waitFor(landed);
    };
    const atTop = (title: string) => expect(measure().rows[top]!.indexOf(title)).toBe(col);
    const atBottom = (footer: HTMLElement) => {
      expect(measure().rows[bottom]!.indexOf("— end")).toBe(col);
      expect(boxOf(footer).row).toBe(bottom);
    };
    // At rest: the first heading on the content's first row, its
    // section's footer already pulled up to the bottom row ahead of its
    // place.
    expect(boxOf(headings[0]!).row).toBe(top + padding);
    atBottom(footers[0]!);
    expect(cells(footers[0]!, "--mw-sy")).toBeLessThan(0);
    // Into the first section: its heading held on the scrollport's first
    // row, natively too; its footer back on its own row, and the second
    // section's on the bottom row (a row clear of that section's
    // heading).
    await scrollTo(4, () => expect(cells(headings[0]!, "--mw-sy")).toBe(4 - padding));
    atTop("Section one");
    expect(boxOf(headings[0]!).row).toBe(top);
    expect(cells(footers[0]!, "--mw-sy")).toBe(0);
    atBottom(footers[1]!);
    // Into the second: the hand-over at both edges.
    await scrollTo(sectionRows + 4, () => expect(cells(headings[1]!, "--mw-sy")).toBe(4 - padding));
    atTop("Section two");
    expect(boxOf(headings[0]!).row).toBeLessThan(top);
    expect(cells(footers[1]!, "--mw-sy")).toBe(0);
    atBottom(footers[2]!);
    // At the end: the last footer on its own row — the content's last,
    // the padding row below it — no longer shifted.
    await scrollTo(1000, () => expect(cells(footers[2]!, "--mw-sy")).toBe(0));
    atTop("Section three");
    expect(boxOf(footers[2]!).row).toBe(bottom - cells(scroller, "--mw-pb"));
  },
};

/**
 * A bar hidden until the scroll reaches it, then holding the
 * scrollport's bottom row for the rest of the scroll — a `top` inset of
 * the scrollport's height less one row, a `calc()` of a percentage and
 * cells (specs/cell-model.md "Mixed-unit calc()").
 */
export const StickyFooter: StoryObj = {
  render: () => html`
    <mono-wind>
      <div
        data-test="scroller"
        class="h-8 max-w-64 overflow-y-auto border border-neutral-500 px-3 py-1"
      >
        <p>${SECTIONS[0]!.text}</p>
        <p class="mt-1">${SECTIONS[1]!.text}</p>
        <p
          data-test="footer"
          class="sticky top-[calc(100%-(--spacing(1)))] h-1 bg-clear text-amber-300"
        >
          Please consider subscribing to our newsletter
        </p>
        <p>${SECTIONS[2]!.text}</p>
        <div class="h-2"></div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, height, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const footer = by("footer");
    const cellHeight = cellSize(host).height;
    const { boxOf } = measure();
    const edge = (side: string) =>
      cells(scroller, `--mw-b${side}`) + cells(scroller, `--mw-p${side}`);
    const top = boxOf(scroller).row + edge("t");
    const col = boxOf(scroller).col + edge("l");
    // The scrollport's last row: the padding box's, per CSS.
    const bottom = boxOf(scroller).row + height(scroller) - cells(scroller, "--mw-bb") - 1;
    const text = "Please consider";
    const footerRow = () => measure().rows.findIndex((row) => row.indexOf(text) === col);
    // At rest: below the scrollport, in its own slot.
    const slot = boxOf(footer).row - top;
    expect(top + slot).toBeGreaterThan(bottom);
    expect(footerRow()).toBe(-1);
    // Scrolled to where its slot would sit on the second content row:
    // held on the bottom row instead, natively too.
    scroller.scrollTo({ top: (slot - 1) * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(footer, "--mw-sy")).toBe(bottom - top - 1));
    expect(footerRow()).toBe(bottom);
    expect(boxOf(footer).row).toBe(bottom);
    // At the end: on the content's last row — its containing block's
    // end, the padding row below it — over the trailing blank rows.
    scroller.scrollTo({ top: 1000, behavior: "instant" });
    await waitFor(() => {
      expect(footerRow()).toBe(bottom - 1);
      expect(
        measure()
          .rows[bottom - 2]!.slice(col, col + text.length)
          .trim(),
      ).toBe("");
    });
    expect(boxOf(footer).row).toBe(bottom - 1);
  },
};

const COLUMNS = ["mon", "tue", "wed", "thu", "fri", "sat"];
const ROWS = ["loaves", "rolls", "bagels", "scones", "buns", "rye", "pita", "naan"];

/**
 * A bordered table in a scroller with a sticky header row and a sticky
 * first column: the collapsed lattice follows each — the header's lines
 * with it, joined to the column lines running on below — and the corner
 * cell sticks both ways.
 */
export const StickyTable: StoryObj = {
  render: () => html`
    <mono-wind>
      <div data-test="scroller" class="h-8 max-w-40 overflow-auto pe-1 scrollbar-y-2">
        <table class="border-collapse">
          <thead data-test="thead" class="sticky top-0 bg-clear text-amber-300">
            <tr>
              <th data-test="corner" class="sticky left-0 border border-neutral-400 bg-clear px-1">
                #
              </th>
              ${COLUMNS.map((c) => html`<th class="border border-neutral-400 px-1">${c}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${ROWS.map(
              (r, i) => html`
                <tr>
                  <th
                    data-test="row-${i}"
                    class="sticky left-0 border border-neutral-400 bg-clear px-1 text-left text-cyan-300"
                  >
                    ${r}
                  </th>
                  ${COLUMNS.map(
                    (_, j) =>
                      html`<td class="border border-neutral-400 px-1">${(i + 1) * (j + 1)}</td>`,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, cells, width, measure } = await readyGrid(canvasElement);
    const scroller = by("scroller");
    const [thead, corner, row0, row2] = [by("thead"), by("corner"), by("row-0"), by("row-2")];
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const { boxOf } = measure();
    // The scrollport's first row and column: past the scroller's border
    // and padding cells.
    const top = boxOf(scroller).row + cells(scroller, "--mw-bt") + cells(scroller, "--mw-pt");
    const left = boxOf(scroller).col + cells(scroller, "--mw-bl") + cells(scroller, "--mw-pl");
    // The first column's cells, lines beside them: its width sets where
    // the first inner line falls.
    const w = width(row0);
    const line = (a: string, b: string, c: string) => a + b.repeat(w) + c;
    const slice = (row: number) => measure().rows[row]!.slice(left, left + w + 2);
    // At rest: the table's top edge on the scrollport's first row.
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    // Scrolled down four rows: the header stays with its lines, its
    // bottom line joined to the column lines below, the third body row
    // under it; natively the same cells.
    scroller.scrollTo({ top: 4 * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(thead, "--mw-sy")).toBe(4));
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    expect(slice(top + 1)).toMatch(/^│ +# +│$/);
    expect(slice(top + 2)).toBe(line("├", "─", "┼"));
    expect(slice(top + 3)).toBe("│ bagels │");
    expect(boxOf(thead).row).toBe(top + 1);
    expect(boxOf(row2).row).toBe(top + 3);
    // Scrolled right as well: the first column stays at the left edge,
    // lines included, the corner cell with it.
    scroller.scrollTo({ left: 4 * cellWidth, top: 4 * cellHeight, behavior: "instant" });
    await waitFor(() => expect(cells(row0, "--mw-sx")).toBe(4));
    expect(slice(top)).toBe(line("┌", "─", "┬"));
    expect(slice(top + 1)).toMatch(/^│ +# +│$/);
    expect(slice(top + 3)).toBe("│ bagels │");
    expect(boxOf(corner)).toEqual({ row: top + 1, col: left + 1 });
    expect(boxOf(row2)).toEqual({ row: top + 3, col: left + 1 });
    expect(cells(corner, "--mw-sx")).toBe(4);
  },
};

/*
 * Anchored (specs/anchor-positioning.md): a box placed against another
 * in cells — a menu under its button, a tooltip above its word, a
 * submenu beside its item — flipped where the host leaves no room,
 * following its anchor through a scroll, the light element on the same
 * cells.
 */

/**
 * A popover menu under its button, anchored by `popovertarget` alone;
 * a tooltip above a word; a submenu beside its item; a low menu with
 * no room below flipped above its button.
 */
export const Anchored: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="px-1 pt-4 pb-1">
        <p>
          A page with a
          <span data-test="word" class="underline [anchor-name:--word]">word</span>
          that carries a tooltip, and a menu below.
        </p>
        <span
          data-test="tooltip"
          class="absolute border px-1 [position-anchor:--word] [position-area:top]"
        >
          a tooltip
        </span>
        <p class="mt-1">
          <button
            data-test="open"
            popovertarget="anchored-menu"
            popovertargetaction="show"
            class="border px-1"
          >
            menu
          </button>
        </p>
        <div
          id="anchored-menu"
          data-test="menu"
          popover
          class="border bg-clear px-1 [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
        >
          <p>Cut</p>
          <p>Copy</p>
          <p data-test="paste" class="[anchor-name:--paste]">Paste &gt;</p>
        </div>
        <div
          data-test="submenu"
          class="absolute ml-2 border bg-clear px-1 [position-anchor:--paste] [position-area:right_span-bottom]"
        >
          <p>Plain</p>
          <p>Formatted</p>
        </div>
        <p class="mt-7">
          More of the page, down to its edge, where a menu has no room below its button.
        </p>
        <p class="flex justify-end">
          <button
            data-test="open-low"
            popovertarget="low-menu"
            popovertargetaction="show"
            class="border px-1"
          >
            low menu
          </button>
        </p>
        <div
          id="low-menu"
          data-test="low"
          popover="manual"
          class="border bg-clear px-1 [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
        >
          <p>Flipped</p>
          <p>above</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const box = (name: string) => by(name).getBoundingClientRect();
    // Both menus open before anything is asserted: the sweep photographs
    // the state the play reached, so a failed edge must not take a box
    // out of the picture.
    by("open").click();
    by("open-low").click();
    // The tooltip's box sits on the row above the word, centered on it.
    await waitFor(() => expect(by("tooltip").getAttribute("data-mw-area")).toBe("span-all top"));
    await expectTouching(
      () => box("tooltip").bottom,
      () => box("word").top,
    );
    expect(box("tooltip").left).toBeLessThan(box("word").left);
    expect(box("tooltip").right).toBeGreaterThan(box("word").right);
    // The menu sits under its button, left edges together, as its
    // invoker's anchor; its submenu beside the item, top edges together.
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right bottom"));
    await expectTouching(
      () => box("menu").left,
      () => box("open").left,
    );
    await expectTouching(
      () => box("menu").top,
      () => box("open").bottom,
    );
    await expectOnItsCells(host, by("menu"));
    await waitFor(() =>
      expect(by("submenu").getAttribute("data-mw-area")).toBe("right span-bottom"),
    );
    await expectTouching(
      () => box("submenu").top,
      () => box("paste").top,
    );
    // The cell is read per try, a late font load resizing it.
    await expectTouching(
      () => box("submenu").left - 2 * cellSize(host).width,
      () => box("paste").right,
    );
    // No room below the low button: that menu flipped above it.
    await waitFor(() => expect(by("low").getAttribute("data-mw-area")).toBe("span-right top"));
    await expectTouching(
      () => box("low").bottom,
      () => box("open-low").top,
    );
  },
};

/**
 * The fallbacks, live: a note beside a word, one line by `text-nowrap`,
 * flips to its left when the pane is too narrow for it (resize the
 * pane); a menu in a scrolling list follows its button and flips above
 * it where the host's bottom edge leaves no room below (scroll the
 * list).
 */
export const AnchorFallbacks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>
          Resize the pane: the note flips to the word's left where the right edge leaves no room.
          Scroll the list: the menu follows its button, flipping above it at the bottom edge.
        </p>
        <p class="mt-1 pl-80">
          <span data-test="word" class="underline [anchor-name:--noted]">word</span>
        </p>
        <span
          data-test="note"
          class="absolute border px-1 text-nowrap [position-anchor:--noted] [position-area:right] [position-try-fallbacks:flip-inline]"
        >
          a note beside the word
        </span>
        <div data-test="list" class="mt-1 h-10 overflow-y-auto border border-neutral-500">
          ${Array.from({ length: 6 }, (_, i) => html`<p>Row ${i + 1} of the list.</p>`)}
          <button
            data-test="open"
            popovertarget="fallback-menu"
            popovertargetaction="show"
            class="border px-1"
          >
            menu
          </button>
          ${Array.from({ length: 10 }, (_, i) => html`<p>Row ${i + 7} of the list.</p>`)}
          <div
            id="fallback-menu"
            data-test="menu"
            popover
            class="border bg-clear px-1 [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
          >
            <p>Cut</p>
            <p>Copy</p>
            <p>Paste</p>
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const box = (name: string) => by(name).getBoundingClientRect();
    // The note sits beside the word on whichever side has the room.
    await waitFor(() => expect(by("note").getAttribute("data-mw-area")).toMatch(/span-all$/));
    if (by("note").getAttribute("data-mw-area") === "right span-all") {
      await expectTouching(
        () => box("note").left,
        () => box("word").right,
      );
    } else {
      expect(by("note").getAttribute("data-mw-area")).toBe("left span-all");
      await expectTouching(
        () => box("note").right,
        () => box("word").left,
      );
    }
    // The button low in the list: the menu flips above it; scrolled up
    // the list, it has room below and returns there.
    by("open").click();
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right top"));
    await expectTouching(
      () => box("menu").bottom,
      () => box("open").top,
    );
    const cellHeight = cellSize(host).height;
    by("list").scrollTop = 5 * cellHeight;
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right bottom"));
    await expectTouching(
      () => box("menu").top,
      () => box("open").bottom,
    );
    by("list").scrollTop = 0;
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right top"));
  },
};

/** A menu anchored to a button inside a scrolling list follows the
 * button through the scroll (specs/anchor-positioning.md). */
export const AnchorInScroller: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <div data-test="list" class="h-8 overflow-y-auto border border-neutral-500">
          <p>Row 1 of the list.</p>
          <p>Row 2 of the list.</p>
          <button
            data-test="open"
            popovertarget="scrolled-menu"
            popovertargetaction="show"
            class="border px-1"
          >
            menu
          </button>
          ${Array.from({ length: 10 }, (_, i) => html`<p>Row ${i + 3} of the list.</p>`)}
          <div
            id="scrolled-menu"
            data-test="menu"
            popover
            class="border bg-clear px-1 [position-area:right]"
          >
            <p>Beside</p>
            <p>the button</p>
          </div>
        </div>
        <p>The page below the list.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const rowOf = (text: string) => rowsOf(host).findIndex((row) => row.includes(text));
    by("open").click();
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("right span-all"));
    const menuRow = rowOf("Beside");
    expect(menuRow).toBeGreaterThanOrEqual(0);
    const top = (name: string) => by(name).getBoundingClientRect().top;
    const buttonTop = top("open");
    const menuTop = top("menu");
    const cellHeight = cellSize(host).height;
    by("list").scrollTop = 2 * cellHeight;
    // The grid and both light elements two rows up.
    await waitFor(() => expect(rowOf("Beside")).toBe(menuRow - 2));
    await waitFor(() => {
      expect(Math.abs(top("open") - (buttonTop - 2 * cellHeight))).toBeLessThan(1);
      expect(Math.abs(top("menu") - (menuTop - 2 * cellHeight))).toBeLessThan(1);
    });
  },
};

/** The engine's fallbacks are its own: a box that overflows natively
 * (its anchor 1rem from the top, less than its pixel height) fits in
 * cells (four rows), so it stays above — the browser's flip, applied
 * from pixels while the engine reads, is kept out of the read
 * (specs/anchor-positioning.md). */
export const AnchorFallbackIsTheEngines: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="px-1 pt-4">
        <p>
          A <span data-test="word" class="underline [anchor-name:--pinned]">word</span> near the
          top.
        </p>
        <span
          data-test="note"
          class="absolute border px-1 [position-anchor:--pinned] [position-area:top] [position-try-fallbacks:flip-block]"
        >
          above
        </span>
        <p class="mt-4">More of the page.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await waitFor(() => expect(by("note").getAttribute("data-mw-area")).toBe("span-all top"));
    await expectTouching(
      () => by("note").getBoundingClientRect().bottom,
      () => by("word").getBoundingClientRect().top,
    );
  },
};
