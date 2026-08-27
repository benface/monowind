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
  const item = (intrinsic: number, grow = 0, shrink = 1, min?: number, max?: number) => ({
    intrinsic,
    grow,
    shrink,
    min,
    max,
  });

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

  // §9.7 freeze loop: violators freeze at their clamp and the remainder
  // redistributes among the rest.
  it("shrink: a min-violating item freezes and siblings absorb the rest", () => {
    // 20+20 into 24; equal shrink would give 12+12, min 16 freezes the
    // first → second re-shrinks to 8.
    expect(resolveFlexMainAxis([item(20, 0, 1, 16), item(20, 0, 1)], 24)).toEqual([16, 8]);
  });

  it("grow: a max-violating item freezes and siblings absorb the rest", () => {
    // 1+1 into 30; equal grow would give 15+15, max 5 caps the first →
    // second takes 25.
    expect(resolveFlexMainAxis([item(1, 1, 1, undefined, 5), item(1, 1, 1)], 30)).toEqual([5, 25]);
  });

  it("grow: a base below its min stays flexible and distribution is unaffected", () => {
    // Regression: bases must NOT be pre-clamped up to min — flex-1 (base
    // 0) items with content minimums would otherwise end up unequal.
    expect(resolveFlexMainAxis([item(0, 1, 1, 9), item(0, 1, 1, 4)], 30)).toEqual([15, 15]);
  });

  it("grow: the min still applies when the grown size falls short of it", () => {
    // Bases 0, available 10 → 5+5, but min 8 on the first violates → it
    // freezes at 8 and the second gets base + remaining 2.
    expect(resolveFlexMainAxis([item(0, 1, 1, 8), item(0, 1, 1)], 10)).toEqual([8, 2]);
  });

  it("inflexible items freeze at their clamped (hypothetical) size", () => {
    // grow 0 with base 10 above max 6 → frozen at 6; flexible sibling
    // takes the rest of 30.
    expect(resolveFlexMainAxis([item(10, 0, 0, undefined, 6), item(1, 1, 1)], 30)).toEqual([6, 24]);
  });

  it("everything frozen by clamps may underfill or overflow the line", () => {
    // Both capped below the equal-grow target: line underfills (justify
    // sees the leftover), sizes stay at their maxes.
    expect(
      resolveFlexMainAxis([item(1, 1, 1, undefined, 4), item(1, 1, 1, undefined, 4)], 30),
    ).toEqual([4, 4]);
  });
});
