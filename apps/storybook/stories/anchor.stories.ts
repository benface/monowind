import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expectOnItsCells, readyHost, rowsOf } from "./helpers.ts";

/**
 * Anchor positioning (specs/anchor-positioning.md): a box placed
 * against another in cells — a menu under its button, a tooltip
 * above its word, a submenu beside its item — flipped where the host
 * leaves no room, following its anchor through a scroll, the light
 * element on the same cells.
 */
const meta: Meta = {
  title: "Features / Anchor Positioning",
};
export default meta;

/**
 * Anchored boxes (specs/anchor-positioning.md): a popover menu under
 * its button, anchored to it by `popovertarget` alone and flipped
 * above when the host's edge leaves no room; a tooltip above a word,
 * a submenu beside its item — placed in cells against the anchor's
 * box, the light element on the same cells.
 */
export const Placement: StoryObj = {
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
          class="border bg-(--mw-bg) px-1 text-(--mw-fg) [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
        >
          <p>Cut</p>
          <p>Copy</p>
          <p data-test="paste" class="[anchor-name:--paste]">Paste &gt;</p>
        </div>
        <div
          data-test="submenu"
          class="absolute ml-2 border bg-(--mw-bg) px-1 text-(--mw-fg) [position-anchor:--paste] [position-area:right_span-bottom]"
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
          class="border bg-(--mw-bg) px-1 text-(--mw-fg) [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
        >
          <p>Flipped</p>
          <p>above</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const box = (name: string) => by(name).getBoundingClientRect();
    const touching = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1);
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    // The tooltip's box sits on the row above the word, centered on it.
    await waitFor(() => expect(by("tooltip").getAttribute("data-mw-area")).toBe("span-all top"));
    touching(box("tooltip").bottom, box("word").top);
    expect(box("tooltip").left).toBeLessThan(box("word").left);
    expect(box("tooltip").right).toBeGreaterThan(box("word").right);
    // The menu opens under its button, left edges together, as its
    // invoker's anchor; its submenu beside the item, top edges together.
    by("open").click();
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right bottom"), {
      timeout: 10_000,
    });
    touching(box("menu").left, box("open").left);
    touching(box("menu").top, box("open").bottom);
    expectOnItsCells(host, by("menu"));
    await waitFor(() =>
      expect(by("submenu").getAttribute("data-mw-area")).toBe("right span-bottom"),
    );
    touching(box("submenu").top, box("paste").top);
    touching(box("submenu").left - 2 * cellWidth, box("paste").right);
    // No room below the low button: the menu flips above it.
    by("open-low").click();
    await waitFor(() => expect(by("low").getAttribute("data-mw-area")).toBe("span-right top"), {
      timeout: 10_000,
    });
    touching(box("low").bottom, box("open-low").top);
  },
};

/**
 * The fallbacks, live: a note beside a word, one line by `text-nowrap`,
 * flips to its left when the pane is too narrow for it (resize the
 * pane); a menu in a scrolling list follows its button and flips above
 * it where the host's bottom edge leaves no room below (scroll the
 * list).
 */
export const Fallbacks: StoryObj = {
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
            class="border bg-(--mw-bg) px-1 text-(--mw-fg) [position-area:bottom_span-right] [position-try-fallbacks:flip-block]"
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
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const box = (name: string) => by(name).getBoundingClientRect();
    const touching = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1);
    // The note sits beside the word on whichever side has the room.
    await waitFor(() => expect(by("note").getAttribute("data-mw-area")).toMatch(/span-all$/));
    if (by("note").getAttribute("data-mw-area") === "right span-all") {
      touching(box("note").left, box("word").right);
    } else {
      expect(by("note").getAttribute("data-mw-area")).toBe("left span-all");
      touching(box("note").right, box("word").left);
    }
    // The button low in the list: the menu flips above it; scrolled up
    // the list, it has room below and returns there.
    by("open").click();
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right top"), {
      timeout: 10_000,
    });
    touching(box("menu").bottom, box("open").top);
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    by("list").scrollTop = 5 * cellHeight;
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right bottom"), {
      timeout: 10_000,
    });
    touching(box("menu").top, box("open").bottom);
    by("list").scrollTop = 0;
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("span-right top"), {
      timeout: 10_000,
    });
  },
};

/** A menu anchored to a button inside a scrolling list follows the
 * button through the scroll (specs/anchor-positioning.md). */
export const InScroller: StoryObj = {
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
            class="border bg-(--mw-bg) px-1 text-(--mw-fg) [position-area:right]"
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
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const rowOf = (text: string) => rowsOf(host).findIndex((row) => row.includes(text));
    by("open").click();
    await waitFor(() => expect(by("menu").getAttribute("data-mw-area")).toBe("right span-all"), {
      timeout: 10_000,
    });
    const menuRow = rowOf("Beside");
    expect(menuRow).toBeGreaterThanOrEqual(0);
    const top = (name: string) => by(name).getBoundingClientRect().top;
    const buttonTop = top("open");
    const menuTop = top("menu");
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    by("list").scrollTop = 2 * cellHeight;
    // The grid and both light elements two rows up.
    await waitFor(() => expect(rowOf("Beside")).toBe(menuRow - 2), { timeout: 10_000 });
    await waitFor(() => {
      expect(Math.abs(top("open") - (buttonTop - 2 * cellHeight))).toBeLessThan(1);
      expect(Math.abs(top("menu") - (menuTop - 2 * cellHeight))).toBeLessThan(1);
    });
  },
};
