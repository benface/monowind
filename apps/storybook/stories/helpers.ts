import { ref } from "lit/directives/ref.js";
import { useCallback, useEffect, useRef } from "storybook/preview-api";
import { expect, waitFor } from "storybook/test";
import { wrapLines, type MonoWindElement } from "monowind";

/** Firefox breaks BEFORE hyphens (documented divergence, cell-model.md);
 * hyphen-sensitive assertions gate on this. */
export const isFirefox = navigator.userAgent.includes("Firefox");

/** What a copy of the current selection puts on the clipboard as
 * text/plain — via a synthetic copy event on the host. Read the
 * EVENT's clipboardData: Firefox gives a dispatched event a
 * DataTransfer of its own. */
export function copyText(host: HTMLElement): string {
  const event = new ClipboardEvent("copy", {
    clipboardData: new DataTransfer(),
    bubbles: true,
    cancelable: true,
  });
  host.dispatchEvent(event);
  return event.clipboardData!.getData("text/plain");
}

export interface Point {
  x: number;
  y: number;
}
export interface PressInit {
  pointerType?: string;
  shiftKey?: boolean;
  target?: Element;
}

/** A primary press at client coordinates: the pointerdown the engine
 * reads the pointer type from, then the mousedown that carries the
 * click count. Returns false when the engine took it (preventDefault). */
export function pressAt(target: Element, at: Point, detail: number, init: PressInit = {}): boolean {
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

export function release(): void {
  window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", isPrimary: true }));
}

/** A primary-button drag to `at`, dispatched on `target`. */
export function dragTo(target: Element, at: Point): void {
  target.dispatchEvent(
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
}

/** A component mounted on the directive's element and destroyed when
 * Lit drops the element or the story ends (Storybook remounts by wiping
 * the canvas, past Lit's ref) — called from a story's render, whose
 * re-renders share the one mount. */
export function mountedOn(mount: (root: Element) => { destroy(): void }): ReturnType<typeof ref> {
  const current = useRef<{ root: Element; mounted: { destroy(): void } } | null>(null);
  const destroy = () => {
    current.current?.mounted.destroy();
    current.current = null;
  };
  useEffect(() => destroy, []);
  // One callback for the story's life: Lit calls a new one with
  // `undefined` first, which would remount on every re-render.
  const onElement = useCallback((element?: Element) => {
    if (element === current.current?.root) return;
    destroy();
    if (element) current.current = { root: element, mounted: mount(element) };
  }, []);
  return ref(onElement);
}

/** A pointer move onto an element's middle, as a mouse makes it. */
export function hoverOver(element: Element): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerType: "mouse",
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

/** The host's cell, in px, as the engine measured it. */
export const cellSize = (host: HTMLElement): { width: number; height: number } => ({
  width: parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw")),
  height: parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch")),
});

/** The host's shadow grid, and its text as rows. */
export const gridOf = (host: HTMLElement): HTMLElement => host.shadowRoot!.getElementById("grid")!;
export const rowsOf = (host: HTMLElement): string[] => gridOf(host).textContent!.split("\n");

/** The first span the grid painted holding `text`. */
export const paintedSpan = (host: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(gridOf(host).querySelectorAll("span")).find((el) => el.textContent!.includes(text));

/** The background the grid painted under the first span holding `text`,
 * "" for none or no span. */
export const paintedBackground = (host: HTMLElement, text: string): string =>
  paintedSpan(host, text)?.style.backgroundColor ?? "";

/** The story's `data-test` hooks, by name. */
export const testHooks =
  (canvasElement: HTMLElement) =>
  (name: string): HTMLElement =>
    canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;

/** Two edges on the same pixel, retried: a late font load swaps the
 * cell metrics and relays out a frame after `fonts.ready`, the light
 * boxes following. */
export const expectTouching = (a: () => number, b: () => number): Promise<void> =>
  waitFor(() => expect(Math.abs(a() - b())).toBeLessThan(1));

/** The light element's box against the grid cells the engine gave it,
 * retried as `expectTouching` is. */
export function expectOnItsCells(host: HTMLElement, el: HTMLElement): Promise<void> {
  return waitFor(() => {
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const x = parseFloat(el.style.getPropertyValue("--mw-x"));
    const y = parseFloat(el.style.getPropertyValue("--mw-y"));
    const grid = gridOf(host).getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    expect(Math.abs(rect.left - (grid.left + x * cellWidth))).toBeLessThan(1);
    expect(Math.abs(rect.top - (grid.top + y * cellHeight))).toBeLessThan(1);
  });
}

/** The story's hosts once laid out, the fonts loaded, and the cell
 * settled: the engine relays out two frames after the fonts land, and a
 * cell read before that is the fallback font's. */
export async function readyHosts(canvasElement: HTMLElement): Promise<MonoWindElement[]> {
  const hosts = Array.from(canvasElement.querySelectorAll<MonoWindElement>("mono-wind"));
  await waitFor(() => {
    for (const host of hosts) expect(host).toHaveAttribute("data-mw-ready");
  });
  await document.fonts.ready;
  const cells = () =>
    hosts.map((host) => `${cellSize(host).width}x${cellSize(host).height}`).join();
  let was: string;
  do {
    was = cells();
    await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
  } while (was !== cells());
  return hosts;
}

/** The story's host once laid out and its fonts loaded. */
export const readyHost = async (canvasElement: HTMLElement): Promise<MonoWindElement> =>
  (await readyHosts(canvasElement))[0]!;

async function textLeaves(host: Element): Promise<HTMLElement[]> {
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
  const leaves = Array.from(host.querySelectorAll<HTMLElement>("[data-mw-laid-out]")).filter(
    (el) =>
      el.textContent!.trim() !== "" &&
      !el.querySelector("[data-mw-laid-out], [data-mw-inline-box]"),
  );
  expect(leaves.length).toBeGreaterThan(0);
  return leaves;
}

/** Assert that the browser painted every laid-out leaf's text on exactly
 * the rows the engine allocated — the wrap models must agree in every
 * engine (specs/cell-model.md). `allowStretchedLeaves` relaxes the check
 * to "the text fits inside the box" for stories where leaves are
 * STRETCHED taller than their text (grid items spanning rows, stretched
 * flex items): there the box height is the area, not the line count. */
export async function expectBrowserRowsToMatchEngine(
  canvasElement: HTMLElement,
  { allowStretchedLeaves = false }: { allowStretchedLeaves?: boolean } = {},
): Promise<void> {
  const host = canvasElement.querySelector("mono-wind")!;
  const leaves = await textLeaves(host);
  // Retried: a late font load swaps the cell metrics and relays out a
  // frame after `fonts.ready`; the browser's lines and the engine's rows
  // agree once both have settled.
  await waitFor(() => {
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    for (const el of leaves) {
      const cells = (name: string) => Number(el.style.getPropertyValue(name));
      const contentRows =
        cells("--mw-h") - cells("--mw-bt") - cells("--mw-bb") - cells("--mw-pt") - cells("--mw-pb");
      // N lines occupy N + (N − 1) × gap rows, with gap = rows per line − 1.
      const rowsPerLine = cells("--mw-lh") || 1;
      const engineLines = (contentRows + rowsPerLine - 1) / rowsPerLine;
      const range = document.createRange();
      range.selectNodeContents(el);
      // Fragments on one line can differ slightly in top (an italic or bold
      // fallback face has its own ascent), so count rows by the fragment's
      // vertical centre rather than distinct tops.
      const top = el.getBoundingClientRect().top;
      const lines = new Set(
        Array.from(range.getClientRects(), (r) =>
          Math.floor((r.top + r.height / 2 - top) / cellHeight),
        ),
      );
      if (allowStretchedLeaves) {
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBeGreaterThan(0);
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBeLessThanOrEqual(engineLines);
      } else {
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBe(engineLines);
      }
      // Horizontal agreement: the text must hug the element's content
      // origin (left padding edge) — or the right edge for end-aligned
      // text. Guards against the browser laying the text out relative to
      // some OTHER box than the engine's — e.g. an absolutely positioned
      // grid child's §10.1 grid-area containing block before styles.css
      // neutralized grid placement.
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      if (rects.length > 0) {
        const box = el.getBoundingClientRect();
        const textAlign = getComputedStyle(el).textAlign;
        const label = el.textContent!.trim();
        if (/right|end/.test(textAlign)) {
          const textRight = Math.max(...rects.map((r) => r.right));
          const expectedRight =
            box.left + (cells("--mw-w") - cells("--mw-br") - cells("--mw-pr")) * cellWidth;
          expect(Math.abs(textRight - expectedRight), `"${label}" text end`).toBeLessThan(1.5);
        } else if (/center/.test(textAlign)) {
          // Engine centers at floor(leftover / 2) whole cells; the
          // browser's own centering is fractional — they agree within
          // half a cell (specs/cell-model.md "Text alignment").
          const widest = rects.reduce((a, b) => (b.width > a.width ? b : a));
          const contentCells =
            cells("--mw-w") -
            cells("--mw-bl") -
            cells("--mw-br") -
            cells("--mw-pl") -
            cells("--mw-pr");
          const lineCells = Math.round(widest.width / cellWidth);
          const expectedLeft =
            box.left +
            (cells("--mw-bl") + cells("--mw-pl")) * cellWidth +
            Math.floor(Math.max(0, contentCells - lineCells) / 2) * cellWidth;
          expect(Math.abs(widest.left - expectedLeft), `"${label}" text center`).toBeLessThan(
            cellWidth / 2 + 1.5,
          );
        } else {
          const textLeft = Math.min(...rects.map((r) => r.left));
          const expectedLeft = box.left + (cells("--mw-bl") + cells("--mw-pl")) * cellWidth;
          expect(Math.abs(textLeft - expectedLeft), `"${label}" text start`).toBeLessThan(1.5);
        }
      }
    }
  });
}

/** Assert the browser broke each leaf's lines at the exact character
 * positions the engine's wrap model predicts (specs/cell-model.md) —
 * `expectBrowserRowsToMatchEngine` only compares line COUNTS, which
 * can't see a break landing on the wrong side of a hyphen. Applies to
 * simple leaves (element children, letter spacing, and non-normal
 * white-space are skipped: their run text isn't recoverable from bare
 * textContent). Collapsible spaces are stripped from both sides of the
 * comparison — rects for a space at a soft break are unreliable — so
 * breaks are compared through the non-space character sequence (NBSP
 * counts as a character). In Firefox, hyphenated leaves are skipped:
 * it breaks BEFORE hyphens (documented divergence, cell-model.md). */
export async function expectBrowserLineBreaksToMatchEngine(
  canvasElement: HTMLElement,
): Promise<void> {
  const host = canvasElement.querySelector("mono-wind")!;
  const leaves = await textLeaves(host);
  const cellHeight = cellSize(host).height;
  let checked = 0;
  for (const el of leaves) {
    const computed = getComputedStyle(el);
    if (el.childElementCount > 0 || computed.whiteSpace !== "normal") continue;
    if (computed.letterSpacing !== "normal" && parseFloat(computed.letterSpacing) !== 0) continue;
    const text = el.textContent!.replace(/[ \t\r\n\f]+/g, " ").trim();
    if (isFirefox && text.includes("-")) continue;
    const cells = (name: string) => Number(el.style.getPropertyValue(name));
    const contentWidth =
      cells("--mw-w") - cells("--mw-bl") - cells("--mw-br") - cells("--mw-pl") - cells("--mw-pr");
    const engineLines = wrapLines(text, contentWidth).map((line) => line.replaceAll(" ", ""));
    // Rebuild the browser's lines character by character: each glyph's
    // rect centre picks its row, rows in top-to-bottom order are lines.
    const top = el.getBoundingClientRect().top;
    const rows = new Map<number, string>();
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        if (/[ \t\r\n\f]/.test(data[i]!)) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        const row = Math.floor((rect.top + rect.height / 2 - top) / cellHeight);
        rows.set(row, (rows.get(row) ?? "") + data[i]!);
      }
    }
    const browserLines = [...rows.keys()].sort((a, b) => a - b).map((row) => rows.get(row)!);
    expect(browserLines, `"${text}" break positions`).toEqual(engineLines);
    checked++;
  }
  // Firefox can skip every hyphenated leaf; a story with none must check.
  if (!isFirefox) expect(checked).toBeGreaterThan(0);
}

/** Assert that every painted grid row is exactly the grid's width and
 * every boxed glyph exactly one cell tall on its row
 * (specs/wide-characters.md): a fallback glyph drawn off its cell count
 * would stretch or shrink its row, and a taller fallback line box would
 * push the rows below. Element boxes are read directly — a Range's
 * rect would also union the text inside a box, which a scaled glyph
 * overflows by design. */
export function expectGridOnItsCells(host: HTMLElement): void {
  const grid = host.shadowRoot!.getElementById("grid")!;
  const cellWidth = cellSize(host).width;
  const cellHeight = cellSize(host).height;
  const rows: Node[][] = [[]];
  for (const node of Array.from(grid.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent === "\n") rows.push([]);
    else rows[rows.length - 1]!.push(node);
  }
  const gridRect = grid.getBoundingClientRect();
  expect(Math.abs(gridRect.height - rows.length * cellHeight)).toBeLessThan(1);
  rows.forEach((row, y) => {
    let left = Infinity;
    let right = -Infinity;
    for (const node of row) {
      let rect: DOMRect;
      if (node instanceof Element) {
        rect = node.getBoundingClientRect();
        const which = `row ${y} "${node.textContent}" [${node.getAttribute("style")}]`;
        expect(Math.abs(rect.height - cellHeight), which).toBeLessThan(1);
        expect(Math.abs(rect.top - (gridRect.top + y * cellHeight)), which).toBeLessThan(1);
      } else {
        const range = document.createRange();
        range.selectNodeContents(node);
        rect = range.getBoundingClientRect();
      }
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    if (row.length > 0) expect(Math.abs(right - left - gridRect.width)).toBeLessThan(cellWidth / 2);
  });
}

export interface Cell {
  row: number;
  col: number;
}
/** A native line of an element's text: its row and its glyphs' columns. */
export interface Line extends Cell {
  max: number;
}

/** The story's host once ready, with its readers: an element's engine
 * cells (`--mw-*`), and `measure` — the grid and its geometry, read
 * fresh each call, since a late font load swaps the cell metrics and
 * relays out a frame after `fonts.ready`; a comparison wrapped in
 * `waitFor` retries until both sides settle. */
export async function readyGrid(canvasElement: HTMLElement) {
  const host = await readyHost(canvasElement);
  const by = testHooks(canvasElement);
  const grid = host.shadowRoot!.getElementById("grid")!;
  const cells = (el: HTMLElement, name: string) => Number(el.style.getPropertyValue(name));
  const measure = () => {
    const rows = grid.textContent!.split("\n");
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const gridRect = grid.getBoundingClientRect();
    const cellOf = (rect: DOMRect): Cell => ({
      row: Math.floor((rect.top + rect.height / 2 - gridRect.top) / cellHeight),
      col: Math.round((rect.left - gridRect.left) / cellWidth),
    });
    // An element box's top-left cell (a glyph rect reads by its middle).
    const boxOf = (el: HTMLElement): Cell => {
      const rect = el.getBoundingClientRect();
      return {
        row: Math.round((rect.top - gridRect.top) / cellHeight),
        col: Math.round((rect.left - gridRect.left) / cellWidth),
      };
    };
    const cellAt = (col: number, row: number) => ({
      x: gridRect.left + (col + 0.5) * cellWidth,
      y: gridRect.top + (row + 0.5) * cellHeight,
    });
    // The browser's lines of an element's text, character by character:
    // each glyph's rect picks its row and column, and the grid must show
    // the same characters on those cells.
    const expectNativeOnGrid = (el: HTMLElement): Line[] => {
      const byRow = new Map<number, { min: number; max: number; text: string }>();
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        for (let i = 0; i < data.length; i++) {
          if (/[ \t\r\n\f]/.test(data[i]!)) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const { row, col } = cellOf(range.getBoundingClientRect());
          const line = byRow.get(row) ?? { min: col, max: col, text: "" };
          line.min = Math.min(line.min, col);
          line.max = Math.max(line.max, col);
          line.text += data[i];
          byRow.set(row, line);
        }
      }
      expect(byRow.size).toBeGreaterThan(0);
      for (const [row, line] of byRow) {
        expect(rows[row]!.slice(line.min, line.max + 1).replaceAll(" ", "")).toBe(line.text);
      }
      return [...byRow]
        .map(([row, line]) => ({ row, col: line.min, max: line.max }))
        .sort((a, b) => a.row - b.row);
    };
    return { rows, cellOf, boxOf, cellAt, expectNativeOnGrid };
  };
  return {
    host,
    by,
    cells,
    width: (el: HTMLElement) => cells(el, "--mw-w"),
    height: (el: HTMLElement) => cells(el, "--mw-h"),
    measure,
  };
}
