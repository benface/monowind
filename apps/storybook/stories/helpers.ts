import { expect, waitFor } from "storybook/test";
import { wrapLines } from "monowind";

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

async function textLeaves(host: Element): Promise<HTMLElement[]> {
  // Generous timeout: three browser instances share the CPU (worse on CI
  // runners), so a rAF-driven relayout can easily outrun waitFor's
  // default 1s under load.
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
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
  const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
  const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
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
  const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
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
  const cellWidth = parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw"));
  const cellHeight = parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch"));
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
        expect(Math.abs(rect.height - cellHeight)).toBeLessThan(1);
        expect(Math.abs(rect.top - (gridRect.top + y * cellHeight))).toBeLessThan(1);
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
