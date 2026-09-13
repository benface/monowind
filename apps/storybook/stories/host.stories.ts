import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { copyText, pressAt, release } from "./helpers.ts";

/**
 * The host's own content states: emptied out, it is zero rows with an
 * empty grid (specs/cell-model.md "Host sizing"); its own inline
 * content is the root leaf (specs/host-leaf.md); its own text beside a
 * block child is an anonymous run, the block a flow child
 * (specs/cell-model.md "Inline content"); a host inside another is
 * plain content of the outer one, and a host's own animation is the
 * browser's. Hidden from the sidebar and the story sweep.
 */
const meta: Meta = {
  title: "Test / Host",
  tags: ["!dev", "!golden"],
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

    // Mixed with a block child: the host is a container, its own text
    // an anonymous run locked like the root leaf's, the child in the
    // browser's flow beneath it.
    host.innerHTML = 'foo bar<div data-test="block">baz</div>';
    await waitFor(() =>
      expect(grid.textContent!.split("\n").map((row) => row.trim())).toEqual(["foo bar", "baz"]),
    );
    expect(host).toHaveAttribute("data-mw-leaf");
    expect(style.webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
    expect(by("block")).toHaveAttribute("data-mw-flow");
    expect(by("block")).not.toHaveAttribute("data-mw-laid-out");
    // A triple-click on the run selects the run alone.
    expect(pressAt(grid, cell(1, 0), 3)).toBe(false);
    expect(selection()).toBe("foo bar");
    release();
    document.getSelection()!.removeAllRanges();
    // Flow children keep their top margins inside their formatting
    // context, as the engine placed them: the slot holds the host's
    // first child's, a flow child its own first child's.
    host.innerHTML =
      '<div data-test="first" class="mt-2">first</div>foo' +
      '<div data-test="outer" class="mt-1"><div data-test="inner" class="mt-1">inner</div>x</div>';
    await waitFor(() =>
      expect(grid.textContent!.split("\n").map((row) => row.trim())).toEqual([
        "",
        "",
        "first",
        "foo",
        "",
        "",
        "inner",
        "x",
      ]),
    );
    const contentTop = cell(0, 0).y - cellHeight / 2;
    const rowOf = (rect: DOMRect) => Math.round((rect.top - contentTop) / cellHeight);
    expect(rowOf(slot.getBoundingClientRect())).toBe(0);
    expect(rowOf(by("first").getBoundingClientRect())).toBe(2);
    expect(rowOf(by("inner").getBoundingClientRect())).toBe(6);
    // The host's runs take the root leaf's style: the host's line-height
    // is the cell, so a run's lines are contiguous rows.
    host.style.lineHeight = "2";
    host.innerHTML = 'foo<br />bar<div data-test="block">baz</div>';
    await waitFor(() =>
      expect(grid.textContent!.split("\n").map((row) => row.trim())).toEqual(["foo", "bar", "baz"]),
    );
    const tallCell = parseFloat(style.getPropertyValue("--mw-ch"));
    expect(Math.round((by("block").getBoundingClientRect().top - contentTop) / tallCell)).toBe(2);
    host.style.lineHeight = "";

    // Back to element children only: positioned as ever.
    host.innerHTML = '<div data-test="clean">clean</div>';
    await waitFor(() => expect(by("clean")).toHaveAttribute("data-mw-laid-out"));
  },
};

/** A host inside another is unsupported: it warns once, its engine
 * stays off, and the outer host lays it out as plain content. */
export const Nested: StoryObj = {
  render: () => html`<mono-wind data-test="outer"><p>Outer text.</p></mono-wind>`,
  play: async ({ canvasElement }) => {
    const outer = canvasElement.querySelector<HTMLElement>('[data-test="outer"]')!;
    await waitFor(() => expect(outer).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      const inner = document.createElement("mono-wind");
      inner.innerHTML = "<p>Inner text.</p>";
      outer.appendChild(inner);
      await waitFor(
        () =>
          expect(outer.shadowRoot!.getElementById("grid")!.textContent).toContain("Inner text."),
        { timeout: 10_000 },
      );
      expect(warnings.some((w) => w.includes("inside another <mono-wind> is unsupported"))).toBe(
        true,
      );
      expect(inner.shadowRoot!.getElementById("grid")!.textContent).toBe("");
      expect(inner.hasAttribute("data-mw-ready")).toBe(false);
    } finally {
      console.warn = warn;
    }
  },
};

/** The host's own keyframe animation is the browser's, moving the
 * grid with the host: the engine samples nothing for it. */
export const Animated: StoryObj = {
  render: () => html`<mono-wind data-test="host" class="animate-pulse"><p>Loading…</p></mono-wind>`,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-test="host"]')!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    let layouts = 0;
    const observer = new MutationObserver(() => layouts++);
    observer.observe(host, { attributes: true, attributeFilter: ["measuring"] });
    const opacities = new Set<string>();
    const until = performance.now() + 600;
    while (performance.now() < until) {
      opacities.add(getComputedStyle(host).opacity);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    observer.disconnect();
    expect(opacities.size, "host frames").toBeGreaterThanOrEqual(3);
    expect(layouts, "layouts under the host's animation").toBeLessThanOrEqual(1);
  },
};
