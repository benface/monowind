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
  // Glyph ink vs line box: a Range rect spans the font's ascent + descent,
  // which some fonts draw TALLER than their `normal` line box. WebKit
  // fragments columns at ink bottoms, so multicol needs the overhang.
  const range = probe.ownerDocument.createRange();
  range.selectNodeContents(probe);
  const contentHeight = range.getBoundingClientRect().height;
  const inkOverhang = Math.max(0, contentHeight - rect.height);
  // The reverse: a content area SHORTER than the line box (WebKit's SF
  // Mono, 16.5px in 17) is all an inline background covers, so rows of
  // background would show a hairline between them.
  const backgroundGap = Math.max(0, rect.height - contentHeight);
  // The cell is the next whole 1/64 px (the layout unit Chromium and
  // WebKit snap boxes to, text staying in floats); the grid's
  // letter-spacing carries the remainder and the light DOM keeps its
  // natural advance (specs/cell-model.md "Typography").
  const measured = rect.width / 100;
  const width = Math.ceil(measured * 64 - 1e-6) / 64;
  // The probe's mark — an empty inline-block the host appends last —
  // sits on the baseline.
  const mark = probe.lastElementChild;
  const baseline = mark ? mark.getBoundingClientRect().top - rect.top : undefined;
  return {
    width,
    height: rect.height,
    letterSpacing,
    gridLetterSpacing: letterSpacing + (width - measured),
    inkOverhang,
    backgroundGap,
    ...(baseline === undefined ? {} : { baseline }),
  };
}

export function getRootFontSizePx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
