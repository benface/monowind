import type { CellPaint } from "./plain-text.ts";

/**
 * Which clusters the grid's font draws off their cell count, and how
 * to fit them (specs/wide-characters.md "The grid stays on its cells
 * in any font"): each distinct non-ASCII cluster is measured once per
 * font — family, size, weight, and style — with canvas `measureText`.
 * A mismatch is painted in a box of exactly its cells, the glyph
 * scaled to fill the box, capped so its ink stays inside the row and
 * the box. Without a canvas (headless tests) nothing is boxed.
 */
export class GlyphBoxes {
  #boxes = new Map<string, { scale: number } | null>();
  #context: CanvasRenderingContext2D | null | undefined;
  #font = { style: "normal", weight: "400", size: "16px", family: "monospace" };
  #cell = { width: 0, height: 0, letterSpacing: 0 };

  /** The grid's font and cell; a change forgets every measurement. */
  configure(
    font: { style: string; weight: string; size: string; family: string },
    cell: { width: number; height: number; letterSpacing: number },
  ): void {
    const same =
      font.style === this.#font.style &&
      font.weight === this.#font.weight &&
      font.size === this.#font.size &&
      font.family === this.#font.family &&
      cell.width === this.#cell.width &&
      cell.height === this.#cell.height &&
      cell.letterSpacing === this.#cell.letterSpacing;
    if (same) return;
    this.#font = { ...font };
    this.#cell = { ...cell };
    this.#boxes.clear();
  }

  /** Forget every measurement: a font finished loading, so the same
   * cluster may draw differently now (the fallback's measurements would
   * otherwise stay cached under the same font name). */
  invalidate(): void {
    this.#boxes.clear();
  }

  /** The box for a cluster painted with `paint`, or null when the font
   * draws it at `cells` cells within 0.01 cell. Nothing is cached while
   * fonts are still loading. */
  box(cluster: string, cells: number, paint?: CellPaint): { scale: number } | null {
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

  #measure(cluster: string, cells: number, font: string): { scale: number } | null {
    const context = this.#canvas();
    const { width: cellWidth, height: cellHeight, letterSpacing } = this.#cell;
    if (!context || cellWidth <= 0 || cellHeight <= 0) return null;
    context.font = font;
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
