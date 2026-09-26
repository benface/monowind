import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  cellSize,
  centerOf,
  copyText,
  dragTo,
  expectColor,
  frames,
  moveTo,
  pressAt,
  readyHost,
  release,
  testHooks,
} from "./helpers.ts";
import type { Point, PressInit } from "./helpers.ts";

/**
 * Fixtures for the selection-invert visual regression
 * (visual/selection.spec.ts drags a real selection across them in
 * both select modes — set through the preview's Select toolbar
 * global, which overrides any authored attribute — and screenshots
 * the painted result, per engine, because Safari paints selection ink
 * through text-fill-color and needs the text-shadow fallback in the
 * canonical ::selection rules). Hidden from the sidebar and the story
 * sweep; the spec targets them by id.
 */
const meta: Meta = {
  title: "Test / Selection",
  tags: ["!dev", "!golden"],
};
export default meta;

/** A highlight's color locked away. */
const transparent = "rgba(0, 0, 0, 0)";

/** An element's `::selection` style. */
const selectionStyle = (el: Element): CSSStyleDeclaration => getComputedStyle(el, "::selection");

export const LightText: StoryObj = {
  render: () => html`
    <mono-wind>
      <p data-test="target" class="max-w-64">
        A raccoon walked into the corner bakery and took one long look at the display case.
      </p>
    </mono-wind>
  `,
};

export const Banner: StoryObj = {
  render: () => html`
    <mono-wind>
      <mono-ascii data-test="target" font="small" class="text-emerald-400">monowind</mono-ascii>
    </mono-wind>
  `,
};

/** The host's own text (specs/host-leaf.md): the host is the fourth
 * site of the canonical ::selection rule. */
export const HostText: StoryObj = {
  render: () => html`
    <mono-wind data-test="target" class="max-w-64">
      A raccoon walked into the corner bakery and took one long look at the display case.
    </mono-wind>
  `,
};

/** A scaled layer beside plain text (specs/layers.md): a text-mode
 * drag mapped through the transform, a grid-mode one on the layer's
 * own grid. */
export const Layer: StoryObj = {
  render: () => html`
    <mono-wind class="p-2">
      <div class="flex gap-4">
        <div data-test="target" class="origin-top-left scale-150 border px-1">
          scaled layer text
        </div>
        <div class="ml-20">beside the layer</div>
      </div>
    </mono-wind>
  `,
};

/**
 * Semantic selection in grid mode (specs/semantic-selection.md):
 * double- and triple-click select the element's word or paragraph,
 * drag extends unit by unit, the lock lifts while the selection is
 * live, and a copy is the engine's plain text. Gestures are synthetic
 * events on the shadow grid — real clicks are not scriptable here.
 */
export const Semantic: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex gap-4">
        <div class="w-40">
          <p data-test="first">First paragraph with several words in it.</p>
          <p data-test="second" class="mt-1">Second paragraph follows below the first.</p>
        </div>
        <p data-test="side" class="w-32">Side column text that must never be selected.</p>
      </div>
      <mono-ascii data-test="banner" font="small" class="mt-1">hi</mono-ascii>
      <p data-test="last" class="mt-1">After the banner comes this line.</p>
      <input data-test="input" class="mt-1 w-20 border" value="focus me" />
      <div class="mt-1 w-40 columns-2 gap-2">
        <p data-test="col-first">Column prose that splits across both columns of the box.</p>
        <p data-test="col-second" class="mt-1">Trailing prose.</p>
      </div>
      <div data-test="box" class="mt-1 w-20 border p-1">boxed</div>
      <p data-test="pointer" class="cursor-pointer">pointer cursor here</p>
      <div class="mt-1 h-4 w-40 overflow-y-auto border px-1">
        <p data-test="scrolled">Inside a scroll container, selectable by long-press on touch.</p>
        <p class="mt-1">Filler so the box scrolls.</p>
        <p class="mt-1">More filler.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    const by = testHooks(canvasElement);
    const text = (name: string) => by(name).innerText.trim();
    const art = by("banner").shadowRoot!.getElementById("mirror")!.textContent!;
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    // Client coordinates of a cell inside an element's box.
    const cell = (name: string, col: number, row: number) => {
      const rect = by(name).getBoundingClientRect();
      return { x: rect.left + (col + 0.5) * cellWidth, y: rect.top + (row + 0.5) * cellHeight };
    };
    const selection = () => document.getSelection()!.toString().trim();
    const press = (at: Point, detail: number, init: PressInit = {}) =>
      pressAt(init.target ?? grid, at, detail, init);
    const move = (at: Point) => dragTo(grid, at);
    const copied = () => copyText(host);
    const lifted = "data-mw-semantic-selection";
    // The selection's start container as seen through the host's
    // shadow (anchorNode is retargeted onto the host in Firefox).
    const composedRange = (): AbstractRange | null => {
      const sel = document.getSelection()!;
      const composed = sel.getComposedRanges?.({ shadowRoots: [host.shadowRoot!] })[0];
      if (composed) return composed;
      const inner = (host.shadowRoot as { getSelection?: () => Selection | null }).getSelection?.();
      const live = inner ?? sel;
      return live.rangeCount > 0 ? live.getRangeAt(0) : null;
    };
    const composedStart = (): Node | null => composedRange()?.startContainer ?? null;

    // Triple-click: the paragraph, nothing beside it, the lock lifted.
    press(cell("first", 1, 0), 3);
    expect(selection()).toBe(text("first"));
    expect(host).toHaveAttribute(lifted);
    expect(copied()).toBe(text("first"));
    // Drag onto the second paragraph: both, still not the side column.
    move(cell("second", 1, 0));
    expect(selection().startsWith(text("first"))).toBe(true);
    expect(selection().endsWith(text("second"))).toBe(true);
    expect(selection()).not.toContain("Side");
    expect(copied()).toBe(`${text("first")}\n\n${text("second")}`);
    // The gap row above the second paragraph reaches the nearest
    // paragraph, the first; release ends the gesture.
    move(cell("second", 1, -1));
    expect(selection()).toBe(text("first"));
    release();
    move(cell("last", 1, 0));
    expect(selection()).toBe(text("first"));
    // A plain click ends the lift synchronously.
    press(cell("first", 1, 0), 1);
    expect(host).not.toHaveAttribute(lifted);
    release();
    document.getSelection()!.removeAllRanges();
    // Triple-click on a gap cell is left to the browser (its own
    // gesture on the grid): not taken, selection untouched.
    expect(press(cell("second", 1, -1), 3)).toBe(true);
    expect(selection()).toBe("");
    release();
    // The banner: its transcript.
    press(cell("banner", 2, 1), 3);
    expect(selection()).toBe(art.trim());
    expect(copied()).toBe(art);
    release();
    // Double-click: a word; a blank cell: the browser's; drag: word through word.
    press(cell("first", 7, 0), 2);
    expect(selection()).toBe("paragraph");
    move(cell("first", 30, 0));
    expect(selection()).toBe("paragraph with several words");
    expect(copied()).toBe("paragraph with several words");
    release();
    expect(press(cell("first", 39, 0), 2)).toBe(true);
    expect(host).not.toHaveAttribute(lifted);
    release();
    // Same for the paragraph gesture: a blank tail is not the paragraph,
    // nor are a box's border and padding — only its characters.
    expect(press(cell("first", 39, 0), 3)).toBe(true);
    release();
    expect(press(cell("box", 0, 0), 3)).toBe(true);
    release();
    expect(press(cell("box", 1, 1), 3)).toBe(true);
    release();
    press(cell("box", 2, 2), 3);
    expect(selection()).toBe("boxed");
    release();
    // A double-click on the banner: the art's line under the pointer.
    press(cell("banner", 2, 1), 2);
    expect(selection()).toBe(art.split("\n")[1]!.trim());
    release();
    // Focus leaves a control inside the host, as a native click would.
    by("input").focus();
    expect(document.activeElement).toBe(by("input"));
    press(cell("first", 1, 0), 3);
    expect(document.activeElement).not.toBe(by("input"));
    expect(selection()).toBe(text("first"));
    release();
    // Shift extends to the far edge of the hit paragraph, DOM order.
    press(cell("last", 1, 0), 3, { shiftKey: true });
    expect(selection().startsWith(text("first"))).toBe(true);
    expect(selection().endsWith(text("last"))).toBe(true);
    expect(copied()).toBe(
      [text("first"), text("second"), text("side"), art, text("last")].join("\n\n"),
    );
    release();
    // Dragging upward: the base moves to the anchor's far edge, so the
    // selection runs backward from the second paragraph.
    press(cell("second", 1, 0), 3);
    move(cell("first", 1, 0));
    expect(selection().startsWith(text("first"))).toBe(true);
    expect(selection().endsWith(text("second"))).toBe(true);
    expect(by("second").contains(document.getSelection()!.anchorNode)).toBe(true);
    release();
    // An anchor inside the banner's shadow extends through its host's
    // light-tree edges.
    press(cell("banner", 2, 1), 3);
    move(cell("last", 1, 0));
    expect(selection().endsWith(text("last"))).toBe(true);
    expect(copied()).toBe(`${art}\n\n${text("last")}`);
    release();
    // Word extension across paragraphs.
    press(cell("first", 7, 0), 2);
    move(cell("second", 1, 0));
    expect(selection().startsWith("paragraph")).toBe(true);
    expect(selection().endsWith("Second")).toBe(true);
    release();
    // Paragraph-flow multicol children share one box: the gestures
    // follow the line fragments, so the first paragraph is hit in its
    // own cells and the trailing one only in its own.
    press(cell("col-first", 1, 0), 3);
    expect(selection()).toBe(text("col-first"));
    release();
    press(cell("col-first", 1, 0), 2);
    expect(selection()).toBe("Column");
    release();
    // A phantom target — a non-interactive light element that received
    // the event by a browser quirk — is a grid event at its coordinates:
    // the gestures work, and a plain press starts an engine-driven grid
    // drag anchored in the shadow <pre>.
    expect(press(cell("first", 1, 0), 3, { target: by("first") })).toBe(false);
    expect(selection()).toBe(text("first"));
    release();
    expect(press(cell("first", 0, 0), 1, { target: by("first") })).toBe(false);
    expect(grid.contains(composedStart())).toBe(true);
    move(cell("second", 5, 0));
    // The extent moved down the grid (toString() of a shadow selection
    // is unreliable in Chromium; read the composed range instead).
    const dragged = composedRange()!;
    expect(grid.contains(dragged.endContainer)).toBe(true);
    expect((dragged.endContainer as Text).data.startsWith("Second")).toBe(true);
    // A pointer past the grid's rows and columns clamps to its end.
    move(cell("pointer", 200, 40));
    expect(grid.contains(composedRange()!.endContainer)).toBe(true);
    release();
    // Grid-mode light elements carry the text cursor; authored cursors win.
    expect(getComputedStyle(by("first")).cursor).toBe("text");
    expect(getComputedStyle(by("pointer")).cursor).toBe("pointer");
    // A drag begun on the grid drops interactives' pointer events until
    // release, so the native sweep passes through their cells.
    press(cell("first", 1, 0), 1);
    move(cell("second", 1, 0));
    expect(host).toHaveAttribute("data-mw-dragging");
    expect(getComputedStyle(by("input")).pointerEvents).toBe("none");
    release();
    expect(host).not.toHaveAttribute("data-mw-dragging");
    expect(getComputedStyle(by("input")).pointerEvents).toBe("auto");
    // A plain press that blurs a control is taken over (engine drag), so
    // the focus invert repaints at mousedown rather than on release.
    by("input").focus();
    expect(press(cell("first", 0, 0), 1)).toBe(false);
    expect(document.activeElement).not.toBe(by("input"));
    expect(grid.contains(composedStart())).toBe(true);
    await waitFor(() =>
      expect(
        Array.from(grid.querySelectorAll("span")).some((span) => span.style.backgroundColor !== ""),
      ).toBe(false),
    );
    release();
    document.getSelection()!.removeAllRanges();
    // A tap's compatibility mousedown is not a gesture.
    document.getSelection()!.removeAllRanges();
    press(cell("first", 1, 0), 3, { pointerType: "touch" });
    expect(selection()).toBe("");
    release();
    // Collapsing the selection ends the lift on selectionchange.
    press(cell("first", 1, 0), 3);
    expect(host).toHaveAttribute(lifted);
    release();
    document.getSelection()!.removeAllRanges();
    await waitFor(() => expect(host).not.toHaveAttribute(lifted));
    // A grid selection copies through the browser: text/plain unset.
    document.getSelection()!.selectAllChildren(grid);
    expect(copied()).toBe("");
    document.getSelection()!.removeAllRanges();
    // Every grid row is painted at the full width — the visible rectangle.
    const rows = grid.textContent!.split("\n");
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
    // The coarse-pointer rule (a scroll container's subtree takes the
    // touch and is selectable, for panning and long-press) must
    // out-cascade the lock and the pointer-events pass-through: the
    // runner has no coarse pointer, so the rule is replayed without its
    // media query — same selector, same source order — and must win.
    const coarse = document.createElement("style");
    coarse.textContent = `
      mono-wind[select="grid"] [data-mw-scroll]:not([data-mw-measuring], [data-mw-pointer-none]),
      mono-wind[select="grid"] [data-mw-scroll] :not([data-mw-measuring], [data-mw-pointer-none]) {
        pointer-events: auto !important;
      }
      mono-wind[select="grid"] [data-mw-scroll],
      mono-wind[select="grid"] [data-mw-scroll] * {
        user-select: text;
        -webkit-user-select: text;
      }`;
    document.head.appendChild(coarse);
    try {
      const style = getComputedStyle(by("scrolled"));
      expect(style.userSelect || style.webkitUserSelect).toBe("text");
      expect(style.pointerEvents).toBe("auto");
    } finally {
      coarse.remove();
    }
  },
};

/** The engine's plain-text copy in `select="text"`: the browsers'
 * own serializers lose block breaks between the render's out-of-flow
 * boxes (specs/semantic-selection.md). */
export const Copy: StoryObj = {
  render: () => html`
    <mono-wind select="text">
      <p data-test="p1">Alpha one.</p>
      <p data-test="p2">Beta two.</p>
      <div data-test="d1">Gamma three.</div>
      <div data-test="d2">Delta four.</div>
      <table>
        <tr>
          <td data-test="c1">a</td>
          <td data-test="c2">b</td>
        </tr>
        <tr>
          <td data-test="c3">c</td>
          <td>d</td>
        </tr>
      </table>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const textOf = (name: string) =>
      canvasElement.querySelector(`[data-test="${name}"]`)!.firstChild as Text;
    const copyOf = (from: string, to: string) => {
      const a = textOf(from);
      const b = textOf(to);
      document.getSelection()!.setBaseAndExtent(a, 0, b, b.length);
      return copyText(host);
    };
    expect(copyOf("p1", "p2")).toBe("Alpha one.\n\nBeta two.");
    expect(copyOf("d1", "d2")).toBe("Gamma three.\nDelta four.");
    expect(copyOf("c1", "c2")).toBe("a\tb");
    expect(copyOf("c2", "c3")).toBe("b\nc");
    document.getSelection()!.removeAllRanges();
    // The gestures are the engine's in text mode too: a triple-click on
    // a paragraph selects it (specs/wide-characters.md).
    const p1 = canvasElement.querySelector<HTMLElement>('[data-test="p1"]')!;
    const rect = p1.getBoundingClientRect();
    expect(pressAt(p1, { x: rect.left + 4, y: rect.top + 4 }, 3)).toBe(false);
    expect(document.getSelection()!.toString()).toBe("Alpha one.");
    release();
  },
};

/** The auto-scroll fixture: a text-mode host narrower than the page,
 * a scroll container of five lines showing two, a horizontal scroller
 * of one long line, and a paragraph below the fold. */
const autoscrollFixture = html`
  <mono-wind select="text" class="w-lg">
    <p data-test="top">Top paragraph, above the box.</p>
    <div data-test="scroller" class="mt-1 h-4 w-40 overflow-y-auto border px-1">
      <p data-test="s1">First line in the box.</p>
      <p>Second line in the box.</p>
      <p>Third line in the box.</p>
      <p>Fourth line in the box.</p>
      <p>Fifth line in the box, longest.</p>
    </div>
    <div data-test="wide" class="mt-1 w-40 overflow-x-auto border px-1 whitespace-nowrap">
      <p data-test="w1">One long line that runs well past the box's right edge to its tail.</p>
    </div>
    <div class="h-screen"></div>
    <p data-test="bottom">Bottom paragraph, below the fold.</p>
  </mono-wind>
`;

/** A form control's selection (visual/selection.spec.ts): its own
 * colors swapped, painted natively by the control — the theme's on the
 * focus invert, an author's focus colors on the second. */
export const FieldFixture: StoryObj = {
  render: () => html`
    <mono-wind>
      <input data-test="plain" class="w-20 border" value="focus me" />
      <input
        data-test="styled"
        class="mt-1 w-20 border focus-visible:bg-blue-900 focus-visible:text-amber-300"
        value="focus me"
      />
    </mono-wind>
  `,
};

/** The real-mouse auto-scroll target (visual/selection.spec.ts): a
 * drag held outside the host, which only the captured pointer's moves
 * reach. */
export const AutoscrollFixture: StoryObj = {
  render: () => autoscrollFixture,
};

/**
 * Auto-scroll (specs/wide-characters.md "auto-scrolls"): a text-mode
 * drag held past a scroll container's edge scrolls it, held past the
 * viewport's edge scrolls the page, the selection follows the content
 * under the stationary pointer, and a grid-mode paragraph gesture
 * scrolls the same way. Synthetic moves reach the host wherever they
 * claim to be; the fixture's spec covers the captured pointer.
 */
export const Autoscroll: StoryObj = {
  render: () => autoscrollFixture,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const selection = () => document.getSelection()!.toString();
    const focusOwner = () => {
      const node = document.getSelection()!.focusNode;
      return (node instanceof Element ? node : node?.parentElement)
        ?.closest("[data-test]")
        ?.getAttribute("data-test");
    };
    const firstCell = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + cellWidth / 2, y: rect.top + cellHeight / 2 };
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
    const clear = () => {
      release();
      document.getSelection()!.removeAllRanges();
    };
    const scroller = by("scroller");
    const box = scroller.getBoundingClientRect();
    const inside = firstCell(by("s1"));
    // Row middles: past the box is the gap row below it.
    const pastBottom = { x: inside.x, y: box.bottom + cellHeight / 2 };
    // A press in the box, one move past its bottom edge: the ticks
    // scroll it to its end and the selection reaches the last line
    // whole; the page never chains. Back inside, nothing scrolls.
    expect(pressAt(by("s1"), inside, 1)).toBe(false);
    dragTo(by("s1"), pastBottom);
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    await waitFor(() => expect(selection()).toMatch(/longest\.$/));
    expect(window.scrollY).toBe(0);
    dragTo(by("s1"), inside);
    await waitFor(() => expect(selection()).toMatch(/Third line in the box\.\s*F$/));
    const atEnd = scroller.scrollTop;
    await pause();
    expect(scroller.scrollTop).toBe(atEnd);
    // Past its top edge: back up, the selection running backward from
    // the anchor into the paragraph above.
    dragTo(by("s1"), { x: inside.x, y: box.top - cellHeight / 2 });
    await waitFor(() => expect(scroller.scrollTop).toBe(0));
    await waitFor(() => expect(focusOwner()).toBe("top"));
    // A container scroll whose paint a relayout takes over (a light-DOM
    // mutation in the same task): the gesture follows after that
    // layout's paint, on the new tree.
    dragTo(by("s1"), { x: inside.x, y: inside.y + cellHeight });
    await waitFor(() => expect(selection()).toMatch(/First line in the box\.\s*S$/));
    scroller.scrollTop += cellHeight;
    by("top").append(" (edited)");
    await waitFor(() => expect(selection()).toMatch(/Second line in the box\.\s*T$/));
    scroller.scrollTop = 0;
    await pause();
    clear();
    // A pointercancel ends the ticks before the first one lands.
    expect(pressAt(by("s1"), inside, 1)).toBe(false);
    dragTo(by("s1"), pastBottom);
    window.dispatchEvent(
      new PointerEvent("pointercancel", { pointerType: "mouse", isPrimary: true }),
    );
    await pause();
    expect(scroller.scrollTop).toBe(0);
    document.getSelection()!.removeAllRanges();
    // A horizontal scroller: a move past its right edge scrolls it to
    // the line's tail.
    const wide = by("wide");
    const start = firstCell(by("w1"));
    expect(pressAt(by("w1"), start, 1)).toBe(false);
    dragTo(by("w1"), { x: wide.getBoundingClientRect().right + cellWidth / 2, y: start.y });
    await waitFor(() => expect(wide.scrollLeft).toBeGreaterThan(0));
    // Thirty-one cells at a cell per tick.
    await waitFor(() => expect(selection()).toMatch(/tail\.$/));
    clear();
    wide.scrollLeft = 0;
    await pause();
    // A press outside any container, a move past the viewport's
    // bottom at the host's right edge: the page scrolls and the
    // selection reaches the end of the line below the fold.
    const top = firstCell(by("top"));
    expect(pressAt(by("top"), top, 1)).toBe(false);
    const right = host.getBoundingClientRect().right - cellWidth / 2;
    dragTo(by("top"), { x: right, y: window.innerHeight + cellHeight });
    await waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
    await waitFor(() => expect(selection()).toContain("Bottom paragraph"));
    release();
    await pause();
    const scrolled = window.scrollY;
    await pause();
    expect(window.scrollY).toBe(scrolled);
    document.getSelection()!.removeAllRanges();
    window.scrollTo(0, 0);
    await pause();
    // Grid mode: a triple-click in the box held past its edge scrolls
    // it the same way, paragraph by paragraph.
    host.setAttribute("select", "grid");
    const grid = host.shadowRoot!.getElementById("grid")!;
    const line = firstCell(by("s1"));
    expect(pressAt(grid, line, 3)).toBe(false);
    expect(selection().trim()).toBe("First line in the box.");
    dragTo(grid, pastBottom);
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    await waitFor(() => expect(selection()).toContain("Fifth line in the box, longest."));
    clear();
    // The box's bottom border, a clipped line scrolled beneath it: the
    // browser's own gesture, as on any border cell.
    const onBorder = pressAt(grid, { x: inside.x, y: box.bottom - cellHeight / 2 }, 3);
    expect([onBorder, selection()]).toEqual([true, ""]);
    clear();
    host.setAttribute("select", "text");
  },
};

/**
 * The nearest-unit search stays inside the innermost box's VISIBLE
 * cells (specs/semantic-selection.md "Drag extends unit by unit"): a
 * leaf taller than its scroll container paints nothing past the clip,
 * so the content painted there belongs to whatever sits below, and a
 * drag over the leaf's blank rows reaches the paragraph above instead.
 */
export const NearestUnit: StoryObj = {
  render: () => html`
    <mono-wind select="text" class="w-96">
      <p data-test="top">Top paragraph, above the box.</p>
      <div data-test="scroller" class="h-4 w-40 overflow-y-auto border px-1">
        <p><br /><br /><br /><br />text</p>
      </div>
      <p data-test="below">Below paragraph.</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const selection = () => document.getSelection()!.toString();
    const top = by("top").getBoundingClientRect();
    expect(
      pressAt(by("top"), { x: top.left + cellWidth / 2, y: top.top + cellHeight / 2 }, 1),
    ).toBe(false);
    // The box's first content row, blank: the leaf's own cells hold no
    // character, and its clipped rows below are not its cells.
    const box = by("scroller").getBoundingClientRect();
    dragTo(by("top"), { x: box.left + 2.5 * cellWidth, y: box.top + 1.5 * cellHeight });
    await waitFor(() => expect(selection()).toBe("Top paragraph, above the box."));
    release();
    document.getSelection()!.removeAllRanges();
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): the light
 * DOM's own highlight is locked transparent while a selection is live
 * in the host, from before it paints — a user's selection from its
 * `selectstart`, held to a press's release or to a key's first
 * `selectionchange`, an engine gesture's from the press — and left to
 * the page otherwise, so no restyle computes a `::selection` for the
 * host's elements with nothing selected (specs/wide-characters.md). The
 * word's own `selection:` color shows which: Chromium and WebKit hand
 * an element without one the slot's transparent highlight. */
export const HighlightLock: StoryObj = {
  render: () => html`
    <mono-wind>
      <p data-test="text">
        Some <b data-test="word" class="selection:text-red-500">selectable</b> text.
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const selection = document.getSelection()!;
    const ink = () => selectionStyle(by("word")).color;
    expect(ink()).not.toBe(transparent);
    // A script's selection, from its selectionchange.
    selection.selectAllChildren(by("text"));
    await waitFor(() => expect(ink()).toBe(transparent));
    selection.removeAllRanges();
    await waitFor(() => expect(ink()).not.toBe(transparent));
    // A press's, from the selectstart before it, through the release.
    const selectStart = () =>
      by("text").dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
    );
    selectStart();
    expect(ink()).toBe(transparent);
    release();
    await waitFor(() => expect(ink()).not.toBe(transparent));
    // A key's (a select-all, a Shift+Arrow), from the selectstart before
    // it, then as the selection goes, no release to wait for.
    selectStart();
    expect(ink()).toBe(transparent);
    selection.selectAllChildren(by("text"));
    selection.removeAllRanges();
    await waitFor(() => expect(ink()).not.toBe(transparent));
    // A word gesture's, from the press.
    const grid = host.shadowRoot!.getElementById("grid")!;
    expect(pressAt(grid, centerOf(by("word")), 2)).toBe(false);
    expect(ink()).toBe(transparent);
    release();
    expect(selection.toString()).toBe("selectable");
    selection.removeAllRanges();
    await waitFor(() => expect(ink()).not.toBe(transparent));
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): a
 * selection crossing the host's edge locks the light DOM's highlight
 * for as long as it lasts — a text-mode drag pressed outside the host
 * from its first move over the host, before the move's default extends
 * the selection in, past the release; a select-all; a script's range
 * across the host (specs/wide-characters.md). */
export const DragInLock: StoryObj = {
  render: () => html`
    <p data-test="outside">Page text a drag starts in.</p>
    <mono-wind select="text">
      <p data-test="text">
        Some <b data-test="word" class="selection:text-red-500">selectable</b> text.
      </p>
    </mono-wind>
    <p data-test="after">Page text after the host.</p>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const selection = document.getSelection()!;
    const ink = () => selectionStyle(by("word")).color;
    /** The lock a live selection holds, a few frames on. */
    const held = async () => {
      await frames(3);
      expect(ink()).toBe(transparent);
      selection.removeAllRanges();
      await waitFor(() => expect(ink()).not.toBe(transparent));
    };
    expect(ink()).not.toBe(transparent);
    // A move without a press locks nothing, nor does a press outside —
    // which the window's capture sees, and the document its selectstart
    // — or its moves there.
    moveTo(by("word"), centerOf(by("word")));
    pressAt(by("outside"), centerOf(by("outside")), 1);
    by("outside").dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
    moveTo(by("outside"), centerOf(by("outside")), 1);
    expect(ink()).not.toBe(transparent);
    moveTo(by("word"), centerOf(by("word")), 1);
    expect(ink()).toBe(transparent);
    // The move's default: the page text's selection extended into the word.
    selection.setBaseAndExtent(by("outside").firstChild!, 0, by("word").firstChild!, 4);
    release();
    await held();
    selection.selectAllChildren(document.body);
    await held();
    selection.setBaseAndExtent(by("outside").firstChild!, 0, by("after").firstChild!, 4);
    await held();
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): an
 * editable region inside a host keeps its native selection in grid
 * mode, in the editables' swapped `::selection`, where the host's other
 * text is locked (specs/wide-characters.md). */
export const EditableRegion: StoryObj = {
  render: () => html`
    <mono-wind>
      <p data-test="locked">Grid text.</p>
      <div contenteditable="true">
        <p>An <b data-test="editable">editable</b> region.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    expect(selectionStyle(by("editable")).backgroundColor).not.toBe(transparent);
    // The host's other text locked under a selection in it, the region
    // still swapped.
    document.getSelection()!.selectAllChildren(by("locked"));
    await waitFor(() => expect(selectionStyle(by("locked")).color).toBe(transparent));
    expect(selectionStyle(by("locked")).backgroundColor).toBe(transparent);
    expect(selectionStyle(by("editable")).backgroundColor).not.toBe(transparent);
    document.getSelection()!.removeAllRanges();
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): an
 * editable's `::selection` swaps in the ground the grid paints under it
 * — the theme's where `bg-clear` cuts through a filled region, as under
 * an unfilled one. */
export const EditableGroundCleared: StoryObj = {
  render: () => html`
    <mono-wind>
      <div contenteditable="true">
        <p>An <b data-test="plain">unfilled</b> region.</p>
      </div>
      <div contenteditable="true" class="bg-red-900">
        <p class="bg-clear">A <b data-test="cleared">cleared</b> line.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const ground = getComputedStyle(host).getPropertyValue("--mw-bg");
    expectColor(selectionStyle(by("plain")).color, ground, "the unfilled region's selection ink");
    expect(selectionStyle(by("cleared")).color).toBe(selectionStyle(by("plain")).color);
  },
};
