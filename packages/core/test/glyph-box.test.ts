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
    // The glyph at 4×: a lattice from y = 32 (16px font: drawn from
    // 8px down), alpha rows on and off in runs of half its period.
    getImageData(_x: number, _y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      const fill = (y: number) => {
        for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = 255;
      };
      const period = (drawn?.period ?? 0) * 4;
      const height = ((drawn?.ascent ?? 0) + (drawn?.descent ?? 0)) * 4;
      for (let y = 32; y < 32 + height && y < h; y++) {
        if (period && Math.floor(((y - 32) * 2) / period) % 2 === 0) fill(y);
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
    expect(boxes.box("中", 2)).toEqual({ scale: 1.176, advance: 15.994 });
    // 8 ÷ 10.4 = 0.769; the ink (8) fits at that scale.
    expect(boxes.box("★", 1)).toEqual({ scale: 0.769, advance: 7.998 });
    // Fill scale 0.964, but the ink is 18.5 tall: 16 ÷ 18.5 wins.
    expect(boxes.box("😀", 2)).toEqual({ scale: 0.865, advance: 14.359 });
    // Within 0.01 cell: the font's own glyph. Beyond it, boxed — the
    // drift would add up along a line.
    expect(boxes.box("→", 1)).toBeNull();
    expect(boxes.box("✓", 1)).toEqual({ scale: 0.976, advance: 8.003 });
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
    const fit = { scale: 1.331, lineHeight: 12.37, advance: 10.648 };
    expect(boxes.box("█", 1)).toEqual(fit);
    expect(boxes.box("▀", 1)).toEqual(fit);
    expect(boxes.box("▟", 1)).toEqual(fit);
    // A shade with a 2px lattice: 1.331 would need 2.66 device pixels of
    // lattice, so 1.5, where it is three; 1.5 × (2 × 10.77 − 13 + 3) − 3.
    const shade = boxes.box("░", 1)!;
    expect(shade).toEqual({ scale: 1.5, lineHeight: 14.31, advance: 12, period: 3 });
    // One measurement for the range, none per glyph: the fit exists,
    // so no cluster needs its own advance.
    expect(calls).toEqual(["█", "░"]);
    // Row by row the lattice carries on: 16px rows against a 3px period.
    expect([0, 1, 2, 3].map((row) => boxes.shift(shade, row))).toEqual([0, 2, 1, 0]);
    expect(boxes.shift({ scale: 1, advance: 8 }, 5)).toBe(0);
  });

  it("leaves a stroke short of the row at the weight the font gives it", () => {
    // A stroke stands for a line, and growing one to fill the row makes
    // it as much bolder as the row is taller than the glyph: `│` 15 tall
    // in a 16px row keeps its size, and the rows gap. A block stands for
    // a cell filled and grows into the row.
    const { calls } = stubCanvas({
      "█": { width: 8, ascent: 10.77, descent: 3.5 },
      "│": { width: 8, ascent: 11, descent: 4 },
      "─": { width: 8 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, { ...cell, baseline: 13 });
    expect(boxes.box("┌", 1)).toBeNull();
    expect(boxes.box("│", 1)).toBeNull();
    expect(boxes.box("█", 1)).toEqual({ scale: 1.331, lineHeight: 12.37, advance: 10.648 });
    expect(calls).toEqual(["│", "┌", "│", "█"]);
  });

  it("boxes a stroke the font draws past the row, on the row's own baseline", () => {
    // `│` 17 tall in a 16px row on a baseline at 13: boxed to clip the
    // overshoot, at the 1.113 that carries the level `─` 0.45px
    // past the cell's edge columns, and pinned to that baseline.
    stubCanvas({
      "│": { width: 8, ascent: 13, descent: 4 },
      "─": { width: 8, right: 8 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, { ...cell, baseline: 13 });
    const fit = { scale: 1.113, past: true, lineHeight: 14.88, advance: 8.904 };
    expect(boxes.box("│", 1)).toEqual(fit);
    expect(boxes.box("┌", 1)).toEqual(fit);
  });

  it("corrects the pin by the engine's measured baseline", () => {
    stubCanvas({ "█": { width: 8, ascent: 10.77, descent: 3.5 } });
    // The ink's top would land at −0.25 instead of −1.5: the box's
    // line-height gives back twice the difference (the engine here
    // moves the baseline half a pixel per pixel of line-height).
    const boxes = new GlyphBoxes((_glyph, _scale, lineHeight) => lineHeight / 2 + 7.895);
    boxes.configure(font, cell);
    expect(boxes.box("█", 1)).toEqual({ scale: 1.331, lineHeight: 9.89, advance: 10.648 });
  });

  it("fits box-drawing glyphs from the font's `│`, apart from the blocks", () => {
    const { calls } = stubCanvas({
      "█": { width: 8, ascent: 15, descent: 4 },
      "│": { width: 8, ascent: 11, descent: 6 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    // The block's own ink is 19 in a 16px row — past it, so its rows
    // would overlap: 19 ÷ 19 held to 1.08, pinned by 1.08 × (30 − 13 +
    // 3) − 3.
    expect(boxes.box("█", 1)).toEqual({
      scale: 1.113,
      past: true,
      lineHeight: 19.25,
      advance: 8.904,
    });
    // Its own range, from its own ink: `│` is 17 tall in the 16px row,
    // past it, so it is boxed to be clipped — at the 1.113 that carries
    // the level `─` past the cell's edge columns, not at a scale that
    // would fill the row and thicken the stroke with it.
    const fit = { scale: 1.113, past: true, lineHeight: 10.35, advance: 8.904 };
    expect(boxes.box("│", 1)).toEqual(fit);
    expect(boxes.box("─", 1)).toEqual(fit);
    expect(boxes.box("┌", 1)).toEqual(fit);
    expect(calls).toEqual(["█", "│", "─"]);
  });

  it("boxes a cluster its font lacks, though the range needs no fit", () => {
    // The VGA bitmap fonts draw `│` and `─` on the cell and have no arc
    // at all: the arc falls back to another font at another advance,
    // and unboxed it would carry 1.6px of drift to the rest of the row.
    const { calls } = stubCanvas({
      "│": { width: 8, ascent: 12, descent: 4 },
      "─": { width: 8, ascent: 8.5, descent: -7.5 },
      "╭": { width: 9.633, ascent: 8, descent: 2 },
    });
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    expect(boxes.box("│", 1), "drawn on its cell, so left alone").toBeNull();
    expect(boxes.box("─", 1), "likewise").toBeNull();
    const arc = boxes.box("╭", 1);
    expect(arc, "off its cell, so boxed onto it").not.toBeNull();
    expect(arc!.advance).toBeLessThanOrEqual(8);
    expect(calls).toContain("╭");
  });

  it("boxes a block drawn past the row, leaving one drawn at its height", () => {
    // Unboxed, its rows overlap and paint each other's antialiased
    // edges: a darker band at every row's edge (SF Mono draws `│`
    // 17.84 tall in a 16px row, JetBrains Mono's `█` 19 in 18).
    stubCanvas({ "█": { width: 8, ascent: 15, descent: 4 } });
    const tall = new GlyphBoxes();
    tall.configure(font, cell);
    // Held to 1.08, the least overhang that keeps every joint whole.
    const fit = { scale: 1.113, past: true, lineHeight: 19.25, advance: 8.904 };
    expect(tall.box("█", 1)).toEqual(fit);
    expect(tall.box("▄", 1)).toEqual(fit);
    // A shade tiles with the blocks, so it is boxed whenever they are,
    // at its own fit: 19 ÷ 12; 1.583 × (20 − 13 + 3) − 3.
    expect(tall.box("▒", 1)).toEqual({ scale: 1.583, lineHeight: 12.83, advance: 12.664 });
    vi.restoreAllMocks();
    // Drawn at the row's height, within a twentieth of a pixel, and at
    // its cell's width: the font's own glyph tiles, and is left alone.
    stubCanvas({ "█": { width: 8, ascent: 12, descent: 4 } });
    const exact = new GlyphBoxes();
    exact.configure(font, cell);
    expect(exact.box("█", 1)).toBeNull();
    expect(exact.box("▄", 1)).toBeNull();
    vi.restoreAllMocks();
    // A CJK fallback: the block is two cells wide and as tall as the row,
    // clipped to its cell so it stays off the next one.
    stubCanvas({ "█": { width: 16, ascent: 12, descent: 4 } });
    const wide = new GlyphBoxes();
    wide.configure(font, cell);
    expect(wide.box("█", 1)).toEqual({ scale: 1.188, lineHeight: 13.63, advance: 19.008 });
    vi.restoreAllMocks();
    // Past the row AND off its cell width takes no `past`: the width
    // fit is needed in any layer, resampled or not.
    stubCanvas({ "█": { width: 16, ascent: 15, descent: 4 } });
    const both = new GlyphBoxes();
    both.configure(font, cell);
    expect(both.box("█", 1)).toEqual({ scale: 1, lineHeight: 17, advance: 16 });
  });

  it("forgets its measurements when the font or the cell changes", () => {
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
  });

  it("forgets them on invalidate only where the font draws differently", () => {
    // `document.fonts` settles on every page, loaded font or not, and a
    // paint told its fits are stale restyles every box it holds: every
    // glyph a measurement came from is measured again, and nothing is
    // forgotten while they all draw as they did.
    const drawn: Record<string, { width: number }> = { 中: { width: 13.6 } };
    const { calls } = stubCanvas(drawn);
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    boxes.box("中", 2);
    const generation = boxes.generation;
    boxes.invalidate();
    boxes.box("中", 2);
    // The one cached cluster measured again, and its box kept.
    expect(calls).toHaveLength(2);
    expect(boxes.generation).toBe(generation);
    // A font that arrives draws it differently, and everything goes.
    drawn["中"]!.width = 12;
    boxes.invalidate();
    boxes.box("中", 2);
    expect(calls).toHaveLength(4);
    expect(boxes.generation).toBe(generation + 1);
  });

  it("forgets nothing on invalidate with nothing measured", () => {
    // A page of plain text measures no glyph, and a font settling asks
    // no paint to refit its boxes.
    const { calls } = stubCanvas({});
    const boxes = new GlyphBoxes();
    boxes.configure(font, cell);
    const generation = boxes.generation;
    boxes.invalidate();
    expect(calls).toEqual([]);
    expect(boxes.generation).toBe(generation);
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
