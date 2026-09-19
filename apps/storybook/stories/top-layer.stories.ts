import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  cellSize,
  dragTo,
  expectOnItsCells,
  gridOf,
  paintedSpan,
  pressAt,
  readyHost,
  release,
  rowsOf,
  testHooks,
} from "./helpers.ts";
import type { Point } from "./helpers.ts";

/**
 * The top layer (specs/top-layer.md): a popover or a modal dialog
 * paints last, whole, above everything and outside the scroller it
 * opened from, its backdrop tinting the page beneath; the light
 * element sits where the grid shows it, so native focus and clicks
 * land there.
 */
const meta: Meta = {
  title: "Features / Top Layer",
};
export default meta;

/**
 * A popover opened from inside a scrolling list: it paints whole,
 * above the list's later rows and the paragraph after it, centered in
 * the host as the UA centers it in the viewport, and its light element
 * sits on those cells.
 */
export const Popover: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <div data-test="list" class="h-6 overflow-y-auto border border-neutral-500">
          <p>The first row of a scrolling list.</p>
          <button data-test="open" popovertarget="top-layer-menu" class="border px-1">
            open the menu
          </button>
          <div id="top-layer-menu" data-test="menu" popover class="border bg-clear px-1">
            <p>Menu item one</p>
            <p>Menu item two</p>
            <p>Menu item three</p>
          </div>
          <p>The third row of the list.</p>
          <p>The fourth row of the list.</p>
          <p>The fifth row of the list.</p>
        </div>
        <p data-test="after">Afterwards the page goes on below the list, under the menu.</p>
        <p>And on, past the list's edge, which the menu crosses.</p>
        <p>And on.</p>
        <p>And on.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    by("open").click();
    await waitFor(() => expect(gridOf(host).textContent).toContain("Menu item three"));
    const rows = rowsOf(host);
    const first = rows.findIndex((row) => row.includes("Menu item one"));
    // Whole, across the list's bottom edge, over what lies beneath.
    expect(rows[first + 1]).toContain("Menu item two");
    expect(rows[first + 2]).toContain("Menu item three");
    const edge = rows.findIndex((row) => row.startsWith(" └"));
    expect(first).toBeLessThan(edge);
    expect(first + 3).toBeGreaterThan(edge);
    await expectOnItsCells(host, by("menu"));
    by("open").click();
    await waitFor(() => expect(gridOf(host).textContent).not.toContain("Menu item"));
    // Left open, for the golden and the eye.
    by("open").click();
    await waitFor(() => expect(gridOf(host).textContent).toContain("Menu item three"));
  },
};

/**
 * A modal dialog: centered in the host, its backdrop a box the browser
 * draws under it — `backdrop:bg-black/50` dims the page, a
 * `backdrop:backdrop-blur-*` would blur it — with focus inside and the
 * page inert until it closes.
 */
export const Dialog: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p data-test="page">
          The page, with a button to
          <button
            data-test="button"
            class="border px-1 align-middle text-cyan-300"
            @click=${(event: Event) =>
              (event.target as Element).closest("mono-wind")!.querySelector("dialog")!.showModal()}
          >
            open the dialog
          </button>
          and text that a modal dialog dims.
        </p>
        <p>More of the page, in the plain text color.</p>
        <p>And a third line, to make the host taller than the dialog.</p>
        <p>And a fourth.</p>
        <dialog data-test="dialog" class="border p-1 backdrop:bg-black/50">
          <p>A modal dialog, centered.</p>
          <form method="dialog">
            <button data-test="close" class="border px-1" autofocus>close</button>
          </form>
        </dialog>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const dialog = by("dialog") as HTMLDialogElement;
    // The dialog's cells live in a box of their own, in the layers.
    dialog.showModal();
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("A modal dialog"));
    // Centered: its cells sit inside the host on both axes.
    const rows = rowsOf(host);
    const x = parseFloat(dialog.style.getPropertyValue("--mw-x"));
    const y = parseFloat(dialog.style.getPropertyValue("--mw-y"));
    const width = parseFloat(dialog.style.getPropertyValue("--mw-w"));
    const height = parseFloat(dialog.style.getPropertyValue("--mw-h"));
    expect(Math.abs(x - Math.floor((rows[0]!.length - width) / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(y - Math.floor((rows.length - height) / 2))).toBeLessThanOrEqual(1);
    await expectOnItsCells(host, dialog);
    // The dialog's cells are in a box of their own above a backdrop
    // box over the whole grid; the page's cells are untouched.
    const layers = host.shadowRoot!.getElementById("layers")!;
    const backdropBox = layers.querySelector<HTMLElement>(".backdrop")!;
    expect(backdropBox.nextElementSibling!.textContent).toContain("A modal dialog");
    // The authored black at half alpha; the native backdrop is locked
    // transparent, so the page dims once.
    expect(backdropBox.style.backgroundColor).toMatch(/0\.5\)$/);
    expect(getComputedStyle(dialog, "::backdrop").backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const grid = gridOf(host).getBoundingClientRect();
    const box = backdropBox.getBoundingClientRect();
    expect(Math.abs(box.width - grid.width)).toBeLessThan(1);
    expect(Math.abs(box.height - grid.height)).toBeLessThan(1);
    expect(paintedSpan(host, "The page")?.style.backgroundColor ?? "").toBe("");
    // Focus went inside; the page is blocked, so grid mode falls back
    // to the dialog's own light DOM: its button hit-tests natively and
    // its text selects.
    expect(document.activeElement).toBe(by("close"));
    const close = by("close").getBoundingClientRect();
    expect(
      document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2),
    ).toBe(by("close"));
    expect(getComputedStyle(dialog.querySelector("p")!).userSelect).toBe("text");
    // A drag over the dialog's text selects it, through the engine as
    // in text mode.
    const text = dialog.querySelector("p")!.firstChild as Text;
    const middle = (index: number): Point => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    expect(pressAt(dialog, middle(2), 1)).toBe(false);
    dragTo(dialog, middle(12));
    await waitFor(() => expect(document.getSelection()!.toString()).toBe("modal dialo"));
    release();
    document.getSelection()!.removeAllRanges();
    // The close button submits its dialog form.
    by("close").click();
    await waitFor(() => expect(layers.querySelector(".backdrop")).toBeNull());
    // The page's button opens it again; left open, for the golden and
    // the eye.
    by("button").click();
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("A modal dialog"));
  },
};

/** A popover opened from inside another stacks above it. */
export const Nested: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>A page of text under two popovers.</p>
        <p>A second line of it.</p>
        <p>A third line of it.</p>
        <button data-test="open" popovertarget="top-layer-first" class="border px-1">first</button>
        <div id="top-layer-first" data-test="first" popover class="border px-1">
          First popover
          <button data-test="more" popovertarget="top-layer-second" class="border px-1">
            more
          </button>
        </div>
        <div id="top-layer-second" data-test="second" popover class="border px-1">
          Second popover, wider than the first
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    by("open").click();
    await waitFor(() => expect(gridOf(host).textContent).toContain("First popover"));
    by("more").click();
    await waitFor(() => expect(gridOf(host).textContent).toContain("Second popover"));
    // Both centered on the same row, the second covers the first.
    expect(gridOf(host).textContent).not.toContain("First popover");
    expect(by("first").matches(":popover-open")).toBe(true);
  },
};

/**
 * Transitions on a popover: an enter from `@starting-style` is sampled
 * mid-flight; an exit through a discrete `display` transition keeps
 * painting to its end where the browser runs it.
 */
export const Transitions: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>A page of text under a fading popover.</p>
        <p>A second line of it.</p>
        <div
          data-test="pop"
          popover
          class="border px-1 transition-all transition-discrete duration-500 not-[:popover-open]:opacity-0 starting:opacity-0"
        >
          Fading popover
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const pop = canvasElement.querySelector<HTMLElement>('[data-test="pop"]')!;
    const opacity = () => paintedSpan(host, "Fading")?.style.opacity;
    pop.showPopover();
    const seen = new Set<string | undefined>();
    const until = performance.now() + 700;
    while (performance.now() < until) {
      seen.add(opacity());
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // Mid-flight values, then the landed one.
    expect(
      [...seen].filter((value) => value !== undefined && value !== "").length,
    ).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(opacity()).toBe(""));
    pop.hidePopover();
    if (navigator.userAgent.includes("Chrome/")) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(gridOf(host).textContent).toContain("Fading popover");
      expect(parseFloat(opacity()!)).toBeLessThan(1);
    }
    await waitFor(() => expect(gridOf(host).textContent).not.toContain("Fading popover"));
  },
};

/** A fixed box inside a scroller stays at the host's cells as the
 * scroller scrolls, its light element with it (specs/positioning.md). */
export const Fixed: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <div data-test="list" class="h-6 overflow-y-auto border border-neutral-500">
          ${Array.from({ length: 12 }, (_, i) => html`<p>Row ${i + 1} of the list.</p>`)}
          <div data-test="fixed" class="fixed top-1 left-30 border px-1">fixed box</div>
        </div>
        <p>The page below the list.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const rowOf = (text: string) => rowsOf(host).findIndex((row) => row.includes(text));
    await waitFor(() => expect(rowOf("fixed box")).toBeGreaterThanOrEqual(0));
    const row = rowOf("fixed box");
    const top = by("fixed").getBoundingClientRect().top;
    expect(rowOf("Row 1 of")).toBeGreaterThanOrEqual(0);
    by("list").scrollTop = 3 * cellSize(host).height;
    await waitFor(() => expect(rowOf("Row 1 of")).toBe(-1));
    expect(rowOf("fixed box")).toBe(row);
    await waitFor(() =>
      expect(Math.abs(by("fixed").getBoundingClientRect().top - top)).toBeLessThan(1),
    );
  },
};

/** A text-mode drag over a popover selects its text, its light
 * element sitting where the grid shows it. */
export const Selection: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind select="text">
      <div class="p-1">
        <p>A page of text under a popover.</p>
        <p>A second line of it.</p>
        <p>A third line of it.</p>
        <div data-test="pop" popover class="border px-1">selectable popover text</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const pop = canvasElement.querySelector<HTMLElement>('[data-test="pop"]')!;
    pop.showPopover();
    await waitFor(() => expect(gridOf(host).textContent).toContain("selectable"));
    const middle = (index: number): Point => {
      const text = pop.firstChild as Text;
      const start = text.data.search(/\S/) + index;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    expect(pressAt(pop, middle(2), 1)).toBe(false);
    dragTo(pop, middle(9));
    await waitFor(() => expect(document.getSelection()!.toString()).toBe("lectable"));
    release();
    document.getSelection()!.removeAllRanges();
  },
};
