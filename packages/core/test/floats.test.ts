import { describe, expect, it } from "vitest";
import { bandAt, clearanceBelow, firstFit, floatsBottom, placeFloat } from "../src/floats.ts";
import type { FloatBox } from "../src/floats.ts";

/** Float geometry (specs/float.md): exclusion rectangles in a
 * container's content-box cells and the queries block layout makes. */

const left = (x: number, y: number, width: number, height: number): FloatBox => ({
  x,
  y,
  width,
  height,
  side: "left",
});
const right = (x: number, y: number, width: number, height: number): FloatBox => ({
  x,
  y,
  width,
  height,
  side: "right",
});

describe("bandAt", () => {
  it("leaves the cells past the left floats and short of the right ones on a row", () => {
    const boxes = [left(0, 0, 7, 3), right(33, 1, 7, 2)];
    expect(bandAt(boxes, 40, 0)).toEqual({ x: 7, width: 33 });
    expect(bandAt(boxes, 40, 1)).toEqual({ x: 7, width: 26 });
    expect(bandAt(boxes, 40, 3)).toEqual({ x: 0, width: 40 });
    // A taller line box meets every float it overlaps.
    expect(bandAt(boxes, 40, 0, 2)).toEqual({ x: 7, width: 26 });
    // Floats meeting in the middle leave nothing.
    expect(bandAt([left(0, 0, 20, 1), right(20, 0, 20, 1)], 40, 0)).toEqual({ x: 20, width: 0 });
  });
});

describe("placeFloat (CSS 2.1 §9.5.1)", () => {
  it("takes the cursor row at the edge, beside earlier floats when it fits", () => {
    expect(placeFloat([], 40, "left", 0, 7, 3)).toEqual({ x: 0, y: 0 });
    expect(placeFloat([], 40, "right", 2, 7, 3)).toEqual({ x: 33, y: 2 });
    const one = [left(0, 0, 7, 2)];
    expect(placeFloat(one, 40, "left", 0, 4, 3)).toEqual({ x: 7, y: 0 });
    expect(placeFloat(one, 40, "right", 0, 10, 1)).toEqual({ x: 30, y: 0 });
  });

  it("drops below the shallowest float in the way when it does not fit", () => {
    const boxes = [left(0, 0, 7, 3), left(7, 0, 4, 2)];
    // 29 cells remain beside both, 33 below the shallower second, 40
    // below both.
    expect(placeFloat(boxes, 40, "left", 0, 28, 1)).toEqual({ x: 11, y: 0 });
    expect(placeFloat(boxes, 40, "left", 0, 30, 1)).toEqual({ x: 7, y: 2 });
    expect(placeFloat(boxes, 40, "left", 0, 35, 1)).toEqual({ x: 0, y: 3 });
    // Never above an earlier float's top, even from an earlier cursor —
    // a rule for floats alone: a root's first fit starts at its own top.
    expect(placeFloat([left(0, 2, 7, 1)], 40, "right", 0, 5, 1)).toEqual({ x: 35, y: 2 });
    expect(firstFit([left(0, 2, 7, 1)], 40, "right", 0, 5, 1)).toEqual({ x: 35, y: 0 });
  });

  it("starts a float wider than the content box at the edge, overflowing", () => {
    expect(placeFloat([], 40, "left", 1, 50, 1)).toEqual({ x: 0, y: 1 });
    expect(placeFloat([left(0, 0, 7, 2)], 40, "right", 0, 50, 1)).toEqual({ x: 0, y: 2 });
  });
});

describe("clearanceBelow", () => {
  it("moves a box below the named side's floats when they reach past it", () => {
    const boxes = [left(0, 0, 7, 3), right(33, 0, 7, 5)];
    expect(clearanceBelow(boxes, "none", 1)).toBe(1);
    expect(clearanceBelow(boxes, "left", 1)).toBe(3);
    expect(clearanceBelow(boxes, "right", 1)).toBe(5);
    expect(clearanceBelow(boxes, "both", 1)).toBe(5);
    expect(clearanceBelow(boxes, "both", 6)).toBe(6);
  });
});

describe("floatsBottom", () => {
  it("is the lowest float bottom, or zero", () => {
    expect(floatsBottom([])).toBe(0);
    expect(floatsBottom([left(0, 1, 7, 3), right(33, 0, 7, 2)])).toBe(4);
  });
});
