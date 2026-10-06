import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { wrapLines } from "monowind";
import dejaVuSubset from "../../../assets/fonts/DejaVuSansMono-subset.woff2?url";
import card from "./assets/card.png";
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
  rowsOf,
  STEPPED_DURATION,
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

/** A host inside another, in no native region of it, is unsupported:
 * it warns once, its engine stays off, and the outer host lays it out
 * as plain content (specs/native-regions.md "Nesting"). */
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
      expect(warnings.some((w) => w.includes("in no mw-native region of it, is unsupported"))).toBe(
        true,
      );
      expect(inner).toHaveAttribute("data-mw-nested");
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
    host.style.transitionDuration = STEPPED_DURATION;
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

/** Test-only: an element whose `style` a page's script rewrites, the
 * engine's variables gone with it, takes them again at the layout the
 * rewrite starts — and so does one restyled while out of the host, as
 * it comes back. */
export const RestyledElement: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex gap-2">
        <div class="w-12 border px-1">first</div>
        <div data-test="second" class="w-12 border px-1">second</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const second = testHooks(canvasElement)("second");
    const x = () => second.style.getPropertyValue("--mw-x");
    const laidOut = x();
    expect(laidOut).not.toBe("");
    second.setAttribute("style", "color: red");
    await waitFor(() => expect(x()).toBe(laidOut));
    const parent = second.parentElement!;
    second.remove();
    await frames(2);
    second.removeAttribute("style");
    parent.append(second);
    await waitFor(() => expect(x()).toBe(laidOut));
  },
};

const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => html`<p>line ${i + 1}</p>`);

/** A host's height is CSS's (specs/cell-model.md "Host sizing"): as
 * tall as a native twin of its classes in the same setting, its root
 * laid out against the rows that fit where the height is its own, its
 * content's rows where it has none, one layout per change. */
export const OwnHeight: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-4">
      <div class="flex items-start gap-2">
        <mono-wind data-test="fixed" class="h-40 w-40">
          <div class="flex h-full flex-col">
            <div>top</div>
            <div data-test="fill" class="flex-1">fill</div>
          </div>
        </mono-wind>
        <div data-test="fixed-twin" class="h-40 w-40"></div>
      </div>
      <div class="flex items-start gap-2">
        <div class="w-40" style="height: 203px">
          <mono-wind data-test="full" class="h-full">full</mono-wind>
        </div>
        <div class="w-40" style="height: 203px">
          <div data-test="full-twin" class="h-full"></div>
        </div>
      </div>
      <div class="flex gap-2">
        <div class="flex h-50 w-40"><mono-wind data-test="row" class="flex-1">row</mono-wind></div>
        <div class="flex h-50 w-40"><div data-test="row-twin" class="flex-1"></div></div>
      </div>
      <div class="flex gap-2">
        <div class="flex h-50 w-40 flex-col">
          <div class="h-10"></div>
          <mono-wind data-test="column" class="flex-1">column</mono-wind>
        </div>
        <div class="flex h-50 w-40 flex-col">
          <div class="h-10"></div>
          <div data-test="column-twin" class="flex-1"></div>
        </div>
      </div>
      <mono-wind data-test="ratio" class="aspect-video w-80">ratio</mono-wind>
      <mono-wind data-test="floor" class="min-h-40 w-40">floor</mono-wind>
      <mono-wind data-test="past-floor" class="min-h-10 w-40">${lines(6)}</mono-wind>
      <mono-wind data-test="cap" class="max-h-10 w-40">${lines(6)}</mono-wind>
      <mono-wind data-test="content" class="w-40">${lines(3)}</mono-wind>
      <mono-wind data-test="empty" class="w-40"></mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const hooks = testHooks(canvasElement);
    const host = await readyHost(canvasElement);
    const cell = cellSize(host);
    await frames(2);
    const height = (name: string) => hooks(name).getBoundingClientRect().height;
    const cells = (el: HTMLElement, name: string) => Number(el.style.getPropertyValue(name));
    for (const name of ["fixed", "full", "row", "column"]) {
      expect(height(name), name).toBeCloseTo(height(`${name}-twin`), 1);
    }
    // The root's rows, the height's that fit: the column's second item fills them.
    expect(cells(hooks("fill"), "--mw-h")).toBe(Math.floor(160 / cell.height) - 1);
    const ratio = hooks("ratio").getBoundingClientRect();
    expect(ratio.height).toBeCloseTo((ratio.width * 9) / 16, 0);
    expect(height("floor")).toBeCloseTo(160, 1);
    expect(height("past-floor")).toBeCloseTo(6 * cell.height, 1);
    expect(height("cap")).toBeCloseTo(40, 1);
    expect(height("content")).toBeCloseTo(3 * cell.height, 1);
    expect(height("empty")).toBe(0);

    // A height of its own and back, a layout each; content appended to
    // an empty host sizes it.
    const content = hooks("content");
    const layouts = countLayouts(content);
    content.classList.add("h-40");
    await waitFor(() => expect(layouts.count).toBe(1));
    expect(height("content")).toBeCloseTo(160, 1);
    content.classList.remove("h-40");
    await waitFor(() => expect(layouts.count).toBe(2));
    expect(height("content")).toBeCloseTo(3 * cell.height, 1);
    await frames(5);
    expect(layouts.count).toBe(2);
    layouts.stop();
    const empty = hooks("empty");
    empty.innerHTML = "<p>one</p><p>two</p>";
    await waitFor(() => expect(height("empty")).toBeCloseTo(2 * cell.height, 1));

    // Content growing past a floor, and back under it: the first layout
    // against the floor, one more by the content, which the host's
    // resize reports.
    const floor = hooks("floor");
    const floorLayouts = countLayouts(floor);
    const past = Math.ceil(160 / cell.height) + 2;
    floor.innerHTML = Array.from({ length: past }, (_, i) => `<p>line ${i + 1}</p>`).join("");
    await waitFor(() => expect(height("floor")).toBeCloseTo(past * cell.height, 1));
    await frames(5);
    expect(floorLayouts.count).toBe(2);
    floor.innerHTML = "floor";
    await waitFor(() => expect(height("floor")).toBeCloseTo(160, 1));
    await frames(5);
    expect(floorLayouts.count).toBe(4);
    floorLayouts.stop();
  },
};

/** A host whose width is its content's is as wide as its columns and
 * its chrome (specs/cell-model.md "Host sizing"): `w-fit`,
 * `inline-block`, `float-left`, and a flex row's item, whose sibling
 * starts past its right edge, the row narrowed laying it out narrower;
 * and a host filling its `flex-1` column to the pixel narrows as the
 * aside beside it grows. */
export const OwnWidth: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-4">
      <mono-wind data-test="fit" class="w-fit border px-1">${lines(2)}</mono-wind>
      <div><mono-wind data-test="inline-block" class="inline-block">${lines(2)}</mono-wind></div>
      <div class="flow-root">
        <mono-wind data-test="float" class="float-left">${lines(2)}</mono-wind>
      </div>
      <div data-test="row" class="flex w-160">
        <mono-wind data-test="item">A line of text in a flex row's item.</mono-wind>
        <div data-test="sibling">sibling</div>
      </div>
      <div data-test="shell" class="flex w-160">
        <div data-test="aside" class="w-40 shrink-0"></div>
        <div class="flex-1">
          <mono-wind data-test="column">A line of text in a flex-1 column.</mono-wind>
        </div>
      </div>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const hooks = testHooks(canvasElement);
    await readyHost(canvasElement);
    await frames(2);
    const box = (name: string) => hooks(name).getBoundingClientRect();
    // The width cap, the columns laid out and the chrome, is the width.
    const capped = (name: string) => {
      const cap = parseFloat(hooks(name).style.getPropertyValue("--mw-host-w"));
      expect(cap, name).toBeGreaterThan(0);
      expect(box(name).width, name).toBeCloseTo(cap, 1);
    };
    for (const name of ["fit", "inline-block", "float", "item"]) capped(name);
    expect(rowsOf(hooks("item"))[0]).toContain("A line of text in a flex row's item.");
    expect(box("sibling").left).toBeGreaterThanOrEqual(box("item").right - 0.5);
    const layouts = countLayouts(hooks("item"));
    hooks("row").classList.replace("w-160", "w-40");
    await waitFor(() => expect(layouts.count).toBeGreaterThan(0));
    await waitFor(() => {
      capped("item");
      expect(box("sibling").left).toBeGreaterThanOrEqual(box("item").right - 0.5);
      expect(box("sibling").right).toBeLessThanOrEqual(box("row").right + 0.5);
    });
    layouts.stop();
    // Room for forty whole columns, which the host fills to the pixel,
    // its layout settled before the aside grows.
    const cell = cellSize(hooks("column")).width;
    hooks("shell").style.width = `${60 * cell}px`;
    hooks("aside").style.width = `${20 * cell}px`;
    await waitFor(() => expect(box("column").width).toBeCloseTo(40 * cell, 1));
    await frames(2);
    // An inline width: a new utility's stylesheet would lay every host out.
    hooks("aside").style.width = `${50 * cell}px`;
    await waitFor(() => {
      expect(box("column").right).toBeLessThanOrEqual(box("shell").right + 0.5);
      expect(rowsOf(hooks("column")).filter((row) => row.trim()).length).toBeGreaterThan(1);
    });
  },
};

/** A host whose width is its content's takes the widths the engine
 * lays that content out at (specs/cell-model.md "Host sizing"), where
 * the browser's own run on the page's px: a `w-24` box is 24 columns,
 * a paragraph's `px-2` two cells a side, an inline box's `w-8` eight
 * columns in its line, an image's `w-16` sixteen. A flex row's item
 * takes its content's max-content width, and, its row squeezed,
 * narrows to its min-content width and no further. */
export const OwnWidthInCells: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-4">
      <mono-wind data-test="fit" class="w-fit">
        <div data-test="box" class="w-24 border">box</div>
      </mono-wind>
      <mono-wind data-test="inline" class="w-fit">
        a <span class="inline-block w-8 border">box</span> b
      </mono-wind>
      <div data-test="row" class="flex w-250">
        <mono-wind data-test="item"><p class="px-2">padded words</p></mono-wind>
        <div class="flex-1">sibling</div>
      </div>
      <div class="flex">
        <mono-wind data-test="pictured">
          <img data-test="picture" src=${card} alt="A test card" class="w-16" />
        </mono-wind>
      </div>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const hooks = testHooks(canvasElement);
    await readyHost(canvasElement);
    const cell = cellSize(hooks("fit")).width;
    const columns = (name: string) => hooks(name).getBoundingClientRect().width / cell;
    await waitFor(() => {
      expect(columns("fit")).toBeCloseTo(24, 1);
      expect(columns("box")).toBeCloseTo(24, 1);
      // "a ", the 8 columns of its inline box, and " b".
      expect(columns("inline")).toBeCloseTo(12, 1);
      // "padded words" and two cells a side.
      expect(columns("item")).toBeCloseTo(16, 1);
      expect(columns("pictured")).toBeCloseTo(16, 1);
      expect(columns("picture")).toBeCloseTo(16, 1);
    });
    expect(rowsOf(hooks("item"))[0]).toContain("padded words");
    // Squeezed: "padded", the longest word, and its padding.
    hooks("row").style.width = `${4 * cell}px`;
    await waitFor(() => {
      expect(columns("item")).toBeCloseTo(10, 1);
      expect(rowsOf(hooks("item")).filter((row) => row.trim()).length).toBe(2);
    });
  },
};

/** The host's display and columns lay out its one shadow child alone
 * (specs/host-leaf.md): under `columns-2`, `grid grid-cols-2` and
 * `flex gap-2` the children stay a block, each light element on its
 * cells and the grid as wide as the host's content box. */
export const HostDisplay: StoryObj = {
  render: () => html`
    <div class="flex w-160 flex-col gap-4">
      ${["columns-2", "grid grid-cols-2", "flex gap-2"].map(
        (classes) => html`
          <mono-wind data-test="host" class=${classes}>
            <p>A first paragraph.</p>
            <div class="border px-1">A bordered box.</div>
            <p data-test="late">A third paragraph.</p>
            <p>A fourth paragraph, the last.</p>
          </mono-wind>
        `,
      )}
    </div>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    await frames(2);
    for (const host of canvasElement.querySelectorAll<HTMLElement>('[data-test="host"]')) {
      const style = getComputedStyle(host);
      const content =
        host.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth);
      const grid = gridOf(host).getBoundingClientRect().width;
      expect(Math.abs(content - grid), host.className).toBeLessThan(cellSize(host).width);
      // A block: the third paragraph under the bordered box, at the start.
      expect(rowsOf(host)[4], host.className).toMatch(/^A third paragraph\./);
      for (const el of host.querySelectorAll<HTMLElement>("[data-mw-laid-out]")) {
        await expectOnItsCells(host, el);
      }
      expectGridOnItsCells(host);
    }
  },
};
