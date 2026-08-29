import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { makeNode } from "./helpers.ts";

/**
 * Integration tests for the positioning pass (specs/positioning.md) —
 * pure-math trees through layoutRoot, like layout.test.ts.
 */

describe("positioning (specs/positioning.md)", () => {
  it("relative offsets the box without affecting siblings or the parent", () => {
    const shifted = makeNode({
      text: "aa",
      style: { position: "relative", insets: { top: 1, right: null, bottom: null, left: 2 } },
    });
    const sibling = makeNode({ text: "bb" });
    const container = makeNode({ children: [shifted, sibling] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(shifted.localRect.x).toBe(2);
    expect(shifted.localRect.y).toBe(1);
    // Sibling still flows as if the box hadn't moved; parent height too.
    expect(sibling.localRect.y).toBe(1);
    expect(container.localRect.height).toBe(2);
  });

  it("relative: bottom/right push the other way; top/left win when both set", () => {
    const a = makeNode({
      text: "a",
      style: { position: "relative", insets: { top: null, right: 3, bottom: 2, left: null } },
    });
    const b = makeNode({
      text: "b",
      style: { position: "relative", insets: { top: 1, right: null, bottom: 5, left: null } },
    });
    const root = makeNode({ children: [a, b] });
    layoutRoot(root, 10);
    expect(a.localRect.x).toBe(-3);
    expect(a.localRect.y).toBe(-2);
    expect(b.localRect.y).toBe(2); // flow y 1 + top 1 (bottom ignored)
  });

  it("sticky behaves as relative for now", () => {
    const item = makeNode({
      text: "s",
      style: { position: "sticky", insets: { top: 1, right: null, bottom: null, left: null } },
    });
    const root = makeNode({ children: [item] });
    layoutRoot(root, 10);
    expect(item.localRect.y).toBe(1);
  });

  it("absolute is out of flow and positions against the nearest positioned ancestor", () => {
    const overlay = makeNode({
      text: "x",
      style: { position: "absolute", insets: { top: 1, right: null, bottom: null, left: 2 } },
    });
    // static middle wrapper — must NOT be the containing block
    const middle = makeNode({ children: [overlay] });
    const anchor = makeNode({
      style: {
        position: "relative",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      children: [makeNode({ text: "content" }), middle],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    // Containing block = anchor's PADDING box (inside the 1-cell border).
    // overlay abs = anchor(0,0) + border(1,1) + insets(2,1) → parent-relative
    // to `middle`, which sits at anchor content origin (2,2) with size 0×0…
    // verify via absolute coordinates instead:
    const absX = anchor.localRect.x + middle.localRect.x + overlay.localRect.x;
    const absY = anchor.localRect.y + middle.localRect.y + overlay.localRect.y;
    expect(absX).toBe(1 + 2);
    expect(absY).toBe(1 + 1);
    // Out of flow: middle contributes nothing, anchor height = content + box.
    expect(middle.localRect.height).toBe(0);
    expect(anchor.localRect.height).toBe(1 + 1 + 1 + 1 + 1); // border+pad+text+pad+border
  });

  it("absolute right/bottom anchor to the far edges", () => {
    const badge = makeNode({
      text: "hi",
      style: { position: "absolute", insets: { top: null, right: 1, bottom: 1, left: null } },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 6 },
      children: [badge],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    // cb = anchor 20×6. x = 20 - 1 - 2 = 17; y = 6 - 1 - 1 = 4.
    expect(badge.localRect.x).toBe(17);
    expect(badge.localRect.y).toBe(4);
  });

  it("inset-0 stretches an auto-sized box to the containing block", () => {
    const cover = makeNode({
      text: "c",
      style: { position: "absolute", insets: { top: 0, right: 0, bottom: 0, left: 0 } },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 5 },
      children: [cover],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    expect(cover.localRect).toEqual({ x: 0, y: 0, width: 20, height: 5 });
  });

  it("inset-0 with auto margins centers a fixed-size box", () => {
    const dialog = makeNode({
      text: "hi",
      style: {
        position: "absolute",
        width: { kind: "cells", value: 4 },
        height: { kind: "cells", value: 2 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: null, right: null, bottom: null, left: null },
      },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 6 },
      children: [dialog],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    // (20-4)/2 = 8; (6-2)/2 = 2.
    expect(dialog.localRect.x).toBe(8);
    expect(dialog.localRect.y).toBe(2);
  });

  it("an axis without insets uses the static position (block flow)", () => {
    const first = makeNode({ text: "first" });
    const pinned = makeNode({
      text: "pin",
      style: { position: "absolute", insets: { top: null, right: 0, bottom: null, left: null } },
    });
    const last = makeNode({ text: "last" });
    const container = makeNode({
      style: { position: "relative" },
      children: [first, pinned, last],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // x pinned to the right edge; y stays at its flow slot (row 1).
    expect(pinned.localRect.x).toBe(17);
    expect(pinned.localRect.y).toBe(1);
    // `last` flows as if pinned didn't exist.
    expect(last.localRect.y).toBe(1);
    expect(container.localRect.height).toBe(2);
  });

  it("flex static position follows the sole-item rule", () => {
    const abs = makeNode({
      text: "ab",
      style: { position: "absolute", insets: { top: null, right: null, bottom: null, left: null } },
    });
    const row = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "end",
        position: "relative",
        minHeight: 4,
      },
      children: [abs],
    });
    const root = makeNode({ children: [row] });
    layoutRoot(root, 20);
    // Sole-item: centered on the main axis, end on the cross axis.
    expect(abs.localRect.x).toBe(9); // (20-2)/2
    expect(abs.localRect.y).toBe(3); // 4-1
  });

  it("fixed anchors to the host even inside a positioned ancestor", () => {
    const pinned = makeNode({
      text: "f",
      style: { position: "fixed", insets: { top: 0, right: null, bottom: null, left: 0 } },
    });
    const anchor = makeNode({
      style: { position: "relative", padding: { top: 2, right: 2, bottom: 2, left: 2 } },
      children: [pinned],
    });
    const wrapper = makeNode({ children: [makeNode({ text: "spacer" }), anchor] });
    const root = makeNode({ children: [wrapper] });
    layoutRoot(root, 20);
    // Absolute position 0,0 relative to the HOST, not `anchor`.
    const absX = wrapper.localRect.x + anchor.localRect.x + pinned.localRect.x;
    const absY = wrapper.localRect.y + anchor.localRect.y + pinned.localRect.y;
    expect(absX).toBe(0);
    expect(absY).toBe(0);
  });

  it("percent insets resolve against the containing block (width vs height)", () => {
    const item = makeNode({
      text: "p",
      style: {
        position: "absolute",
        insets: { top: { percent: 50 }, right: null, bottom: null, left: { percent: 25 } },
      },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 8 },
      children: [item],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 40);
    expect(item.localRect.x).toBe(10); // 25% of 40
    expect(item.localRect.y).toBe(4); // 50% of 8
  });
});

describe("out-of-flow children of text leaves", () => {
  it("keeps the leaf's text and positions the badge by its insets", () => {
    const badge = makeNode({
      text: "*",
      style: { position: "absolute", insets: { top: 0, right: 0, bottom: null, left: null } },
    });
    const leaf = makeNode({ text: "hello world", intrinsicWidth: 11, children: [badge] });
    leaf.style.position = "relative";
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 11);
    // Text still wraps/sizes the leaf (2 rows at width 11? no — fits: 1).
    expect(leaf.localRect.height).toBe(1);
    expect(badge.localRect.x).toBe(10);
    expect(badge.localRect.y).toBe(0);
  });

  it("uses the leaf's content origin as the static position", () => {
    const badge = makeNode({
      text: "*",
      style: { position: "absolute", insets: { top: null, right: null, bottom: null, left: null } },
    });
    const leaf = makeNode({
      text: "hi",
      children: [badge],
      style: {
        position: "relative",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      },
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 20);
    // Content origin: border 1 + padding 1 = x 2, border 1 + padding 0 = y 1.
    expect(badge.localRect.x).toBe(2);
    expect(badge.localRect.y).toBe(1);
  });
});

describe("flex sole-item static position includes fixed margins", () => {
  it("offsets the hypothetical box by its margins under start alignment", () => {
    const abs = makeNode({
      text: "ab",
      style: {
        position: "absolute",
        insets: { top: null, right: null, bottom: null, left: null },
        margin: { top: 1, right: 0, bottom: 0, left: 3 },
      },
    });
    const row = makeNode({
      style: { display: "flex", flexDirection: "row", position: "relative", minHeight: 4 },
      children: [abs],
    });
    const root = makeNode({ children: [row] });
    layoutRoot(root, 20);
    expect(abs.localRect.x).toBe(3);
    expect(abs.localRect.y).toBe(1);
  });

  it("centers the margin-inclusive box, then adds the leading margin", () => {
    const abs = makeNode({
      text: "ab",
      style: {
        position: "absolute",
        insets: { top: null, right: null, bottom: null, left: null },
        margin: { top: 0, right: 0, bottom: 0, left: 4 },
      },
    });
    const row = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        position: "relative",
        minHeight: 2,
      },
      children: [abs],
    });
    const root = makeNode({ children: [row] });
    layoutRoot(root, 20);
    // Outer box = 2 + 4 = 6; centered in 20 → offset 7; + margin-left 4 = 11.
    expect(abs.localRect.x).toBe(11);
  });
});

describe("absolute sizing fidelity", () => {
  it("percent width resolves against the containing block, not the inset-reduced space", () => {
    const half = makeNode({
      text: "x",
      style: {
        position: "absolute",
        width: { kind: "percent", value: 50 },
        insets: { top: 0, right: null, bottom: null, left: 4 },
      },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 4 },
      children: [half],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 40);
    // 50% of cb (40) = 20 — NOT 50% of (40 - left 4).
    expect(half.localRect.width).toBe(20);
    expect(half.localRect.x).toBe(4);
  });

  it("shrink-to-fit never goes below min-content when insets squeeze it", () => {
    const label = makeNode({
      text: "unbreakable",
      style: { position: "absolute", insets: { top: 0, right: null, bottom: null, left: 15 } },
    });
    const anchor = makeNode({
      style: { position: "relative", minHeight: 3 },
      children: [label],
    });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    // Available after left-15 is 5, but min-content is 11 → fit-content 11.
    expect(label.localRect.width).toBe(11);
  });
});

describe("containing block and constraint edge cases", () => {
  it("absolute with no positioned ancestor resolves against the host", () => {
    const pinned = makeNode({
      text: "x",
      style: { position: "absolute", insets: { top: 0, right: 0, bottom: null, left: null } },
    });
    const staticWrapper = makeNode({
      style: { padding: { top: 2, right: 2, bottom: 2, left: 2 } },
      children: [makeNode({ text: "spacer" }), pinned],
    });
    const root = makeNode({ children: [staticWrapper] });
    layoutRoot(root, 30);
    // CB = host (30 wide): abs x = 30 - 1 = 29, y = 0.
    expect(staticWrapper.localRect.x + pinned.localRect.x).toBe(29);
    expect(staticWrapper.localRect.y + pinned.localRect.y).toBe(0);
  });

  it("over-constrained axis: left wins, right yields (LTR)", () => {
    const box = makeNode({
      text: "x",
      style: {
        position: "absolute",
        width: { kind: "cells", value: 5 },
        insets: { top: 0, right: 2, bottom: null, left: 3 },
      },
    });
    const anchor = makeNode({ style: { position: "relative", minHeight: 3 }, children: [box] });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 30);
    // left 3 + width 5 + right 2 ≠ 30 → right is ignored.
    expect(box.localRect.x).toBe(3);
    expect(box.localRect.width).toBe(5);
  });

  it("a single auto margin absorbs the slack on its side", () => {
    const box = makeNode({
      text: "x",
      style: {
        position: "absolute",
        width: { kind: "cells", value: 4 },
        insets: { top: 0, right: 0, bottom: null, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: null },
      },
    });
    const anchor = makeNode({ style: { position: "relative", minHeight: 3 }, children: [box] });
    const root = makeNode({ children: [anchor] });
    layoutRoot(root, 20);
    // ml-auto pushes the box against the right inset: x = 20 - 4.
    expect(box.localRect.x).toBe(16);
  });

  it("column flex static position uses justify on the vertical main axis", () => {
    const abs = makeNode({
      text: "a",
      style: { position: "absolute", insets: { top: null, right: null, bottom: null, left: null } },
    });
    const column = makeNode({
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "end",
        alignItems: "center",
        position: "relative",
        height: { kind: "cells", value: 6 },
      },
      children: [abs],
    });
    const root = makeNode({ children: [column] });
    layoutRoot(root, 10);
    // Sole item: main (y) = end → 6-1 = 5; cross (x) = center → (10-1)/2 = 4.
    expect(abs.localRect.y).toBe(5);
    expect(abs.localRect.x).toBe(4);
  });
});
