import { describe, expect, it } from "vitest";
import { paintGrid } from "../src/paint.ts";
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
    expect(paintGrid(paintedTree("howdy", "red"), target, true)).toBe(true);
    expect(target.querySelector("span")).not.toBe(span);
    expect(target.textContent).toContain("howdy");
  });
});
