import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphBoxes } from "../src/glyph-box.ts";

/** Glyph boxes (specs/wide-characters.md): a cluster the font draws
 * off its cell count is boxed and scaled, measured once per font. The
 * canvas is stubbed — happy-dom has none, which is also the headless
 * path: nothing boxed. */

type Metrics = { width: number; left?: number; right?: number; ascent?: number; descent?: number };

function stubCanvas(glyphs: Record<string, Metrics>): { calls: string[] } {
  const calls: string[] = [];
  const context = {
    font: "",
    measureText(cluster: string) {
      calls.push(cluster);
      const m = glyphs[cluster] ?? { width: 8 };
      return {
        width: m.width,
        actualBoundingBoxLeft: m.left ?? 0,
        actualBoundingBoxRight: m.right ?? m.width,
        actualBoundingBoxAscent: m.ascent ?? 10,
        actualBoundingBoxDescent: m.descent ?? 2,
      };
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
      "─": { width: 8.05 },
      "│": { width: 8.2 },
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
    expect(boxes.box("─", 1)).toBeNull();
    expect(boxes.box("│", 1)).toEqual({ scale: 0.976 });
    // Measured once per cluster and font.
    boxes.box("中", 2);
    boxes.box("中", 2, { fontWeight: "700" });
    expect(calls).toEqual(["中", "★", "😀", "─", "│", "中"]);
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
    delete (document as { fonts?: unknown }).fonts;
  });
});
