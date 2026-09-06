import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphBoxes } from "../src/glyph-box.ts";

/** Glyph boxes (specs/wide-characters.md): a cluster the font draws
 * off its cell count is boxed and scaled, measured once per font. The
 * canvas is stubbed — happy-dom has none, which is also the headless
 * path: nothing boxed. */

type Metrics = {
  width: number;
  left?: number;
  right?: number;
  ascent?: number;
  descent?: number;
  /** A lattice, in px: the glyph draws as a square wave of this period. */
  period?: number;
};

/** The stubbed font's line-box ascent and descent, as a 16px font. */
const FONT_ASCENT = 13;
const FONT_DESCENT = 3;

function stubCanvas(glyphs: Record<string, Metrics>): { calls: string[] } {
  const calls: string[] = [];
  let drawn: Metrics | null = null;
  const context = {
    font: "",
    textBaseline: "",
    scale() {},
    measureText(cluster: string) {
      calls.push(cluster);
      const m = glyphs[cluster] ?? { width: 8 };
      return {
        width: m.width,
        actualBoundingBoxLeft: m.left ?? 0,
        actualBoundingBoxRight: m.right ?? m.width,
        actualBoundingBoxAscent: m.ascent ?? 10,
        actualBoundingBoxDescent: m.descent ?? 2,
        fontBoundingBoxAscent: FONT_ASCENT,
        fontBoundingBoxDescent: FONT_DESCENT,
      };
    },
    fillText(cluster: string) {
      drawn = glyphs[cluster] ?? null;
    },
    // The glyph at 4× from y = 32 (16px font: drawn at 8px): alpha rows
    // on and off in runs of half its period.
    getImageData(_x: number, _y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      const period = (drawn?.period ?? 0) * 4;
      const height = ((drawn?.ascent ?? 0) + (drawn?.descent ?? 0)) * 4;
      for (let y = 32; y < 32 + height && y < h; y++) {
        if (period && Math.floor(((y - 32) * 2) / period) % 2 === 0) {
          for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = 255;
        }
      }
      return { data };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  return { calls };
}

const font = { style: "normal", weight: "400", size: "16px", family: "monospace" };
const cell = { width: 8, height: 16, letterSpacing: 0 };

afterEach(() => vi.restoreAllMocks());

describe("GlyphBoxes", () => {
  it("boxes nothing without a canvas", () => {
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    expect(boxes.box("中", 2)).toBeNull();
  });

  it("leaves a cluster the font draws at its cells alone, boxes the rest scaled to fit", () => {
    const { calls } = stubCanvas({
      中: { width: 13.6, ascent: 10, descent: 2 },
      "★": { width: 10.4, right: 8 },
      "😀": { width: 16.6, right: 18, ascent: 15, descent: 3.5 },
      "→": { width: 8.05 },
      "✓": { width: 8.2 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    // 16 ÷ 13.6 = 1.176, ink 12 rows tall at that scale stays inside 16.
    expect(boxes.box("中", 2)).toEqual({ scale: 1.176 });
    // 8 ÷ 10.4 = 0.769; the ink (8) fits at that scale.
    expect(boxes.box("★", 1)).toEqual({ scale: 0.769 });
    // Fill scale 0.964, but the ink is 18.5 tall: 16 ÷ 18.5 wins.
    expect(boxes.box("😀", 2)).toEqual({ scale: 0.865 });
    // Within 0.01 cell: the font's own glyph. Beyond it, boxed — the
    // drift would add up along a line.
    expect(boxes.box("→", 1)).toBeNull();
    expect(boxes.box("✓", 1)).toEqual({ scale: 0.976 });
    // Measured once per cluster and font.
    boxes.box("中", 2);
    boxes.box("中", 2, { fontWeight: "700" });
    expect(calls).toEqual(["中", "★", "😀", "→", "✓", "中"]);
  });

  it("fits a block short of the row: one transform for the range, from the full block", () => {
    // Menlo at 14px in a 16px row: `█` is 14.27 tall, the font's line
    // box 13 + 3. Scale 19 ÷ 14.27; the box's line-height puts the ink
    // 1.5px above the row: 1.331 × (2 × 10.77 − 13 + 3) − 3.
    const { calls } = stubCanvas({
      "█": { width: 8, ascent: 10.77, descent: 3.5 },
      "░": { width: 8, ascent: 10.77, descent: 3.5, period: 2 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    const fit = { scale: 1.331, lineHeight: 12.37 };
    expect(boxes.box("█", 1)).toEqual(fit);
    expect(boxes.box("▀", 1)).toEqual(fit);
    expect(boxes.box("▟", 1)).toEqual(fit);
    // A shade with a 2px lattice: 1.331 would need 2.66 device pixels of
    // lattice, so 1.5, where it is three; 1.5 × (2 × 10.77 − 13 + 3) − 3.
    // Its content area, 24 tall, sits 4.85 above the box and 3.16 below.
    const shade = boxes.box("░", 1)!;
    expect(shade).toEqual({
      scale: 1.5,
      lineHeight: 14.31,
      period: 3,
      reach: { above: 4.85, below: 3.16 },
    });
    expect(calls).toEqual(["█", "░"]);
    // Row by row the lattice carries on: 16px rows against a 3px period,
    // down while the content area still covers the box's top.
    expect([0, 1, 2, 3].map((row) => boxes.shift(shade, row))).toEqual([0, 2, 1, 0]);
    // Past that reach, up by the rest when the bottom stays covered.
    const tight = { ...shade, reach: { above: 1, below: 2 } };
    expect([0, 1, 2].map((row) => boxes.shift(tight, row))).toEqual([0, -1, 1]);
    expect(boxes.shift({ scale: 1 }, 5)).toBe(0);
  });

  it("corrects the pin by the engine's measured baseline", () => {
    stubCanvas({ "█": { width: 8, ascent: 10.77, descent: 3.5 } });
    // The ink's top would land at −0.25 instead of −1.5: the box's
    // line-height gives back twice the difference.
    const boxes = new GlyphBoxes(() => 14.08);
    boxes.configure(font, cell);
    expect(boxes.box("█", 1)).toEqual({ scale: 1.331, lineHeight: 9.87 });
  });

  it("fits box-drawing glyphs from the font's `│`, apart from the blocks", () => {
    const { calls } = stubCanvas({
      "█": { width: 8, ascent: 15, descent: 4 },
      "│": { width: 8, ascent: 9, descent: 3 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    expect(boxes.box("█", 1)).toBeNull();
    // 19 ÷ 12; 1.583 × (18 − 13 + 3) − 3.
    const fit = { scale: 1.583, lineHeight: 9.67 };
    expect(boxes.box("│", 1)).toEqual(fit);
    expect(boxes.box("─", 1)).toEqual(fit);
    expect(boxes.box("┌", 1)).toEqual(fit);
    expect(calls).toEqual(["█", "│"]);
  });

  it("leaves a block that spans the row alone, and clips one drawn double-width", () => {
    stubCanvas({ "█": { width: 8, ascent: 15, descent: 4 } });
    const tall = new GlyphBoxes();
    tall.configure(font, cell);
    expect(tall.box("█", 1)).toBeNull();
    expect(tall.box("▄", 1)).toBeNull();
    expect(tall.box("▒", 1)).toBeNull();
    vi.restoreAllMocks();
    // A CJK fallback: the block is two cells wide and as tall as the row.
    stubCanvas({ "█": { width: 16, ascent: 12, descent: 4 } });
    const wide = new GlyphBoxes();
    wide.configure(font, cell);
    expect(wide.box("█", 1)).toEqual({ scale: 1.188, lineHeight: 13.63 });
  });

  it("forgets its measurements when the font or the cell changes, and on invalidate", () => {
    const { calls } = stubCanvas({ 中: { width: 13.6 } });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    boxes.box("中", 2);
    boxes.configure(font, cell);
    boxes.box("中", 2);
    expect(calls).toHaveLength(1);
    boxes.configure(font, { ...cell, width: 7 });
    boxes.box("中", 2);
    expect(calls).toHaveLength(2);
    boxes.invalidate();
    boxes.box("中", 2);
    expect(calls).toHaveLength(3);
  });

  it("does not cache while fonts are loading", () => {
    const { calls } = stubCanvas({ 中: { width: 13.6 } });
    // happy-dom has no document.fonts; stand one in for the test.
    const fonts = { status: "loading" };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    boxes.box("中", 2);
    boxes.box("中", 2);
    expect(calls).toHaveLength(2);
    fonts.status = "loaded";
    boxes.box("中", 2);
    boxes.box("中", 2);
    expect(calls).toHaveLength(3);
    // A tiling fit is cached even while loading (its measurement forces
    // a layout); `invalidate()` on `loadingdone` refreshes it.
    fonts.status = "loading";
    boxes.box("█", 1);
    boxes.box("▀", 1);
    expect(calls).toHaveLength(4);
    delete (document as { fonts?: unknown }).fonts;
  });
});
