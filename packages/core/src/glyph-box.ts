import type { CellPaint } from "./plain-text.ts";

/**
 * Which clusters the grid's font draws off their cell count, and how
 * to fit them (specs/wide-characters.md "The grid stays on its cells
 * in any font"): each distinct non-ASCII cluster is measured once per
 * font (family, size, weight, style) with canvas `measureText`, and a
 * mismatch is painted in a box of exactly its cells, the glyph scaled
 * to fill it within the row. Block Elements and Box Drawing fit their
 * row instead, one transform per range from its reference glyph, and
 * a shade's lattice is locked to whole device pixels and carried
 * across rows (`shift`). Without a canvas (headless tests) nothing is
 * boxed.
 */
export interface GlyphBox {
  /** The box's `font-size` as a factor of the grid's. */
  scale: number;
  /** The box's own `line-height` in px, which places a tiling glyph's
   * top a pixel and a half above the row (set for tiling ranges only). */
  lineHeight?: number;
  /** The vertical period of a shade's lattice at that scale, in px
   * (set for shades only). */
  period?: number;
  /** How far the glyph's content area — what a browser's selection
   * highlight covers — reaches past the box above and below, in px
   * (set with `period`). */
  reach?: { above: number; below: number };
}

/** The ranges meant to abut, each with the glyph that spans its full
 * height: Block Elements by `█`, Box Drawing by `│`. */
const TILING = [
  { range: /^[\u2580-\u2590\u2594-\u259F]$/, reference: "\u2588" },
  { range: /^[\u2500-\u257F]$/, reference: "\u2502" },
];

/** The shades: patterns, whose fit locks their lattice to device
 * pixels and carries it across rows. */
const SHADE = /^[\u2591-\u2593]$/;

/** Where the baseline of `glyph` lands, in px from the top of a box a
 * row tall with that `font-size` factor and `line-height`. */
export type BaselineOf = (glyph: string, scale: number, lineHeight: number) => number;

export class GlyphBoxes {
  #boxes = new Map<string, GlyphBox | null>();
  #fits = new Map<string, GlyphBox | null>();
  #context: CanvasRenderingContext2D | null | undefined;
  #font = { style: "normal", weight: "400", size: "16px", family: "monospace" };
  #cell = { width: 0, height: 0, letterSpacing: 0 };
  #dpr = 1;
  #baselineOf: BaselineOf | undefined;

  constructor(baselineOf?: BaselineOf) {
    this.#baselineOf = baselineOf;
  }

  /** The grid's font and cell; a change (the device pixel ratio's too —
   * a zoom moves the shades' lattice) forgets every measurement. */
  configure(
    font: { style: string; weight: string; size: string; family: string },
    cell: { width: number; height: number; letterSpacing: number },
  ): void {
    const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
    const same =
      font.style === this.#font.style &&
      font.weight === this.#font.weight &&
      font.size === this.#font.size &&
      font.family === this.#font.family &&
      cell.width === this.#cell.width &&
      cell.height === this.#cell.height &&
      cell.letterSpacing === this.#cell.letterSpacing &&
      dpr === this.#dpr;
    if (same) return;
    this.#font = { ...font };
    this.#cell = { ...cell };
    this.#dpr = dpr;
    this.#boxes.clear();
    this.#fits.clear();
  }

  /** Forget every measurement: a font finished loading, so the same
   * cluster may draw differently now (the fallback's measurements would
   * otherwise stay cached under the same font name). */
  invalidate(): void {
    this.#boxes.clear();
    this.#fits.clear();
  }

  /** The box for a cluster painted with `paint`, or null when the font
   * draws it at `cells` cells within 0.01 cell (a block: at its width
   * and at least the row's height). Nothing is cached while fonts are
   * still loading. */
  box(cluster: string, cells: number, paint?: CellPaint): GlyphBox | null {
    const weight = paint?.fontWeight ?? this.#font.weight;
    const style = paint?.fontStyle ?? this.#font.style;
    const key = `${style}|${weight}|${cluster}`;
    let box = this.#boxes.get(key);
    if (box === undefined) {
      box = this.#measure(
        cluster,
        cells,
        `${style} ${weight} ${this.#font.size} ${this.#font.family}`,
      );
      if (document.fonts?.status !== "loading") this.#boxes.set(key, box);
    }
    return box;
  }

  #measure(cluster: string, cells: number, font: string): GlyphBox | null {
    const context = this.#canvas();
    const { width: cellWidth, height: cellHeight, letterSpacing } = this.#cell;
    if (!context || cellWidth <= 0 || cellHeight <= 0) return null;
    context.font = font;
    const tiling = TILING.find((t) => t.range.test(cluster));
    if (tiling) return this.#tileFit(tiling.reference, context, font);
    if (SHADE.test(cluster)) {
      if (!this.#tileFit("\u2588", context, font)) return null;
      return this.#tileFit(cluster, context, font, true);
    }
    const metrics = context.measureText(cluster);
    const advance = metrics.width + letterSpacing;
    const target = cells * cellWidth;
    // Floating-point noise only: a glyph a few hundredths of a cell off
    // still drifts a line by a pixel over a few glyphs (WebKit's ★ and ✎
    // at 0.974), and its box scales it imperceptibly.
    if (Math.abs(advance - target) <= 0.01 * cellWidth) return null;
    let scale = advance > 0 ? target / advance : 1;
    const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (inkWidth > 0) scale = Math.min(scale, target / inkWidth);
    if (inkHeight > 0) scale = Math.min(scale, cellHeight / inkHeight);
    return { scale: Math.round(scale * 1000) / 1000 };
  }

  /** How far a shade's lattice moves in `row` so that it carries on
   * from the row above: down by the phase, or up by the rest of the
   * period when down would carry the glyph's content area off the
   * box's top and up keeps it past the bottom — a selection highlight
   * covers the content area, and the move must not bare the box. */
  shift(box: GlyphBox, row: number): number {
    const unit = (box.period ?? 0) * this.#dpr;
    if (!unit) return 0;
    const past = row * this.#cell.height * this.#dpr;
    const down = (unit - (past % unit)) % unit;
    const up = unit - down;
    const reach = box.reach;
    const goesUp = reach && down > reach.above * this.#dpr && up <= reach.below * this.#dpr;
    return (goesUp ? -up : down) / this.#dpr;
  }

  /** One fit per tiling range of a font: null when the reference glyph
   * spans the row at its cell width, else the scale that puts it a
   * pixel and a half past the row on each side (the box clips it; no
   * pixel snapping can open a seam) — a `patterned` glyph's raised to
   * whole device pixels of lattice — and the line-height that pins its
   * top there (a line box sets the baseline at half-leading plus the
   * font's ascent), corrected by the host's measured baseline. */
  #tileFit(
    reference: string,
    context: CanvasRenderingContext2D,
    font: string,
    patterned = false,
  ): GlyphBox | null {
    const key = `${reference}|${font}`;
    let fit = this.#fits.get(key);
    if (fit !== undefined) return fit;
    const { width: cellWidth, height: cellHeight, letterSpacing } = this.#cell;
    const metrics = context.measureText(reference);
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const short = inkHeight < cellHeight - 0.05;
    const offWidth = Math.abs(metrics.width + letterSpacing - cellWidth) > 0.01 * cellWidth;
    fit = null;
    if ((short || offWidth) && inkHeight > 0) {
      let scale = (cellHeight + 3) / inkHeight;
      let lattice: number | undefined;
      const period = patterned ? this.#period(reference, font) : null;
      if (period) {
        // The lattice a whole number of device pixels, so every dot
        // rasterizes alike.
        const unit = period * this.#dpr;
        const units = Math.ceil(scale * unit - 1e-6);
        scale = units / unit;
        lattice = units / this.#dpr;
      }
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      fit = { scale: Math.round(scale * 1000) / 1000 };
      if (lattice) fit.period = lattice;
      if (Number.isFinite(ascent + descent)) {
        let lineHeight = scale * (2 * metrics.actualBoundingBoxAscent - ascent + descent) - 3;
        if (this.#baselineOf) {
          // The engine's actual baseline at that line-height: the ink's
          // top should sit 1.5px above the row, and moves half a pixel
          // per pixel of line-height.
          const baseline = this.#baselineOf(reference, fit.scale, lineHeight);
          const inkTop = baseline - metrics.actualBoundingBoxAscent * fit.scale;
          lineHeight -= 2 * (inkTop + 1.5);
        }
        fit.lineHeight = Math.round(lineHeight * 100) / 100;
        if (lattice) {
          // The content area sits in the line box by its half-leading.
          const content = (ascent + descent) * scale;
          const top = (lineHeight - content) / 2;
          fit.reach = {
            above: Math.round(-top * 100) / 100,
            below: Math.round((top + content - cellHeight) * 100) / 100,
          };
        }
      }
    }
    // Cached even while fonts load: the measurement forces a layout,
    // and the host's `invalidate()` on `loadingdone` refreshes it.
    this.#fits.set(key, fit);
    return fit;
  }

  /** The vertical period of a glyph's lattice in px — the first peak of
   * the alpha's autocorrelation down the most patterned of a few
   * columns of the glyph (a dark shade's holes miss its middle), drawn
   * at four times the size — or null when nothing repeats. */
  #period(glyph: string, font: string): number | null {
    const size = parseFloat(this.#font.size) || 16;
    const k = 4;
    const side = Math.ceil(size * 2 * k);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context || typeof context.getImageData !== "function") return null;
    context.scale(k, k);
    context.font = font;
    context.textBaseline = "top";
    context.fillText(glyph, size / 2, size / 2);
    const data = context.getImageData(0, 0, side, side).data;
    let centered: number[] = [];
    let energy = 0;
    for (const across of [0.25, 0.375, 0.5, 0.625, 0.75]) {
      const x = Math.round((size / 2 + this.#cell.width * across) * k);
      const column: number[] = [];
      for (let y = 0; y < side; y++) column.push(data[(y * side + x) * 4 + 3]!);
      let top = column.findIndex((alpha) => alpha > 0);
      let bottom = column.length - 1;
      while (bottom > top && column[bottom] === 0) bottom--;
      if (top < 0 || bottom - top < 2 * k) continue;
      const samples = column.slice(top, bottom + 1);
      const mean = samples.reduce((sum, alpha) => sum + alpha, 0) / samples.length;
      const candidate = samples.map((alpha) => alpha - mean);
      const candidateEnergy = candidate.reduce((sum, value) => sum + value * value, 0);
      if (candidateEnergy > energy) {
        energy = candidateEnergy;
        centered = candidate;
      }
    }
    if (energy === 0) return null;
    const correlation = (lag: number): number => {
      let sum = 0;
      for (let i = 0; i + lag < centered.length; i++) sum += centered[i]! * centered[i + lag]!;
      return sum / energy;
    };
    // The first peak that stands out is the period (a wobble in the
    // trough is not one).
    let previous = correlation(1);
    let rising = false;
    for (let lag = 2; lag <= centered.length / 2; lag++) {
      const current = correlation(lag);
      if (rising && current < previous && previous > 0.3) return (lag - 1) / k;
      rising = current > previous;
      previous = current;
    }
    return null;
  }

  #canvas(): CanvasRenderingContext2D | null {
    if (this.#context === undefined) {
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        this.#context = context && typeof context.measureText === "function" ? context : null;
      } catch {
        this.#context = null;
      }
    }
    return this.#context;
  }
}
