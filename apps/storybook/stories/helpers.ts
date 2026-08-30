import { expect, waitFor } from "storybook/test";

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
  // Generous timeouts throughout: three browser instances share the CPU
  // (worse on CI runners), so a rAF-driven relayout can easily outrun
  // waitFor's default 1s under load.
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  const leaves = Array.from(host.querySelectorAll<HTMLElement>("[data-mw-laid-out]")).filter(
    (el) =>
      el.textContent!.trim() !== "" &&
      !el.querySelector("[data-mw-laid-out], [data-mw-inline-box]"),
  );
  expect(leaves.length).toBeGreaterThan(0);
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
      if (/right|end/.test(getComputedStyle(el).textAlign)) {
        const textRight = Math.max(...rects.map((r) => r.right));
        const expectedRight =
          box.left + (cells("--mw-w") - cells("--mw-br") - cells("--mw-pr")) * cellWidth;
        expect(
          Math.abs(textRight - expectedRight),
          `"${el.textContent!.trim()}" text end`,
        ).toBeLessThan(1.5);
      } else {
        const textLeft = Math.min(...rects.map((r) => r.left));
        const expectedLeft = box.left + (cells("--mw-bl") + cells("--mw-pl")) * cellWidth;
        expect(
          Math.abs(textLeft - expectedLeft),
          `"${el.textContent!.trim()}" text start`,
        ).toBeLessThan(1.5);
      }
    }
  }
}
