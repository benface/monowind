import { describe, expect, it } from "vitest";
import decodeQR from "qr/decode.js";
import { DEFAULT_GLYPHS, renderQr } from "../src/render.ts";
import type { Aspect, Level, QrGlyphs } from "../src/render.ts";

/** Scannability (specs/qr-code.md "Testing"): every packing read back
 * by a decoder from a raster of its glyphs — a cell 6 px wide and
 * `aspect` times as tall, its halves split, inside the quiet zone the
 * element's padding gives on screen. */

const PX = 6;
const QUIET = 8 * PX;

/** Rows of cells → an image, dark ink on light or the reverse. */
function raster(rows: string[], aspect: Aspect, glyphs: QrGlyphs, inverted = false) {
  const cellHeight = Math.round(aspect * PX);
  const width = rows[0]!.length * PX + 2 * QUIET;
  const height = rows.length * cellHeight + 2 * QUIET;
  const data = new Uint8ClampedArray(width * height * 4).fill(inverted ? 0 : 255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const paint = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = inverted ? 255 : 0;
      }
    }
  };
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row) {
      const x = QUIET + col * PX;
      const y = QUIET + r * cellHeight;
      if (cell === glyphs.full) paint(x, y, PX, cellHeight);
      else if (cell === glyphs.upper) paint(x, y, PX, cellHeight / 2);
      else if (cell === glyphs.lower) paint(x, y + cellHeight / 2, PX, cellHeight / 2);
      col++;
    }
  });
  return { width, height, data };
}

const decoded = (rows: string[], aspect: Aspect, glyphs = DEFAULT_GLYPHS, inverted = false) =>
  decodeQR(raster(rows, aspect, glyphs, inverted));

const VALUE = "https://play.monowind.benface.com";

describe("decoding the rendered code", () => {
  it("reads every aspect and both polarities", () => {
    for (const aspect of [4, 2, 1, 0.5, 1 / 3] as Aspect[]) {
      const rows = renderQr(VALUE, { level: "M", scale: 1, aspect, glyphs: DEFAULT_GLYPHS })!;
      expect(decoded(rows, aspect), `aspect ${aspect}`).toBe(VALUE);
      expect(decoded(rows, aspect, DEFAULT_GLYPHS, true), `inverted ${aspect}`).toBe(VALUE);
    }
  });

  it("reads every level, scale 2, a long value, and the two-cell fallback", () => {
    for (const level of ["L", "M", "Q", "H"] as Level[]) {
      const rows = renderQr(VALUE, { level, scale: 1, aspect: 2, glyphs: DEFAULT_GLYPHS })!;
      expect(decoded(rows, 2), level).toBe(VALUE);
    }
    const scaled = renderQr(VALUE, { level: "M", scale: 2, aspect: 2, glyphs: DEFAULT_GLYPHS })!;
    expect(decoded(scaled, 2)).toBe(VALUE);
    const long = `${VALUE}/?session=${"0123456789abcdef".repeat(12)}`;
    const big = renderQr(long, { level: "M", scale: 1, aspect: 2, glyphs: DEFAULT_GLYPHS })!;
    expect(big.length).toBeGreaterThan(30);
    expect(decoded(big, 2)).toBe(long);
    const ascii = renderQr(VALUE, { level: "M", scale: 1, aspect: 2, glyphs: { full: "#" } })!;
    expect(decoded(ascii, 2, { full: "#" })).toBe(VALUE);
  });
});
