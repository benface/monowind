import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLYPHS,
  encode,
  pack,
  renderQr,
  resolveGlyphs,
  scaleUp,
  snapAspect,
} from "../src/render.ts";
import type { Level } from "../src/render.ts";

/** The pure pipeline (specs/qr-code.md): encoding, scaling, and
 * packing into cells. */

const T = true;
const F = false;
const cross = [
  [F, T, F],
  [T, T, T],
  [F, T, F],
];

describe("encode", () => {
  it("picks the smallest version and raises the level as far as it fits", () => {
    const short = encode("12345", "L")!;
    expect(short.version).toBe(1);
    expect(short.modules).toHaveLength(21);
    expect(short.level).toBe("H");
    const url = encode("https://play.monowind.benface.com", "M")!;
    expect(url.version).toBe(3);
    expect(url.modules[0]).toHaveLength(29);
    expect(url.level).toBe("M");
  });

  it("never lowers the requested level, and versions grow with the level", () => {
    const value = "https://play.monowind.benface.com/some/long/path?with=query";
    const order: Level[] = ["L", "M", "Q", "H"];
    let last = 0;
    for (const level of order) {
      const encoded = encode(value, level)!;
      expect(order.indexOf(encoded.level)).toBeGreaterThanOrEqual(order.indexOf(level));
      expect(encoded.version).toBeGreaterThanOrEqual(last);
      last = encoded.version;
    }
  });

  it("returns null past version 40", () => {
    expect(encode("x".repeat(3000), "L")).toBeNull();
    expect(encode("x".repeat(2953), "L")).not.toBeNull();
  });
});

describe("scaleUp", () => {
  it("repeats every module n × n", () => {
    const scaled = scaleUp(cross, 2);
    expect(scaled.map((row) => row.map(Number).join(""))).toEqual([
      "001100",
      "001100",
      "111111",
      "111111",
      "001100",
      "001100",
    ]);
    expect(scaleUp(cross, 1)).toBe(cross);
  });
});

describe("pack", () => {
  it("packs two module rows per cell with half blocks at aspect 2", () => {
    expect(pack(cross, 2, DEFAULT_GLYPHS)).toEqual(["▄█▄", " ▀ "]);
    expect(pack([[T, F, T]], 2, DEFAULT_GLYPHS)).toEqual(["▀ ▀"]);
    expect(pack(scaleUp(cross, 2), 2, DEFAULT_GLYPHS)).toEqual(["  ██  ", "██████", "  ██  "]);
  });

  it("repeats each half block across the cells of a taller aspect", () => {
    expect(pack(cross, 4, DEFAULT_GLYPHS)).toEqual(["▄▄██▄▄", "  ▀▀  "]);
    expect(pack(cross, 6, DEFAULT_GLYPHS)).toEqual(["▄▄▄███▄▄▄", "   ▀▀▀   "]);
  });

  it("packs one module per cell at aspect 1 and rows per module below it", () => {
    expect(pack(cross, 1, DEFAULT_GLYPHS)).toEqual([" █ ", "███", " █ "]);
    expect(pack(cross, 0.5, DEFAULT_GLYPHS)).toEqual([" █ ", " █ ", "███", "███", " █ ", " █ "]);
    expect(pack([[T, F]], 1 / 3, DEFAULT_GLYPHS)).toEqual(["█ ", "█ ", "█ "]);
  });

  it("draws a module `aspect` cells wide when the set has no halves", () => {
    expect(pack(cross, 2, { full: "#" })).toEqual(["  ##  ", "######", "  ##  "]);
    expect(pack(cross, 4, { full: "#" })).toEqual(["    ####    ", "############", "    ####    "]);
    expect(pack(cross, 1, { full: "#" })).toEqual([" # ", "###", " # "]);
  });
});

describe("snapAspect and resolveGlyphs", () => {
  it("snaps measured ratios to the nearest packing", () => {
    expect(snapAspect(2.38)).toBe(2);
    expect(snapAspect(1.5)).toBe(2);
    expect(snapAspect(2.9)).toBe(2);
    expect(snapAspect(3)).toBe(4);
    expect(snapAspect(4)).toBe(4);
    expect(snapAspect(5.2)).toBe(6);
    expect(snapAspect(1.49)).toBe(1);
    expect(snapAspect(0.76)).toBe(1);
    expect(snapAspect(0.75)).toBe(0.5);
    expect(snapAspect(0.3)).toBe(1 / 3);
  });

  it("reads a set's roles with defaults, and drops the halves for a full-only set", () => {
    expect(resolveGlyphs(undefined)).toEqual(DEFAULT_GLYPHS);
    expect(resolveGlyphs({ solid: { h: "-" } })).toEqual(DEFAULT_GLYPHS);
    expect(resolveGlyphs({ solid: { qrFull: "#" } })).toEqual({ full: "#" });
    expect(resolveGlyphs({ solid: { qrFull: "@", qrUpper: "^", qrLower: "v" } })).toEqual({
      full: "@",
      upper: "^",
      lower: "v",
    });
    expect(resolveGlyphs({ solid: { qrUpper: "^", qrLower: "v" } })).toEqual({
      full: "█",
      upper: "^",
      lower: "v",
    });
  });
});

describe("renderQr", () => {
  it("renders a version-1 code as 21 × 11, the finder in the corner", () => {
    const rows = renderQr("12345", { level: "M", scale: 1, aspect: 2, glyphs: DEFAULT_GLYPHS })!;
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([21]));
    expect(rows[0]!.slice(0, 7)).toBe("█▀▀▀▀▀█");
  });

  it("returns null for a value that does not fit", () => {
    expect(
      renderQr("x".repeat(3000), { level: "H", scale: 1, aspect: 2, glyphs: DEFAULT_GLYPHS }),
    ).toBeNull();
  });
});
