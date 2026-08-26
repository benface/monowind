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

/** Measure the width of a monospace character and the line-box height. */
export function measureCellMetrics(host: HTMLElement): CellMetrics {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  // `!important` overrides the companion stylesheet's `mono-wind *` rules
  // (white-space, overflow-wrap) that would otherwise wrap the probe to the
  // host's width and give us a bogus per-cell measurement.
  probe.style.cssText =
    "position:absolute!important;visibility:hidden!important;pointer-events:none!important;" +
    "white-space:pre!important;overflow-wrap:normal!important;" +
    "top:0!important;left:0!important;padding:0!important;margin:0!important;border:0!important;";
  probe.textContent = "M".repeat(100);
  host.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  host.removeChild(probe);
  return { width: rect.width / 100, height: rect.height };
}

export function getRootFontSizePx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
