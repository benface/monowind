import { describe, expect, it } from "vitest";
import { gridOffsetAt, paintGrid } from "../src/paint.ts";
import { layoutRoot } from "../src/layout.ts";
import { makeNode } from "./helpers.ts";
import type { LayoutNode } from "../src/types.ts";

/** The three paint tiers (specs/cell-model.md "Selection"): identical
 * paints skip the write, structure-matching paints patch styles on the
 * EXISTING nodes (selections and drag anchors ride on node identity),
 * structural changes rebuild. */
function paintedTree(text: string, color: string): LayoutNode {
  const root = makeNode({ children: [makeNode({ style: { color }, text, intrinsicWidth: 5 })] });
  layoutRoot(root, 10);
  return root;
}

describe("paintGrid rows", () => {
  it("paints every row at the grid's full width, blank rows included", () => {
    const target = document.createElement("pre");
    const root = makeNode({
      style: { display: "flex", flexDirection: "column" },
      children: [
        makeNode({ text: "hi", intrinsicWidth: 2 }),
        makeNode({ style: { height: { kind: "cells", value: 1 } } }),
        makeNode({ text: "hello world", intrinsicWidth: 11 }),
      ],
    });
    layoutRoot(root, 11);
    paintGrid(root, target);
    expect(target.textContent!.split("\n")).toEqual(["hi         ", "           ", "hello world"]);
  });
});

describe("paintGrid node identity", () => {
  it("patches styles in place when only paint values change", () => {
    const target = document.createElement("pre");
    paintGrid(paintedTree("hello", "red"), target);
    const span = target.querySelector("span")!;
    expect(span.style.color).toBe("red");
    paintGrid(paintedTree("hello", "blue"), target);
    // Same node, new paint — a live Selection anchored here survives.
    expect(target.querySelector("span")).toBe(span);
    expect(span.style.color).toBe("blue");
  });

  it("skips the write entirely for an identical paint", () => {
    const target = document.createElement("pre");
    paintGrid(paintedTree("hello", "red"), target);
    const span = target.querySelector("span")!;
    span.dataset.marker = "kept";
    paintGrid(paintedTree("hello", "red"), target);
    expect(target.querySelector("span")!.dataset.marker).toBe("kept");
  });

  it("rebuilds on structural change, and can hold the rebuild", () => {
    const target = document.createElement("pre");
    paintGrid(paintedTree("hello", "red"), target);
    const span = target.querySelector("span")!;
    // holdStructural only defers when a selection anchor is inside the
    // grid — none here, so the rebuild proceeds.
    expect(paintGrid(paintedTree("howdy", "red"), target, { holdStructural: true })).toBe(true);
    expect(target.querySelector("span")).not.toBe(span);
    expect(target.textContent).toContain("howdy");
  });
});

describe("paintGrid rows and boxes (specs/wide-characters.md)", () => {
  function selectable(): { root: LayoutNode; leaves: LayoutNode[] } {
    const leaves = [
      makeNode({ text: "abc", intrinsicWidth: 3 }),
      makeNode({ text: "def", intrinsicWidth: 3 }),
    ];
    const root = makeNode({
      style: { display: "flex", flexDirection: "column" },
      children: leaves,
    });
    layoutRoot(root, 3);
    return { root, leaves };
  }

  it("patches only the rows a selection change touches", () => {
    const target = document.createElement("pre");
    const { root, leaves } = selectable();
    paintGrid(root, target);
    const [first] = Array.from(target.childNodes);
    paintGrid(root, target, { selection: new Map([[leaves[1]!, { start: 0, end: 2 }]]) });
    expect(target.childNodes[0]).toBe(first);
    const span = target.querySelector("span")!;
    expect(span.textContent).toBe("de");
    expect(span.style.color).toBe("var(--mw-bg, canvas)");
    expect(span.style.backgroundColor).toBe("var(--mw-fg, canvastext)");
    expect(target.textContent).toBe("abc\ndef");
    paintGrid(root, target, { selection: new Map([[leaves[1]!, { start: 0, end: 3 }]]) });
    expect(target.childNodes[0]).toBe(first);
    expect(target.textContent).toBe("abc\ndef");
  });

  it("boxes a cluster the glyph cache names, scaled to its cells", () => {
    const target = document.createElement("pre");
    const leaf = makeNode({ text: "a中b", intrinsicWidth: 4 });
    leaf.advances = [1, 2, 1];
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 4);
    const glyphs = { box: (cluster: string) => (cluster === "中" ? { scale: 1.18 } : null) };
    paintGrid(root, target, { glyphs: glyphs as never });
    const span = target.querySelector("span")!;
    expect(span.textContent).toBe("中");
    expect(span.style.display).toBe("inline-block");
    expect(span.style.width).toBe("calc(2 * var(--mw-cw, 1ch))");
    expect(span.style.fontSize).toBe("118%");
    expect(target.textContent).toBe("a中b");
    expect(gridOffsetAt(target, 0, 0)).toBe(0);
    expect(gridOffsetAt(target, 2, 0)).toBe(2);
    expect(gridOffsetAt(target, 3, 0)).toBe(2);
    expect(gridOffsetAt(target, 4, 0)).toBe(3);
  });

  it("maps cells to flat offsets across rows", () => {
    const target = document.createElement("pre");
    const { root } = selectable();
    paintGrid(root, target);
    expect(gridOffsetAt(target, 1, 1)).toBe(5);
    expect(gridOffsetAt(target, 9, 9)).toBe(7);
  });
});
