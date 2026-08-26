import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { defaultCellStyle } from "../src/types.ts";
import type { CellStyle, LayoutNode } from "../src/types.ts";

/**
 * Regression tests for the full layoutRoot pipeline. These are pure-math
 * tests — no DOM required. Each builds a hand-crafted LayoutNode tree and
 * asserts on the resulting `localRect` coordinates.
 */

const stubElement = {} as unknown as Element;

function makeNode(overrides: {
  style?: Partial<CellStyle>;
  children?: LayoutNode[];
  text?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}): LayoutNode {
  const text = overrides.text ?? "";
  return {
    source: stubElement,
    style: { ...defaultCellStyle(), ...overrides.style },
    children: overrides.children ?? [],
    text,
    intrinsicWidth: overrides.intrinsicWidth ?? text.length,
    intrinsicHeight: overrides.intrinsicHeight ?? (text.length > 0 ? 1 : 0),
    localRect: { x: 0, y: 0, width: 0, height: 0 },
  };
}

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

describe("margin collapsing in block flow", () => {
  it("collapses adjacent positive sibling margins to their max", () => {
    const a = makeNode({ text: "a", style: { margin: { top: 0, right: 0, bottom: 4, left: 0 } } });
    const b = makeNode({ text: "b", style: { margin: { top: 2, right: 0, bottom: 0, left: 0 } } });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1 → a bottom at y=1. Collapsed gap = max(4, 2) = 4.
    // → b at y = 1 + 4 = 5.
    expect(a.localRect.y).toBe(0);
    expect(b.localRect.y).toBe(5);
  });

  it("collapses adjacent negative sibling margins to the more negative", () => {
    const a = makeNode({
      text: "a",
      style: { margin: { top: 0, right: 0, bottom: -3, left: 0 } },
    });
    const b = makeNode({
      text: "b",
      style: { margin: { top: -1, right: 0, bottom: 0, left: 0 } },
    });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1. b at y = 1 + min(-3, -1) = 1 + -3 = -2.
    expect(b.localRect.y).toBe(-2);
  });

  it("sums mixed-sign sibling margins", () => {
    const a = makeNode({ text: "a", style: { margin: { top: 0, right: 0, bottom: 5, left: 0 } } });
    const b = makeNode({
      text: "b",
      style: { margin: { top: -2, right: 0, bottom: 0, left: 0 } },
    });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1. b at y = 1 + (5 + -2) = 4.
    expect(b.localRect.y).toBe(4);
  });

  it("does not collapse the container's leading/trailing gaps (no parent-child collapse)", () => {
    const child = makeNode({
      text: "x",
      style: { margin: { top: 3, right: 0, bottom: 4, left: 0 } },
    });
    const container = makeNode({ children: [child] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // container height = child.marginTop (3) + child.height (1) + child.marginBottom (4) = 8.
    expect(container.localRect.height).toBe(8);
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

describe("min-width / max-width / min-height / max-height clamping", () => {
  it("clamps a fill-mode container down to max-width", () => {
    const container = makeNode({
      style: { maxWidth: 10 },
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    expect(container.localRect.width).toBe(10);
  });

  it("clamps intrinsic content down to max-width when smaller", () => {
    const child = makeNode({ text: "hello world hello world" });
    const container = makeNode({
      style: { maxWidth: 8 },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Container capped at max-width 8; child fills to 8, wraps.
    expect(container.localRect.width).toBe(8);
  });

  it("respects min-width even if intrinsic content is smaller", () => {
    const child = makeNode({ text: "hi" });
    const container = makeNode({
      style: { minWidth: 12, width: { kind: "cells", value: 4 } },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Explicit width 4, but min-width 12 wins.
    expect(container.localRect.width).toBe(12);
  });

  it("clamps content-driven height down to max-height", () => {
    const child = makeNode({ text: "a\nb\nc\nd\ne" }); // 5 lines
    const container = makeNode({
      style: { maxHeight: 3 },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Natural height would be 5; capped at 3.
    expect(container.localRect.height).toBe(3);
  });

  it("min > max: max wins as the ceiling, then min pushes back up", () => {
    // CSS clamps `max(min, min(max, value))` — if min > max, min wins.
    const container = makeNode({
      style: { minWidth: 15, maxWidth: 10 },
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    // value=30 → min(10, 30)=10 → max(15, 10)=15.
    expect(container.localRect.width).toBe(15);
  });
});

describe("overflow", () => {
  it("carries overflow: clip through to CellStyle so the CSS override applies", () => {
    const container = makeNode({ style: { overflow: "clip" } });
    expect(container.style.overflow).toBe("clip");
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
