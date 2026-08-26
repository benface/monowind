import { describe, expect, it } from "vitest";
import { percentToCells, pxToCells, roundHalfAwayFromZero } from "../src/metrics.ts";

describe("roundHalfAwayFromZero", () => {
  it("rounds positive halves up", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
  });

  it("rounds negative halves away from zero", () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
  });

  it("keeps integers", () => {
    expect(roundHalfAwayFromZero(0)).toBe(0);
    expect(roundHalfAwayFromZero(3)).toBe(3);
    expect(roundHalfAwayFromZero(-7)).toBe(-7);
  });

  it("rounds toward-zero fractions down", () => {
    expect(roundHalfAwayFromZero(0.4)).toBe(0);
    expect(roundHalfAwayFromZero(1.4)).toBe(1);
    expect(roundHalfAwayFromZero(-0.4)).toBe(0);
    expect(roundHalfAwayFromZero(-1.4)).toBe(-1);
  });
});

describe("pxToCells", () => {
  const root = 16;

  it("converts Tailwind spacing units to cell counts", () => {
    expect(pxToCells(0, root)).toBe(0);
    expect(pxToCells(1, root)).toBe(0); // p-px rounds down
    expect(pxToCells(2, root)).toBe(1); // p-0.5 rounds up
    expect(pxToCells(4, root)).toBe(1); // p-1
    expect(pxToCells(6, root)).toBe(2); // p-1.5 rounds up
    expect(pxToCells(8, root)).toBe(2); // p-2
    expect(pxToCells(80, root)).toBe(20); // w-20
  });

  it("handles negatives symmetrically", () => {
    expect(pxToCells(-2, root)).toBe(-1);
    expect(pxToCells(-4, root)).toBe(-1);
    expect(pxToCells(-6, root)).toBe(-2);
  });

  it("scales with root font size", () => {
    expect(pxToCells(4, 20)).toBe(1); // 4 / (0.25 * 20) = 0.8 → 1
    expect(pxToCells(4, 12)).toBe(1); // 4 / (0.25 * 12) = 1.33 → 1
  });

  it("returns 0 for zero or negative root", () => {
    expect(pxToCells(4, 0)).toBe(0);
    expect(pxToCells(4, -16)).toBe(0);
  });
});

describe("percentToCells", () => {
  it("rounds to nearest cell", () => {
    expect(percentToCells(50, 10)).toBe(5);
    expect(percentToCells(50, 11)).toBe(6); // 5.5 → 6
    expect(percentToCells(33.3, 3)).toBe(1); // 0.999 → 1
    expect(percentToCells(66.7, 3)).toBe(2); // 2.001 → 2
  });

  it("handles 0 and 100", () => {
    expect(percentToCells(0, 20)).toBe(0);
    expect(percentToCells(100, 20)).toBe(20);
  });
});
