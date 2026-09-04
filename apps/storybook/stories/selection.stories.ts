import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

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
  tags: ["!dev"],
};
export default meta;

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

/** What a copy of the current selection puts on the clipboard as
 * text/plain — via a synthetic copy event on the host. Read the
 * EVENT's clipboardData: Firefox gives a dispatched event a
 * DataTransfer of its own. */
function copyText(host: HTMLElement): string {
  const event = new ClipboardEvent("copy", {
    clipboardData: new DataTransfer(),
    bubbles: true,
    cancelable: true,
  });
  host.dispatchEvent(event);
  return event.clipboardData!.getData("text/plain");
}

interface Point {
  x: number;
  y: number;
}
interface PressInit {
  pointerType?: string;
  shiftKey?: boolean;
  target?: Element;
}

/** A primary press at client coordinates: the pointerdown the engine
 * reads the pointer type from, then the mousedown that carries the
 * click count. Returns false when the engine took it (preventDefault). */
function pressAt(target: Element, at: Point, detail: number, init: PressInit = {}): boolean {
  const common = { bubbles: true, composed: true, cancelable: true, clientX: at.x, clientY: at.y };
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      ...common,
      pointerType: init.pointerType ?? "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }),
  );
  return target.dispatchEvent(
    new MouseEvent("mousedown", {
      ...common,
      detail,
      button: 0,
      buttons: 1,
      shiftKey: init.shiftKey ?? false,
    }),
  );
}

function release(): void {
  window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", isPrimary: true }));
}

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
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const text = (name: string) => by(name).innerText.trim();
    const art = by("banner").shadowRoot!.getElementById("mirror")!.textContent!;
    const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
    const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
    // Client coordinates of a cell inside an element's box.
    const cell = (name: string, col: number, row: number) => {
      const rect = by(name).getBoundingClientRect();
      return { x: rect.left + (col + 0.5) * cellWidth, y: rect.top + (row + 0.5) * cellHeight };
    };
    const selection = () => document.getSelection()!.toString().trim();
    const press = (at: Point, detail: number, init: PressInit = {}) =>
      pressAt(init.target ?? grid, at, detail, init);
    const move = (at: Point) =>
      grid.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: at.x,
          clientY: at.y,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1,
        }),
      );
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
    // A gap cell keeps the extent; release ends the gesture.
    const before = selection();
    move(cell("second", 1, -1));
    expect(selection()).toBe(before);
    release();
    move(cell("last", 1, 0));
    expect(selection()).toBe(before);
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
    press(cell("banner", 2, 1), 2);
    expect(selection()).toBe(art.trim());
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
    await waitFor(() => expect(host).not.toHaveAttribute(lifted), { timeout: 10_000 });
    // A grid selection copies through the browser: text/plain unset.
    document.getSelection()!.selectAllChildren(grid);
    expect(copied()).toBe("");
    document.getSelection()!.removeAllRanges();
    // Every grid row is painted at the full width — the visible rectangle.
    const rows = grid.textContent!.split("\n");
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
    // The coarse-pointer rule (a scroll container's subtree is
    // selectable, for long-press) must out-cascade the lock: the runner
    // has no coarse pointer, so the rule is replayed without its media
    // query — same selector, same source order — and must win.
    const coarse = document.createElement("style");
    coarse.textContent =
      'mono-wind[select="grid"] :is([data-mw-scroll], [data-mw-scroll] *) { user-select: text; -webkit-user-select: text; }';
    document.head.appendChild(coarse);
    try {
      const style = getComputedStyle(by("scrolled"));
      expect(style.userSelect || style.webkitUserSelect).toBe("text");
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
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
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
    // The gestures are grid-mode only: a triple-click here is the browser's.
    const grid = host.shadowRoot!.getElementById("grid")!;
    const rect = canvasElement.querySelector('[data-test="p1"]')!.getBoundingClientRect();
    expect(pressAt(grid, { x: rect.left + 4, y: rect.top + 4 }, 3)).toBe(true);
    release();
  },
};
