import type { CellMetrics } from "./types.ts";

/** Round to nearest integer, ties away from zero (per specs/cell-model.md). */
export function roundHalfAwayFromZero(value: number): number {
  const rounded = value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
  return rounded || 0; // normalize -0 → 0
}

/** Convert a computed px value to cells using the spacing scale (1 cell = 0.25rem). */
export function pxToCells(px: number, rootFontSizePx: number): number {
  if (rootFontSizePx <= 0) return 0;
  return roundHalfAwayFromZero(px / (0.25 * rootFontSizePx));
}

/** Convert a percentage of an integer container to whole cells, ties away from zero. */
export function percentToCells(percent: number, containerCells: number): number {
  return roundHalfAwayFromZero((containerCells * percent) / 100);
}

/** Measure the root's cell from the host's PERSISTENT shadow probe (100
 * "M"s inheriting the host's font): the advance of a monospace character
 * (with the root's own letter-spacing) and the line-box height. Root
 * leading/tracking thus size the grid; descendants' are quantized to it
 * (specs/cell-model.md). The probe must be long-lived: a throwaway node
 * created at measure time can transiently resolve the FALLBACK font even
 * after the real font has loaded (observed on CI Chromium), whereas a
 * persistent node is re-font-matched by the same machinery as real
 * content. */
export function measureCellMetrics(host: HTMLElement, probe: HTMLElement): CellMetrics {
  const rect = probe.getBoundingClientRect();
  const letterSpacing = parseFloat(getComputedStyle(host).letterSpacing) || 0;
  return { width: rect.width / 100, height: rect.height, letterSpacing };
}

export function getRootFontSizePx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
