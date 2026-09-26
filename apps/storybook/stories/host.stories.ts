import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { wrapLines } from "monowind";
import dejaVuSubset from "../../../assets/fonts/DejaVuSansMono-subset.woff2?url";
import {
  cellSize,
  copyText,
  countLayouts,
  expectGridOnItsCells,
  expectOnItsCells,
  frames,
  gridOf,
  hoverOver,
  pressAt,
  readyHost,
  release,
  testHooks,
  transitionLayouts,
} from "./helpers.ts";

/**
 * The host's own content states: emptied out, it is zero rows with an
 * empty grid (specs/cell-model.md "Host sizing"); its own inline
 * content is the root leaf (specs/host-leaf.md); its own text beside a
 * block child is an anonymous run, the block a flow child
 * (specs/cell-model.md "Inline content"); a host inside another is
 * plain content of the outer one, and a host's own animation, and its
 * own transitions other than `color`'s, are the browser's. Hidden from
 * the sidebar and the story sweep.
 */
const meta: Meta = {
  title: "Test / Host",
  tags: ["!dev", "!golden"],
};
export default meta;

export const Content: StoryObj = {
  render: () => html`
    <mono-wind class="border border-neutral-500 bg-neutral-950 p-1">
      <div>hello world<br />second line</div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = gridOf(host);
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
    await waitFor(() => expect(host.getBoundingClientRect().height).toBe(chrome));

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
    await waitFor(() => {
      expect(rowOf(slot.getBoundingClientRect())).toBe(0);
      expect(rowOf(by("first").getBoundingClientRect())).toBe(2);
      expect(rowOf(by("inner").getBoundingClientRect())).toBe(6);
    });
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
    await waitFor(() => expect(outer).toHaveAttribute("data-mw-ready"));
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      const inner = document.createElement("mono-wind");
      inner.innerHTML = '<p>Inner text.</p><button data-test="inner-button">press</button>';
      outer.appendChild(inner);
      await waitFor(() => expect(gridOf(outer).textContent).toContain("Inner text."));
      // Its interactives are the outer host's to mark, and take the
      // pointer in its grid mode.
      const button = canvasElement.querySelector('[data-test="inner-button"]')!;
      expect(button).toHaveAttribute("data-mw-interactive");
      expect(getComputedStyle(button).pointerEvents).toBe("auto");
      expect(warnings.some((w) => w.includes("inside another <mono-wind> is unsupported"))).toBe(
        true,
      );
      expect(gridOf(inner).textContent).toBe("");
      expect(inner.hasAttribute("data-mw-ready")).toBe(false);
      // Its own pointer-events reach its content, as a plain wrapper's do.
      inner.classList.add("pointer-events-none");
      await waitFor(() => expect(inner.querySelector("p")).toHaveAttribute("data-mw-pointer-none"));
      // An attribute set before it connects asks for a layout the
      // nesting then turns down.
      const selecting = document.createElement("mono-wind");
      selecting.setAttribute("select", "text");
      selecting.innerHTML = "<p>Selecting text.</p>";
      outer.appendChild(selecting);
      await waitFor(() => expect(gridOf(outer).textContent).toContain("Selecting text."));
      await frames();
      expect(gridOf(selecting).textContent).toBe("");
      expect(selecting.hasAttribute("data-mw-ready")).toBe(false);
    } finally {
      console.warn = warn;
    }
  },
};

/** A host straight under a shadow root, with no element parent, is a
 * top-level one: its engine runs. */
export const InShadowRoot: StoryObj = {
  render: () => html`<div data-test="holder"></div>`,
  play: async ({ canvasElement }) => {
    const holder = testHooks(canvasElement)("holder");
    const root = holder.shadowRoot ?? holder.attachShadow({ mode: "open" });
    root.innerHTML = "<mono-wind><p>Shadowed text.</p></mono-wind>";
    const host = root.querySelector("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
    expect(gridOf(host as HTMLElement).textContent).toContain("Shadowed text.");
  },
};

/** A host lays out once as it loads (specs/cell-model.md "Observation"):
 * fonts that settled already, a glyph cache holding nothing, and the
 * sizes the layout itself writes schedule no second one. A resize of
 * its container and of its cell still lay it out again, and content
 * above it growing moves a top-layer element with the grid. */
export const LoadLayouts: StoryObj = {
  render: () => html`<div data-test="page"></div>`,
  play: async ({ canvasElement }) => {
    // The stories' font loaded, which nothing on the page may have used
    // yet: fonts.ready waits on no load that has not started.
    await document.fonts.load('1em "JetBrains Mono"');
    // Text the glyph cache measures nothing of, and borders it measures.
    const loads = ["<p>Plain text.</p>", '<div class="border px-1">A bordered box.</div>'].map(
      (content) => {
        const container = document.createElement("div");
        const host = document.createElement("mono-wind");
        host.innerHTML = content;
        const load = { container, host, layouts: countLayouts(host) };
        container.append(host);
        testHooks(canvasElement)("page").append(container);
        return load;
      },
    );
    for (const { host } of loads) {
      await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
    }
    await frames(10);
    expect(loads.map((load) => load.layouts.count)).toEqual([1, 1]);

    // A narrower container.
    const [text, box] = loads as [(typeof loads)[0], (typeof loads)[0]];
    text.container.style.width = "20rem";
    await waitFor(() => expect(text.layouts.count).toBe(2));
    await frames(10);
    expect(text.layouts.count).toBe(2);
    // A larger cell, which only the cell probe's size reports: a rule
    // the host's observers see no mutation of.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("mono-wind[data-test='larger'] { font-size: 20px }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    try {
      const width = cellSize(text.host).width;
      text.host.dataset.test = "larger";
      await waitFor(() => expect(cellSize(text.host).width).toBeGreaterThan(width));
      await frames(10);
      expect(text.layouts.count).toBe(3);
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet);
    }

    // Content above the host growing moves the grid, and a top-layer
    // element on it moves with it.
    const above = document.createElement("p");
    above.textContent = "Above the host.";
    box.container.prepend(above);
    box.host.insertAdjacentHTML(
      "beforeend",
      '<div data-test="popover" popover class="border px-1">A popover.</div>',
    );
    const popover = box.host.querySelector<HTMLElement>('[data-test="popover"]')!;
    popover.showPopover();
    await waitFor(() => expect(gridOf(box.host).textContent).toContain("A popover."));
    await expectOnItsCells(box.host, popover);
    above.style.height = "5rem";
    await expectOnItsCells(box.host, popover);
    for (const { layouts } of loads) layouts.stop();
  },
};

/** A face that loads once the host has settled: the host lays out
 * again at the face's cell, its grid on its cells (specs/cell-model.md
 * "Observation"), and a story's ready host is that layout's. */
export const LateFont: StoryObj = {
  render: () => html`<div data-test="page"></div>`,
  play: async ({ canvasElement }) => {
    // A family of its own, so the face is new to the page whatever ran before.
    const family = `Late Mono ${Math.random().toString(36).slice(2)}`;
    const host = document.createElement("mono-wind");
    host.style.fontFamily = `"${family}", serif`;
    host.innerHTML =
      '<p>Laid out before its font loads.</p><div class="border px-1">A bordered box.</div>';
    testHooks(canvasElement)("page").append(host);
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
    // Past the load's own layouts, so the swap is all that lays it out.
    await frames(5);
    const fallback = cellSize(host).width;
    const face = new FontFace(family, `url(${dejaVuSubset})`);
    document.fonts.add(face);
    try {
      await face.load();
      await readyHost(canvasElement);
      expect(cellSize(host).width).not.toBe(fallback);
      expectGridOnItsCells(host);
    } finally {
      document.fonts.delete(face);
    }
  },
};

/** A textarea's rows wrap its value at the width the layout gave it
 * (specs/cell-model.md "Form controls"), which its first layout has no
 * snapshot of: loaded with the host, or inserted after, it lays out
 * again at that width, with no other change to prompt it. */
export const TextareaRows: StoryObj = {
  render: () => html`<div data-test="page"></div>`,
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    const value = "one two three four five six seven eight nine ten";
    const host = document.createElement("mono-wind");
    host.innerHTML = `<textarea class="w-12 border">${value}</textarea>`;
    testHooks(canvasElement)("page").append(host);
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
    const rowCounts = (area: HTMLTextAreaElement) => {
      const { width, height } = cellSize(host);
      const style = getComputedStyle(area);
      const content =
        area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return {
        laidOut: Math.round(area.getBoundingClientRect().height / height),
        wrapped: wrapLines(area.value, Math.floor(content / width)).length + 2,
      };
    };
    const [first] = host.querySelectorAll("textarea");
    const expectWrapped = (area: HTMLTextAreaElement) =>
      waitFor(() => {
        const { laidOut, wrapped } = rowCounts(area);
        expect(wrapped).toBeGreaterThan(4);
        expect(laidOut).toBe(wrapped);
      });
    await expectWrapped(first!);
    host.insertAdjacentHTML("beforeend", `<textarea class="w-12 border">${value}</textarea>`);
    await expectWrapped(host.querySelectorAll("textarea")[1]!);
  },
};

/** The host's own keyframe animation is the browser's, moving the
 * grid with the host: the engine samples nothing for it. */
export const Animated: StoryObj = {
  render: () => html`<mono-wind data-test="host" class="animate-pulse"><p>Loading…</p></mono-wind>`,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-test="host"]')!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
    const layouts = countLayouts(host);
    const opacities = new Set<string>();
    const until = performance.now() + 600;
    while (performance.now() < until) {
      opacities.add(getComputedStyle(host).opacity);
      await frames();
    }
    layouts.stop();
    expect(opacities.size, "host frames").toBeGreaterThanOrEqual(3);
    expect(layouts.count, "layouts under the host's animation").toBe(0);
  },
};

/** The host's own opacity, border color and scale transition as its
 * animation would, the browser's alone: nothing lays out from the
 * class change's layout to three frames past the end. Its `color`,
 * which the grid inherits, relays out each frame. */
export const Transitioned: StoryObj = {
  render: () => html`
    <mono-wind class="border border-[rgb(255,0,0)] text-[rgb(255,255,0)] transition duration-500">
      <p>Fading…</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const layouts = countLayouts(host);
    /** The layouts a class change's transition makes after the change's
     * own, to three frames past its end, and the frames it ran. */
    const transition = (from: string, to: string, ended: () => boolean) =>
      transitionLayouts(layouts, () => host.classList.replace(from, to), ended, { settle: 3 });
    host.classList.add("opacity-50", "scale-95");
    const faded = await transition("border-[rgb(255,0,0)]", "border-[rgb(0,0,255)]", () => {
      const style = getComputedStyle(host);
      return (
        style.opacity === "0.5" &&
        style.borderTopColor === "rgb(0, 0, 255)" &&
        style.scale === "0.95"
      );
    });
    expect(faded.frames, "the fade's frames").toBeGreaterThanOrEqual(5);
    expect(faded.during, "layouts during the host's fade").toBe(0);
    const colored = await transition(
      "text-[rgb(255,255,0)]",
      "text-[rgb(0,255,255)]",
      () => getComputedStyle(host).color === "rgb(0, 255, 255)",
    );
    expect(colored.during, "layouts during the host's color change").toBeGreaterThanOrEqual(
      colored.frames / 2,
    );
    layouts.stop();
  },
};

/** Test-only: the host's own move is the browser's, and at its end the
 * grid's place reads afresh — a pointer held still is over the cells
 * that moved under it. */
export const MovedHost: StoryObj = {
  render: () => html`
    <mono-wind class="transition-transform duration-200">
      <div class="flex">
        <div data-test="first" class="w-12">first</div>
        <div data-test="second" class="w-12">second</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    hoverOver(by("first"));
    await waitFor(() => expect(by("first")).toHaveAttribute("data-mw-hover"));
    // The second item slides under the pointer.
    host.style.translate = `-${by("first").getBoundingClientRect().width}px`;
    await waitFor(() => expect(host.getAnimations()).toHaveLength(0));
    await frames(2);
    expect(by("first")).not.toHaveAttribute("data-mw-hover");
    expect(by("second")).toHaveAttribute("data-mw-hover");
  },
};
