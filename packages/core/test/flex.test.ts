import { describe, expect, it } from "vitest";
import { distributeInteger, resolveFlexMainAxis } from "../src/flex.ts";
import { layoutRoot } from "../src/layout.ts";
import { makeNode } from "./helpers.ts";

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
  const item = (base: number, grow = 0, shrink = 1, min?: number, max?: number) => ({
    base,
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

describe("items-center regression (min-height stretches single row)", () => {
  it("centers a 1-cell-tall child in a min-h-5 flex-row container", () => {
    const child = makeNode({ text: "hi" });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        minHeight: 5,
        border: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Container: 20 wide, min-h-5 → height 5.
    expect(container.localRect.height).toBe(5);
    // Inner rows = 5 - 2 (border) = 3. Child height 1. Center offset = 1.
    // Absolute y = 1 (border-top) + 1 (center offset) = 2.
    expect(child.localRect.y).toBe(2);
  });

  it("items-end pushes the child to the bottom of the enforced inner", () => {
    const child = makeNode({ text: "hi" });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "end",
        minHeight: 5,
        border: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Inner rows = 3. End offset = 3 - 1 = 2. Absolute y = 1 + 2 = 3.
    expect(child.localRect.y).toBe(3);
  });
});

describe("flex-row auto and fixed margins", () => {
  it("mx-auto on a single item absorbs all leftover as equal shares", () => {
    const item = makeNode({
      text: "hi",
      style: { margin: { top: 0, right: null, bottom: 0, left: null } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [item],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Item width 2. Leftover 18. Shares [9, 9]. Item starts at 9.
    expect(item.localRect.x).toBe(9);
  });

  it("fixed main-axis margins push subsequent items right", () => {
    const a = makeNode({ text: "a" });
    const b = makeNode({
      text: "b",
      style: { margin: { top: 0, right: 0, bottom: 0, left: 4 } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [a, b],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at x=0, width 1. b at x = 0 + 1 (a) + 4 (margin-left) = 5.
    expect(a.localRect.x).toBe(0);
    expect(b.localRect.x).toBe(5);
  });

  it("align-self overrides the parent's align-items for that item only", () => {
    const a = makeNode({ text: "a" });
    const b = makeNode({ text: "b", style: { alignSelf: "end" } });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "start",
        minHeight: 4,
      },
      children: [a, b],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Inner rows = 4. a: alignItems=start → y=0. b: self=end → y = 4 - 1 = 3.
    expect(a.localRect.y).toBe(0);
    expect(b.localRect.y).toBe(3);
  });
});

describe("flex-basis, order, reverse, and justify space-*", () => {
  it("flex-1 (basis 0% + grow 1) makes columns equal regardless of content", () => {
    const flexOne = {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: { kind: "percent", value: 0 },
    } as const;
    const short = makeNode({ text: "ab", style: { ...flexOne, minWidth: 0 } });
    const long = makeNode({ text: "a much longer text here", style: { ...flexOne, minWidth: 0 } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [short, long],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    // basis 0 → ALL 30 cells distributed by grow equally: 15 + 15. Plain
    // `grow` (basis auto) would have split only the leftover.
    expect(short.localRect.width).toBe(15);
    expect(long.localRect.width).toBe(15);
  });

  it("flex-1 equalizes even with automatic minimums in play (base is unclamped)", () => {
    // Regression: bases were once pre-clamped by the automatic minimum
    // (min-content), so flex-1 columns kept their content inequality.
    // These items keep the default `min-width: auto` on purpose.
    const flexOne = {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: { kind: "percent", value: 0 },
    } as const;
    const short = makeNode({ text: "ab", style: { ...flexOne } });
    const long = makeNode({ text: "considerably longer", style: { ...flexOne } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [short, long],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    expect(short.localRect.width).toBe(15);
    expect(long.localRect.width).toBe(15);
  });

  it("column-reverse stacks items bottom-up with justify flipped", () => {
    const first = makeNode({ text: "a" });
    const second = makeNode({ text: "b" });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        flexReverse: true,
        height: { kind: "cells", value: 6 },
      },
      children: [first, second],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 10);
    // Main axis runs bottom-to-top: `second` above `first`, packed to the
    // bottom edge (justify start = main-start = bottom).
    expect(first.localRect.y).toBe(5);
    expect(second.localRect.y).toBe(4);
  });

  it("wrap-reverse stacks wrapped lines from the bottom", () => {
    const items = ["aaaa", "bbbb", "cccc"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", flexWrap: "wrap", wrapReverse: true },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 9);
    // Two items per 9-wide line: line {a,b} then line {c}. wrap-reverse
    // puts the LAST line on top: c at y=0, a and b at y=1.
    expect(items[2]!.localRect.y).toBe(0);
    expect(items[0]!.localRect.y).toBe(1);
    expect(items[1]!.localRect.y).toBe(1);
  });

  it("percent-width flex item keeps its flex-resolved width (no double resolution)", () => {
    // Regression: the final layout pass used to re-resolve `w-1/2` against
    // the item's own assigned width — half of half.
    const half = makeNode({ text: "hi", style: { width: { kind: "percent", value: 50 } } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [half],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(half.localRect.width).toBe(20);
  });

  it("explicit-width flex item that grows keeps the grown width", () => {
    // Regression: the final pass used to override the flex-assigned size
    // with the explicit width, desyncing rects from offsets.
    const grower = makeNode({
      text: "hi",
      style: { width: { kind: "cells", value: 10 }, flexGrow: 1 },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [grower],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(grower.localRect.width).toBe(40);
  });

  it("column: an item's min-height doesn't skew grow distribution (base unclamped)", () => {
    const constrained = makeNode({ text: "a", style: { flexGrow: 1, minHeight: 10 } });
    const open = makeNode({ text: "b", style: { flexGrow: 1 } });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        height: { kind: "cells", value: 20 },
      },
      children: [constrained, open],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 10);
    // Bases [1, 1]; 18 extra split 9/9 → [10, 10]. A min-clamped base of
    // 10 would instead have produced an unequal split.
    expect(constrained.localRect.height).toBe(10);
    expect(open.localRect.height).toBe(10);
  });

  it("flex-1 equalizes heights in a column too", () => {
    const flexOne = {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: { kind: "percent", value: 0 },
    } as const;
    const short = makeNode({ text: "a", style: { ...flexOne } });
    const tall = makeNode({ text: "a\nb\nc\nd", style: { ...flexOne } });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        height: { kind: "cells", value: 12 },
      },
      children: [short, tall],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 10);
    expect(short.localRect.height).toBe(6);
    expect(tall.localRect.height).toBe(6);
  });

  it("explicit flex-basis in cells is the base size", () => {
    const item = makeNode({ text: "ab", style: { flexBasis: { kind: "cells", value: 12 } } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [item],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(item.localRect.width).toBe(12);
  });

  it("order sorts flex items (stable, document order ties)", () => {
    const a = makeNode({ text: "aa", style: { order: 2 } });
    const b = makeNode({ text: "bb", style: { order: 1 } });
    const c = makeNode({ text: "cc" }); // order 0
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", gapX: 1 },
      children: [a, b, c],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Visual order: c (0), b (1), a (2).
    expect(c.localRect.x).toBe(0);
    expect(b.localRect.x).toBe(3);
    expect(a.localRect.x).toBe(6);
  });

  it("row-reverse lays items backwards and flips justify start to the right edge", () => {
    const first = makeNode({ text: "aa" });
    const second = makeNode({ text: "bb" });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", flexReverse: true, gapX: 1 },
      children: [first, second],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Main axis runs right-to-left: `second` sits left of `first`, packed
    // to the right edge (justify start = main-start = right).
    expect(first.localRect.x).toBe(18);
    expect(second.localRect.x).toBe(15);
  });

  it("space-evenly distributes n+1 equal gaps", () => {
    const items = ["aa", "bb", "cc"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", justifyContent: "space-evenly" },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 22);
    // Leftover 16 over 4 gaps = 4 each: x = 4, 10, 16.
    expect(items[0]!.localRect.x).toBe(4);
    expect(items[1]!.localRect.x).toBe(10);
    expect(items[2]!.localRect.x).toBe(16);
  });

  it("space-around gives edges half the inner spacing", () => {
    const items = ["aa", "bb"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", justifyContent: "space-around" },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 12);
    // Leftover 8, weights [1,2,1] → gaps 2,4,2: x = 2, 8.
    expect(items[0]!.localRect.x).toBe(2);
    expect(items[1]!.localRect.x).toBe(8);
  });

  it("stretch clamps to the item's max-height", () => {
    const tall = makeNode({ text: "a\nb\nc\nd\ne" }); // 5 rows
    const capped = makeNode({ text: "x", style: { maxHeight: 2 } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", alignItems: "stretch", gapX: 1 },
      children: [tall, capped],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 10);
    // Stretch would force 5 rows; the item's own max-h-2 wins, per CSS.
    expect(tall.localRect.height).toBe(5);
    expect(capped.localRect.height).toBe(2);
  });
});

describe("flex-column cross-axis stretch respects per-item align-self", () => {
  it("in a stretch parent, a self-start child shrinks to intrinsic width", () => {
    const stretched = makeNode({ text: "wide-content-here" });
    const selfStart = makeNode({ text: "hi", style: { alignSelf: "start" } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", alignItems: "stretch" },
      children: [stretched, selfStart],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Parent inner width = 40. Stretched child fills to 40.
    // self-start child shrinks to its intrinsic "hi".length = 2.
    expect(stretched.localRect.width).toBe(40);
    expect(selfStart.localRect.width).toBe(2);
  });
});

describe("flex-column parity", () => {
  it("my-auto on a single item centers along the main axis", () => {
    const item = makeNode({
      text: "hi",
      style: { margin: { top: null, right: 0, bottom: null, left: 0 } },
    });
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        minHeight: 5,
      },
      children: [item],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Container height 5. Item height 1. Leftover 4, split 2/2.
    expect(item.localRect.y).toBe(2);
  });

  it("self-end aligns item to the container's right edge in flex-column", () => {
    const item = makeNode({ text: "hi", style: { alignSelf: "end" } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "column" },
      children: [item],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Container inner width 20. Item width 2. Right-aligned x = 18.
    expect(item.localRect.x).toBe(18);
  });
});

describe("auto margin priority (CSS: auto absorbs leftover before flex-grow)", () => {
  it("flex-row: `grow` yields to `mx-auto` when both are present", () => {
    const grower = makeNode({ text: "g", style: { flexGrow: 1 } });
    const autoItem = makeNode({
      text: "a",
      style: { margin: { top: 0, right: null, bottom: 0, left: null } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [grower, autoItem],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Container 20 wide. Intrinsics: g=1, a=1. Total 2, leftover 18.
    // Auto margins present → grow disabled. widths stay [1, 1]. Auto margins
    // absorb 18 across 2 slots → shares [9, 9]. grower at x=0, autoItem at
    // x = 0 + 1 (grower) + 9 (its own leading auto) = 10.
    expect(grower.localRect.width).toBe(1);
    expect(autoItem.localRect.width).toBe(1);
    expect(autoItem.localRect.x).toBe(10);
  });

  it("flex-column: `grow` yields to `my-auto` when both are present", () => {
    const grower = makeNode({ text: "g", style: { flexGrow: 1 } });
    const autoItem = makeNode({
      text: "a",
      style: { margin: { top: null, right: 0, bottom: null, left: 0 } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", minHeight: 10 },
      children: [grower, autoItem],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Container min-h-10. Intrinsics: g=1, a=1. Total 2, leftover 8.
    // Auto margins present → grow disabled. Heights stay [1, 1]. Auto
    // margins absorb 8 across 2 slots → shares [4, 4]. autoItem y = 0 + 1
    // (grower) + 4 (leading auto) = 5.
    expect(grower.localRect.height).toBe(1);
    expect(autoItem.localRect.height).toBe(1);
    expect(autoItem.localRect.y).toBe(5);
  });
});

describe("flex-row stretch (default items-* is stretch, matches CSS)", () => {
  it("stretches shorter siblings to the tallest child's height", () => {
    // Tall child has 3 rows via hard breaks; short child has 1. In a stretch
    // container both should end at height 3.
    const tall = makeNode({ text: "a\nb\nc" });
    const short = makeNode({ text: "short" });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", alignItems: "stretch" },
      children: [tall, short],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(tall.localRect.height).toBe(3);
    expect(short.localRect.height).toBe(3);
  });

  it("does not stretch a child with an explicit height", () => {
    const tall = makeNode({ text: "a\nb\nc" });
    const fixed = makeNode({ text: "fixed", style: { height: { kind: "cells", value: 1 } } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", alignItems: "stretch" },
      children: [tall, fixed],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(fixed.localRect.height).toBe(1);
  });

  it("does not stretch a child with auto cross-axis margins", () => {
    const tall = makeNode({ text: "a\nb\nc" });
    const autoMargin = makeNode({
      text: "a",
      style: { margin: { top: null, right: 0, bottom: null, left: 0 } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", alignItems: "stretch" },
      children: [tall, autoMargin],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Auto margins own the cross axis; child stays at intrinsic height,
    // centered by the auto margins in the 3-row row.
    expect(autoMargin.localRect.height).toBe(1);
    expect(autoMargin.localRect.y).toBe(1);
  });
});

describe("flex-column re-layout when grown/shrunk child height changes", () => {
  it("propagates the final height so nested items-center sees it", () => {
    // Outer flex-column with min-h-10 and one child that grows to fill.
    // The grown child has its own inner flex-row with items-center — the
    // nested item should center against the FINAL grown height, not the
    // child's intrinsic (1-cell) height.
    const nestedItem = makeNode({ text: "x" });
    const grownChild = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flexGrow: 1,
      },
      children: [nestedItem],
    });
    const outer = makeNode({
      style: { display: "flex", flexDirection: "column", minHeight: 10 },
      children: [grownChild],
    });
    const root = makeNode({ children: [outer] });
    layoutRoot(root, 20);
    // Outer inner rows = 10 (no border). Grown child gets height 10.
    // Nested item (1 tall) centered in 10 → offset = floor((10 - 1) / 2) = 4.
    expect(grownChild.localRect.height).toBe(10);
    expect(nestedItem.localRect.y).toBe(4);
  });
});

describe("align-content (multi-line cross distribution)", () => {
  const wrapContainer = (
    alignContent: "start" | "center" | "end" | "space-between" | "stretch",
  ) => {
    const items = ["aaaa", "bbbb", "cccc"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignContent,
        height: { kind: "cells", value: 8 },
      },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 9);
    return items;
  };

  it("content-center offsets the packed lines into the middle", () => {
    // Two lines (2 + 1 items) of height 1; leftover 6 → centered at 3.
    const items = wrapContainer("center");
    expect(items[0]!.localRect.y).toBe(3);
    expect(items[2]!.localRect.y).toBe(4);
  });

  it("content-between pushes the lines to the edges", () => {
    const items = wrapContainer("space-between");
    expect(items[0]!.localRect.y).toBe(0);
    expect(items[2]!.localRect.y).toBe(7);
  });

  it("stretch (the default) grows the lines to fill", () => {
    // Leftover 6 split equally: lines become 4 tall; second starts at 4.
    const items = wrapContainer("stretch");
    expect(items[0]!.localRect.y).toBe(0);
    expect(items[2]!.localRect.y).toBe(4);
  });

  it("content-end under wrap-reverse packs to the top (cross-start flip)", () => {
    const items = ["aaaa", "bbbb", "cccc"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        wrapReverse: true,
        alignContent: "end",
        height: { kind: "cells", value: 8 },
      },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 9);
    // wrap-reverse: line order flipped (c's line first) AND end ≡ cross
    // start → packed at the top.
    expect(items[2]!.localRect.y).toBe(0);
    expect(items[0]!.localRect.y).toBe(1);
  });
});

describe("flex-wrap", () => {
  it("wraps items to a new row when the next item would overflow", () => {
    const a = makeNode({ text: "aaaaa" }); // width 5
    const b = makeNode({ text: "bbbbb" }); // width 5
    const c = makeNode({ text: "ccccc" }); // width 5
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", flexWrap: "wrap" },
      children: [a, b, c],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 12);
    // Row 1: a (0-5) + b would need 10 (fits in 12). c needs 15 (overflows).
    // → row 1: a, b. row 2: c.
    expect(a.localRect.y).toBe(0);
    expect(b.localRect.y).toBe(0);
    expect(c.localRect.y).toBe(1);
    expect(c.localRect.x).toBe(0);
  });
});

describe("indefinite flex column placement uses clamped sizes", () => {
  it("a min-h item doesn't overlap its follower when no distribution runs", () => {
    // Regression: with an indefinite container height, stacking used raw
    // (unclamped) bases while the min-h box itself clamped taller.
    const tall = makeNode({ text: "a", style: { minHeight: 7 } });
    const after = makeNode({ text: "b" });
    const column = makeNode({
      style: { display: "flex", flexDirection: "column", gapY: 1 },
      children: [tall, after],
    });
    const root = makeNode({ children: [column] });
    layoutRoot(root, 20);
    expect(tall.localRect.height).toBe(7);
    expect(after.localRect.y).toBe(8); // 7 + gap 1
    expect(column.localRect.height).toBe(9);
  });
});

describe("flex item min/max and sizing through layoutRoot", () => {
  it("flex-wrap wraps against the container's max-width", () => {
    const items = ["first", "second item", "a third one"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", flexWrap: "wrap", gapX: 1, maxWidth: 14 },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 60);
    // Widths 5, 11, 11 with gap 1 in a 14-wide container:
    // line 1: "first" + gap + ... "second item" doesn't fit → wraps.
    expect(items[0]!.localRect.y).toBe(0);
    expect(items[1]!.localRect.y).toBe(1);
    expect(items[2]!.localRect.y).toBe(2);
  });

  it("flex-column min-height smaller than content is a floor, not a cap", () => {
    // Regression: the min-height-derived inner height used to be fed to the
    // flex main-axis algorithm as a definite size, so flex-shrink compressed
    // the children down to the min — min-h behaved like max-h.
    // flexShrink: 1 matches the CSS default (the test helper defaults to 0),
    // so this fails if min-height is ever treated as a definite size again.
    const items = ["a\nb\nc", "d\ne\nf", "g\nh\ni"].map((text) =>
      makeNode({ text, style: { flexShrink: 1 } }),
    );
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", gapY: 1, minHeight: 4 },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Intrinsic: 3 items × 3 rows + 2 gaps = 11 > min-h 4. Children keep
    // their intrinsic height (no shrink) and the container grows to fit.
    for (const item of items) expect(item.localRect.height).toBe(3);
    expect(container.localRect.height).toBe(11);
  });

  it("flex-column min-height larger than content hands the extra to grow", () => {
    const grower = makeNode({ text: "g", style: { flexGrow: 1 } });
    const fixed = makeNode({ text: "f" });
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", minHeight: 8 },
      children: [grower, fixed],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Intrinsic 1+1=2, floor 8 → grower takes the extra 6 → height 7.
    expect(grower.localRect.height).toBe(7);
    expect(container.localRect.height).toBe(8);
  });

  it("flex-column explicit height smaller than content still shrinks", () => {
    // min-h-0 opts out of the automatic minimum — per CSS, column items
    // with visible overflow never shrink below their content height.
    const items = ["a\nb\nc", "d\ne\nf"].map((text) =>
      makeNode({ text, style: { flexShrink: 1, minHeight: 0 } }),
    );
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", height: { kind: "cells", value: 4 } },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // A definite height IS a cap for the flex algorithm: intrinsic 3+3=6
    // shrinks into 4 (2 each).
    expect(items[0]!.localRect.height).toBe(2);
    expect(items[1]!.localRect.height).toBe(2);
    expect(container.localRect.height).toBe(4);
  });

  it("percent min-width resolves against the available width", () => {
    const item = makeNode({ text: "hi", style: { minWidth: { percent: 50 } } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [item],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // min-width: 50% of 40 = 20 beats the intrinsic 2.
    expect(item.localRect.width).toBe(20);
  });

  it("min-w on a flex item redistributes the shrink to its siblings (no overlap)", () => {
    // Regression: shrink used to run in a single round — an item clamped up
    // to its min-width kept space its neighbors had already been granted,
    // so boxes overlapped. CSS §9.7 freezes the clamped item and reruns the
    // distribution among the rest.
    // b opts out of the automatic minimum (min-w-0) — its single 20-cell
    // word would otherwise refuse to shrink below min-content, per CSS.
    const a = makeNode({ text: "aaaaaaaaaaaaaaaaaaaa", style: { flexShrink: 1, minWidth: 16 } });
    const b = makeNode({ text: "bbbbbbbbbbbbbbbbbbbb", style: { flexShrink: 1, minWidth: 0 } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [a, b],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 24);
    // Bases 20+20 into 24. Equal single-round shrink would give 12+12, but
    // a clamps to 16 → b must absorb the rest: 24 - 16 = 8.
    expect(a.localRect.width).toBe(16);
    expect(b.localRect.width).toBe(8);
    expect(a.localRect.width + b.localRect.width).toBe(24);
  });

  it("min-width auto: a flex item stops shrinking at its min-content size", () => {
    const words = makeNode({ text: "hello unbreakable world", style: { flexShrink: 1 } });
    const other = makeNode({ text: "xxxxxxxxxx", style: { flexShrink: 1, minWidth: 0 } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [words, other],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 15);
    // words' min-content = "unbreakable" (11); it freezes there and the
    // min-w-0 sibling absorbs the rest of the shrink.
    expect(words.localRect.width).toBe(11);
    expect(other.localRect.width).toBe(4);
  });

  it("truncate in a flex row: non-visible overflow disables the automatic minimum", () => {
    const truncated = makeNode({
      text: "a very long truncatable label",
      style: { flexShrink: 1, whiteSpace: "nowrap", overflow: "clip", textOverflow: "ellipsis" },
    });
    const fixed = makeNode({ text: "xxxxxxxxxx", style: {} });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [truncated, fixed],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // nowrap min-content would be the whole 29-cell line, but overflow:
    // clip zeroes the automatic minimum, so the item shrinks to fit and the
    // browser ellipsizes. (The classic flex + truncate combination.)
    expect(truncated.localRect.width).toBe(10);
    expect(fixed.localRect.width).toBe(10);
  });

  it("max-w on a flex item redistributes the growth to its siblings", () => {
    const capped = makeNode({ text: "a", style: { flexGrow: 1, maxWidth: 5 } });
    const open = makeNode({ text: "b", style: { flexGrow: 1 } });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [capped, open],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    // Equal grow would give 15+15; capped freezes at 5, open takes 25.
    expect(capped.localRect.width).toBe(5);
    expect(open.localRect.width).toBe(25);
  });
});

describe("justify-content offsets through layoutRoot", () => {
  const row = (justify: "start" | "center" | "end" | "space-between") => {
    const items = ["aa", "bb", "cc"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", justifyContent: justify },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    return items.map((i) => i.localRect.x);
  };

  it("center floors the half-leftover", () => {
    // Leftover 14 → floor(7) start.
    expect(row("center")).toEqual([7, 9, 11]);
  });

  it("end packs to the right edge", () => {
    expect(row("end")).toEqual([14, 16, 18]);
  });

  it("space-between hands the remainder to leading gaps in document order", () => {
    // Leftover 14 over 2 gaps → 7 each: x = 0, 9, 18.
    expect(row("space-between")).toEqual([0, 9, 18]);
  });

  it("percent row-gap resolves against a definite container height", () => {
    const items = ["a", "b"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        gapY: { percent: 25 },
        height: { kind: "cells", value: 8 },
      },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 10);
    // gap = 25% of 8 = 2 → second item at y = 1 + 2.
    expect(items[1]!.localRect.y).toBe(3);
  });

  it("negative margins pull flex items together", () => {
    const a = makeNode({ text: "aaaa" });
    const b = makeNode({
      text: "bb",
      style: { margin: { top: 0, right: 0, bottom: 0, left: -2 } },
    });
    const container = makeNode({
      style: { display: "flex", flexDirection: "row" },
      children: [a, b],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(b.localRect.x).toBe(2); // 4 - 2
  });
});
