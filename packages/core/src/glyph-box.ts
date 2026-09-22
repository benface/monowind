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
  /** The box's own `line-height` in px, which pins a tiling glyph to
   * its row, its ink at least a pixel past the row each side (set for
   * tiling ranges only). */
  lineHeight?: number;
  /** The glyph's advance at that scale, in px: the box places the glyph
   * by a text-indent of half the room left, where a centered line lands
   * on a rounded position and, at one joint in six, ends short of the
   * clip's edge column. */
  advance: number;
  /** The vertical period of a shade's lattice at that scale, in px
   * (set for shades only). */
  period?: number;
  /** How far the glyph's content area — what a browser's selection
   * highlight covers — reaches past the box above and below, in px
   * (set with `period`). */
  reach?: { above: number; below: number };
  /** Whether the fit exists only because the font draws the glyph PAST
   * the row: it covers the row already, and the box is there to clip
   * the overshoot off the rows below (set for that case alone). */
  past?: boolean;
}

/** The ranges meant to abut, each with the glyph that spans its full
 * height: Block Elements by `█`, Box Drawing by `│` — the latter with
 * the glyph whose stroke lies level in the row, `─`, as its widest
 * ink. A block stands for a cell filled, so it grows to cover a row
 * taller than the font draws it; a stroke stands for a line, whose
 * weight that growth would change. */
const TILING = [
  { range: /^[\u2580-\u2590\u2594-\u259F]$/, reference: "\u2588", fills: true },
  { range: /^[\u2500-\u257F]$/, reference: "\u2502", level: "\u2500" },
];
const BLOCKS = TILING[0]!;

/** The shades: patterns, whose fit locks their lattice to device
 * pixels and carries it across rows. */
const SHADE = /^[\u2591-\u2593]$/;

/** How far a tiling glyph's ink must reach past the cell's edge
 * columns for the clip to leave no column part bare. CSS pixels, not
 * device ones: what closes a joint holds steady across densities, and
 * the sweep behind the number is in specs/wide-characters.md. */
const OVERHANG = 0.45;

/** A glyph's metrics as one string, for telling one drawing of it from
 * another. */
function drawingOf(metrics: TextMetrics): string {
  return `${metrics.width},${metrics.actualBoundingBoxLeft},${metrics.actualBoundingBoxRight},${metrics.actualBoundingBoxAscent},${metrics.actualBoundingBoxDescent}`;
}

/** Where the baseline of `glyph` lands, in px from the top of a box a
 * row tall with that `font-size` factor and `line-height`. */
export type BaselineOf = (glyph: string, scale: number, lineHeight: number) => number;

export class GlyphBoxes {
  #boxes = new Map<string, GlyphBox | null>();
  #fits = new Map<string, GlyphBox | null>();
  #context: CanvasRenderingContext2D | null | undefined;
  #font = { style: "normal", weight: "400", size: "16px", family: "monospace" };
  #cell: { width: number; height: number; letterSpacing: number; baseline?: number } = {
    width: 0,
    height: 0,
    letterSpacing: 0,
  };
  #dpr = 1;
  /** How the font drew each glyph a cached measurement was taken from,
   * keyed by the font it was measured in: exactly what `invalidate()`
   * re-measures to tell whether those measurements still hold. */
  #drawn = new Map<string, string>();
  #baselineOf: BaselineOf | undefined;
  /** Counts the measurements forgotten: a grid painted under an
   * earlier count holds boxes fit to another font or cell (paint.ts). */
  generation = 0;

  constructor(baselineOf?: BaselineOf) {
    this.#baselineOf = baselineOf;
  }

  /** The grid's font and cell — its baseline, in px from the row's
   * top, where the grid measures one; a change (the device pixel
   * ratio's too — a zoom moves the shades' lattice) forgets every
   * measurement. */
  configure(
    font: { style: string; weight: string; size: string; family: string },
    cell: { width: number; height: number; letterSpacing: number; baseline?: number },
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
      cell.baseline === this.#cell.baseline &&
      dpr === this.#dpr;
    if (same) return;
    this.#font = { ...font };
    this.#cell = { ...cell };
    this.#dpr = dpr;
    this.#boxes.clear();
    this.#fits.clear();
    this.#drawn.clear();
    this.generation++;
  }

  /** Forget every measurement: a font finished loading, so the same
   * cluster may draw differently now. Nothing is forgotten while every
   * glyph they came from still draws as it did — `document.fonts`
   * settles on every page, font or no font, and a paint told its fits
   * are stale restyles every box it holds. */
  invalidate(): void {
    if (this.#draws()) return;
    this.#boxes.clear();
    this.#fits.clear();
    this.#drawn.clear();
    this.generation++;
  }

  /** Whether the font still draws every glyph a cached measurement came
   * from exactly as it did; false with nothing cached, or no canvas to
   * ask. */
  #draws(): boolean {
    const context = this.#canvas();
    if (!context || this.#drawn.size === 0) return false;
    for (const [key, was] of this.#drawn) {
      const at = key.indexOf("\u001f");
      context.font = key.slice(0, at);
      if (drawingOf(context.measureText(key.slice(at + 1))) !== was) return false;
    }
    return true;
  }

  /** `measureText`, remembering the drawing under the caller's own
   * `context.font` so `invalidate()` can tell whether it still holds. */
  #measureText(cluster: string, context: CanvasRenderingContext2D, font: string): TextMetrics {
    const metrics = context.measureText(cluster);
    this.#drawn.set(`${font}\u001f${cluster}`, drawingOf(metrics));
    return metrics;
  }

  /** The box for a cluster painted with `paint`, or null when the font
   * draws THAT cluster at `cells` cells within 0.01 cell (a block: at
   * its width and the row's height). Null is the grid's promise that
   * the cluster needs no box to keep to its cells, so it is never
   * given on another glyph's measurement. Nothing is cached while
   * fonts are still loading. */
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
    // The range's fit first: where it exists every glyph of the range
    // takes it and none needs measuring, which is most fonts.
    let fit: GlyphBox | null = null;
    const tiling = TILING.find((t) => t.range.test(cluster));
    if (tiling) fit = this.#tileFit(tiling.reference, context, font, tiling);
    else if (SHADE.test(cluster) && this.#tileFit(BLOCKS.reference, context, font, BLOCKS)) {
      // A shade fills its cell as the blocks do, with a lattice of its own.
      fit = this.#tileFit(cluster, context, font, { fills: true, patterned: true });
    }
    if (fit) return fit;
    const metrics = this.#measureText(cluster, context, font);
    const advance = metrics.width + letterSpacing;
    const target = cells * cellWidth;
    // The one way out unboxed, so it is the CLUSTER's own advance: a
    // fit above is its range's REFERENCE glyph's, which says nothing
    // about a cluster the font has not got — the VGA fonts draw `│` on
    // the cell and have no arc, whose substitute advances 9.633 in an
    // 8px cell. Within 0.01 cell is floating-point noise, which a box
    // would scale imperceptibly (WebKit's ★ and ✎ at 0.974).
    if (Math.abs(advance - target) <= 0.01 * cellWidth) return null;
    let scale = advance > 0 ? target / advance : 1;
    const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (inkWidth > 0) scale = Math.min(scale, target / inkWidth);
    if (inkHeight > 0) scale = Math.min(scale, cellHeight / inkHeight);
    scale = Math.round(scale * 1000) / 1000;
    return { scale, advance: Math.round(metrics.width * scale * 1000) / 1000 };
  }

  /** How far a shade's lattice moves in `row` so that it carries on
   * from the row above: down by the phase, or up by the rest of the
   * period when down would carry the glyph's content area off the
   * box's top and up keeps it past the bottom — a selection highlight
   * covers the content area, and the move must not bare the box. */
  shift(box: GlyphBox, row: number): number {
    const unit = (box.period ?? 0) * this.#dpr;
    if (!unit) return 0;
    const traveled = row * this.#cell.height * this.#dpr;
    const down = (unit - (traveled % unit)) % unit;
    const up = unit - down;
    const reach = box.reach;
    const goesUp = reach && down > reach.above * this.#dpr && up <= reach.below * this.#dpr;
    return (goesUp ? -up : down) / this.#dpr;
  }

  /** One fit per tiling range of a font: null when the font draws the
   * reference glyph on its cell and inside the row, else a box that
   * lands the glyph's baseline by a `line-height` and clips whatever
   * runs past. A `fills` range grows to a pixel and a half past the
   * row each side and centers its ink there; the rest keep the size
   * the font draws and take the row's own baseline, so a border sits
   * where the font sets it against the text. Either way the scale
   * carries the range's widest ink (box drawing's `level` `─`, else
   * the reference) OVERHANG past the cell's edge columns, and a
   * `patterned` glyph's is raised to whole device pixels of lattice.
   * The line-height (a line box sets the baseline at half-leading plus
   * the font's ascent) is corrected by the host's measured one. */
  #tileFit(
    reference: string,
    context: CanvasRenderingContext2D,
    font: string,
    kind: { level?: string; fills?: boolean; patterned?: boolean },
  ): GlyphBox | null {
    const { level, fills = false, patterned = false } = kind;
    const key = `${reference}|${font}`;
    let fit = this.#fits.get(key);
    if (fit !== undefined) return fit;
    const { width: cellWidth, height: cellHeight, letterSpacing, baseline } = this.#cell;
    const metrics = this.#measureText(reference, context, font);
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const offWidth = Math.abs(metrics.width + letterSpacing - cellWidth) > 0.01 * cellWidth;
    // Past the row its rows overlap, and two antialiased edges over
    // each other darken a band at every row's edge: the box clips it
    // back to its own row. Short of the row a filling glyph grows into
    // it; a stroke keeps the weight the font gives it, and its rows gap.
    const past = inkHeight > cellHeight + 0.05 && !offWidth;
    const short = fills && inkHeight < cellHeight - 0.05;
    fit = null;
    // A shade only reaches this having found the blocks a fit, and
    // takes a box of its own for the lattice.
    if ((short || offWidth || past || patterned) && inkHeight > 0) {
      // The range's widest ink over the cell by OVERHANG each side,
      // and never a shrink.
      const spanning = level === undefined ? metrics : this.#measureText(level, context, font);
      const inkWidth = spanning.actualBoundingBoxLeft + spanning.actualBoundingBoxRight;
      let scale = inkWidth > 0 ? Math.max((cellWidth + 2 * OVERHANG) / inkWidth, 1) : 1;
      // A filling glyph reaches a pixel and a half past the row each side.
      if (fills) scale = Math.max(scale, (cellHeight + 3) / inkHeight);
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
      const inkAscent = metrics.actualBoundingBoxAscent;
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      const rounded = Math.round(scale * 1000) / 1000;
      const box: GlyphBox = {
        scale: rounded,
        advance: Math.round(metrics.width * rounded * 1000) / 1000,
      };
      if (past) box.past = true;
      if (lattice) box.period = lattice;
      if (Number.isFinite(ascent + descent)) {
        // A filling glyph hangs its ink a pixel and a half past the row's
        // top, where a shade raised to its lattice lands as it did in the
        // row above; a stroke takes the row's own baseline, so a border
        // sits where the font sets it against the text.
        const hung = inkAscent * scale - 1.5;
        const pin = fills ? hung : (baseline ?? hung);
        let lineHeight = 2 * pin + scale * (descent - ascent);
        const measure = this.#baselineOf;
        if (measure) {
          // The engine's actual baseline at that line-height, which
          // moves half a pixel per pixel of it — stepped until the
          // nearest lands, where the engine snaps it to a pixel.
          const off = (at: number): number => measure(reference, rounded, at) - pin;
          let error = off(lineHeight);
          for (let step = 0; step < 3 && Math.abs(error) > 0.05; step++) {
            const next = lineHeight - 2 * error;
            const nextError = off(next);
            if (Math.abs(nextError) >= Math.abs(error)) break;
            lineHeight = next;
            error = nextError;
          }
        }
        box.lineHeight = Math.round(lineHeight * 100) / 100;
        if (lattice) {
          // The content area sits in the line box by its half-leading.
          const content = (ascent + descent) * scale;
          const top = (lineHeight - content) / 2;
          box.reach = {
            above: Math.round(-top * 100) / 100,
            below: Math.round((top + content - cellHeight) * 100) / 100,
          };
        }
      }
      fit = box;
    }
    // Cached even while fonts load: the measurement forces a layout,
    // and the host's `invalidate()` on `loadingdone` refreshes it.
    this.#fits.set(key, fit);
    return fit;
  }

  /** The vertical period of a glyph's lattice in px — the first peak of
   * the alpha's autocorrelation down the most patterned of a few
   * columns of the glyph (a dark shade's holes miss its middle), drawn
   * at four times the size on a canvas two of them square — or null
   * when nothing repeats or the canvas can't be read. */
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
    const { data } = context.getImageData(0, 0, side, side);
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
