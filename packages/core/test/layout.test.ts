import { describe, expect, it } from "vitest";
import { distributeInteger, resolveFlexMainAxis } from "../src/layout.ts";

describe("distributeInteger", () => {
  it("returns zeros when total is 0 or negative", () => {
    expect(distributeInteger([1, 1, 1], 0)).toEqual([0, 0, 0]);
    expect(distributeInteger([1, 1, 1], -5)).toEqual([0, 0, 0]);
  });

  it("returns zeros when all weights are 0", () => {
    expect(distributeInteger([0, 0, 0], 10)).toEqual([0, 0, 0]);
  });

  it("distributes equally when weights are equal", () => {
    expect(distributeInteger([1, 1], 10)).toEqual([5, 5]);
    expect(distributeInteger([1, 1, 1], 9)).toEqual([3, 3, 3]);
  });

  it("distributes remainder deterministically by largest fractional part", () => {
    // 10 / 3 = 3.33 each → floored [3, 3, 3], deficit 1
    // Fractional parts equal, so tie-break by document order → index 0 gets +1
    expect(distributeInteger([1, 1, 1], 10)).toEqual([4, 3, 3]);
  });

  it("distributes proportionally to weights", () => {
    // Weights [1, 3], total 8 → raw [2, 6] → [2, 6]
    expect(distributeInteger([1, 3], 8)).toEqual([2, 6]);
    // Weights [1, 2], total 10 → raw [3.33, 6.67] → floored [3, 6], deficit 1
    // Fractional: [0.33, 0.67] → index 1 wins → [3, 7]
    expect(distributeInteger([1, 2], 10)).toEqual([3, 7]);
  });

  it("gives leading fractional parts priority on ties", () => {
    // Weights [2, 2, 2], total 7 → raw [2.33, 2.33, 2.33] → [2, 2, 2] +1 to index 0
    expect(distributeInteger([2, 2, 2], 7)).toEqual([3, 2, 2]);
  });

  it("sums to total exactly", () => {
    for (const total of [1, 7, 13, 100, 1000]) {
      const weights = [1, 2, 3, 5, 8];
      const result = distributeInteger(weights, total);
      expect(result.reduce((s, v) => s + v, 0)).toBe(total);
    }
  });
});

describe("resolveFlexMainAxis", () => {
  const item = (intrinsic: number, grow = 0, shrink = 1) => ({ intrinsic, grow, shrink });

  it("returns intrinsics when total exactly fits", () => {
    expect(resolveFlexMainAxis([item(10), item(15)], 25)).toEqual([10, 15]);
  });

  it("grows items proportionally to flex-grow", () => {
    // Total intrinsic 20, available 30, extra 10 distributed to grow=1 items
    expect(resolveFlexMainAxis([item(10, 1), item(10, 1)], 30)).toEqual([15, 15]);
    // Only one item grows; leftover all to it
    expect(resolveFlexMainAxis([item(10, 0), item(10, 1)], 30)).toEqual([10, 20]);
    // Grow weights [1, 3] on extra 8 → [2, 6]
    expect(resolveFlexMainAxis([item(10, 1), item(10, 3)], 28)).toEqual([12, 16]);
  });

  it("keeps intrinsic if extra space but no grow", () => {
    expect(resolveFlexMainAxis([item(10), item(10)], 50)).toEqual([10, 10]);
  });

  it("shrinks items proportionally to intrinsic × shrink", () => {
    // 10 + 20 = 30 intrinsic, available 24, shortfall 6
    // Weights: 10*1=10, 20*1=20, total 30 → shares [2, 4]
    expect(resolveFlexMainAxis([item(10, 0, 1), item(20, 0, 1)], 24)).toEqual([8, 16]);
  });

  it("respects flex-shrink: 0 (item keeps intrinsic even on overflow)", () => {
    // First item shrink=0 keeps 10; second absorbs shortfall
    // Available 15, intrinsics [10, 10], shortfall 5. shrink-weights: [0, 10]
    // → shares [0, 5] → widths [10, 5]
    expect(resolveFlexMainAxis([item(10, 0, 0), item(10, 0, 1)], 15)).toEqual([10, 5]);
  });

  it("keeps intrinsics when all items are shrink: 0 (row overflows)", () => {
    expect(resolveFlexMainAxis([item(10, 0, 0), item(20, 0, 0)], 15)).toEqual([10, 20]);
  });

  it("clamps shrunk widths at 0", () => {
    // Extreme shortfall — an item can't go below 0
    const result = resolveFlexMainAxis([item(5, 0, 1), item(5, 0, 1)], 0);
    expect(result.every((w) => w >= 0)).toBe(true);
    expect(result.reduce((s, w) => s + w, 0)).toBeLessThanOrEqual(5);
  });
});
