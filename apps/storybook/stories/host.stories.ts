import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { copyText, pressAt, release } from "./helpers.ts";

/**
 * The host's own content states: emptied out, it is zero rows with an
 * empty grid (specs/cell-model.md "Host sizing"); its own inline
 * content is the root leaf (specs/host-leaf.md); direct text next to a
 * block child is hidden through the shadow slot while laid-out
 * children stay visible (deviation 7). Hidden from the sidebar and the
 * story sweep.
 */
const meta: Meta = {
  title: "Test / Host",
  tags: ["!dev"],
};
export default meta;

export const Content: StoryObj = {
  render: () => html`
    <mono-wind data-test="host" class="border border-neutral-500 bg-neutral-950 p-1">
      <div>hello world<br />second line</div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-test="host"]')!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const slot = host.shadowRoot!.querySelector("slot")!;
    const by = (name: string) => host.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const gridHeight = () => grid.getBoundingClientRect().height;
    const selection = () => document.getSelection()!.toString().trim();
    const style = getComputedStyle(host);
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    expect(gridHeight()).toBeGreaterThan(0);
    expect(host.getBoundingClientRect().height).toBeGreaterThan(chrome);

    // Emptied out: the grid is cleared (no stale box carrying the host's
    // background) and the host is its padding and border.
    host.replaceChildren();
    await waitFor(() => expect(gridHeight()).toBe(0));
    expect(grid.textContent).toBe("");
    expect(host.getBoundingClientRect().height).toBe(chrome);

    // The host's own inline content is the root leaf.
    host.innerHTML = 'foo <b data-test="bold" class="text-red-400">bar</b> baz';
    await waitFor(() => expect(grid.textContent).toContain("foo bar baz"));
    expect(host).toHaveAttribute("data-mw-leaf");
    expect(host).not.toHaveAttribute("data-mw-dropped-text");
    // The invisibility lock covers the host itself; the grid keeps its
    // own ink through the shadow reset.
    expect(style.webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
    const red = grid.querySelector("span")!;
    expect(getComputedStyle(red).webkitTextFillColor).toBe(getComputedStyle(red).color);
    // A range over the host's own text copies through the engine.
    const first = host.firstChild as Text;
    const last = by("bold").nextSibling as Text;
    document.getSelection()!.setBaseAndExtent(first, 0, last, last.length);
    expect(copyText(host)).toBe("foo bar baz");
    document.getSelection()!.removeAllRanges();
    // The gestures reach the root leaf: triple-click selects the run,
    // double-click a word.
    const cellWidth = parseFloat(style.getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(style.getPropertyValue("--mw-ch"));
    const cell = (col: number, row: number) => {
      const rect = host.getBoundingClientRect();
      const x = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const y = rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      return { x: x + (col + 0.5) * cellWidth, y: y + (row + 0.5) * cellHeight };
    };
    expect(pressAt(grid, cell(1, 0), 3)).toBe(false);
    expect(selection()).toBe("foo bar baz");
    expect(host).toHaveAttribute("data-mw-semantic-selection");
    expect(copyText(host)).toBe("foo bar baz");
    release();
    expect(pressAt(grid, cell(5, 0), 2)).toBe(false);
    expect(selection()).toBe("bar");
    release();
    document.getSelection()!.removeAllRanges();
    // The host's own typography reaches the flags the companion keys on.
    host.style.whiteSpace = "nowrap";
    host.style.textIndent = "8px";
    await waitFor(() => expect(host).toHaveAttribute("data-mw-nowrap"));
    expect(host.style.getPropertyValue("--mw-ti")).toBe("2");
    expect(grid.textContent!.startsWith("  foo")).toBe(true);
    host.style.whiteSpace = "";
    host.style.textIndent = "";
    await waitFor(() => expect(host).not.toHaveAttribute("data-mw-nowrap"));
    // Truncation on the host itself: the clip reaches the root leaf.
    host.classList.add("w-24", "truncate");
    await waitFor(() => expect(grid.textContent!.trimEnd()).toMatch(/^foo ba.*…$/));
    host.classList.remove("w-24", "truncate");
    await waitFor(() => expect(grid.textContent).toContain("foo bar baz"));

    // Mixed with a block child: the child lays out and shows, the text
    // is dropped and hidden.
    host.innerHTML = 'foo<div data-test="block">bar</div>';
    await waitFor(() => expect(grid.textContent!.trim()).toBe("bar"));
    expect(host).not.toHaveAttribute("data-mw-leaf");
    expect(host).toHaveAttribute("data-mw-dropped-text");
    expect(getComputedStyle(slot).visibility).toBe("hidden");
    expect(getComputedStyle(by("block")).visibility).toBe("visible");

    // Back to clean content: the flag clears.
    host.innerHTML = "<div>clean</div>";
    await waitFor(() => expect(host).not.toHaveAttribute("data-mw-dropped-text"));
    expect(getComputedStyle(slot).visibility).toBe("visible");
  },
};
