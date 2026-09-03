import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText, thumbSpan } from "../src/plain-text.ts";
import { makeNode } from "./helpers.ts";

/** Scroll containers (specs/scrolling.md): gutter reservation, the
 * engine-derived scroll range, and the scrolled/clipped paint. */

describe("scroll gutter", () => {
  it("a y-scroll container reserves the rightmost content column", () => {
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        width: { kind: "cells", value: 10 },
      },
      text: "aaa bbb ccc",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 12);
    // Inner width is 10 − 2 border − 1 gutter = 7: "aaa bbb" fits a
    // line only with the gutter's column excluded. `scroll` paints the
    // bar even without overflow — a full-length thumb.
    expect(renderPlainText(root).split("\n")[1]).toBe("│aaa bbb█│");
  });

  it("an x-scroll container reserves the bottom content row", () => {
    const box = makeNode({
      style: {
        overflow: { x: "scroll", y: "visible" },
        height: { kind: "cells", value: 3 },
        width: { kind: "cells", value: 8 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.resolvedPadding.bottom).toBe(1);
    expect(box.resolvedPadding.right).toBe(0);
  });

  it("clip and visible reserve nothing", () => {
    const box = makeNode({
      style: { overflow: { x: "clip", y: "clip" }, width: { kind: "cells", value: 8 } },
      text: "hi",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.resolvedPadding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(box.scrollRange).toBeUndefined();
  });
});

describe("scroll range", () => {
  it("derives maxY from the content extent minus the content box", () => {
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        width: { kind: "cells", value: 12 },
        height: { kind: "cells", value: 3 },
      },
      text: "one two three four five six seven",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 14);
    // Content box: 11 wide (gutter), 3 tall; the text wraps to more
    // rows than fit.
    expect(box.scrollRange).toBeDefined();
    expect(box.scrollRange!.sizeY).toBeGreaterThan(3);
    expect(box.scrollRange!.maxY).toBe(box.scrollRange!.sizeY - 3);
    expect(box.scrollRange!.maxX).toBe(0);
  });

  it("no overflow means max 0 (auto's blank-gutter state)", () => {
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        width: { kind: "cells", value: 12 },
        height: { kind: "cells", value: 5 },
      },
      text: "short",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 14);
    expect(box.scrollRange!.maxY).toBe(0);
  });

  it("derives maxX from nowrap line advances", () => {
    const box = makeNode({
      style: {
        overflow: { x: "scroll", y: "visible" },
        whiteSpace: "nowrap",
        width: { kind: "cells", value: 8 },
      },
      text: "a very long unwrapped line",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.scrollRange!.sizeX).toBe(26);
    expect(box.scrollRange!.maxX).toBe(26 - 8);
  });

  it("a child's own overflowing text extends the range (CSS scrollable overflow)", () => {
    const child = makeNode({
      style: { whiteSpace: "nowrap" },
      text: "a line far wider than the box",
    });
    const box = makeNode({
      style: {
        overflow: { x: "auto", y: "visible" },
        width: { kind: "cells", value: 8 },
      },
      children: [child],
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    // The block child is 8 wide, its text 29 — the text counts.
    expect(child.localRect.width).toBe(8);
    expect(box.scrollRange!.sizeX).toBe(29);
    expect(box.scrollRange!.maxX).toBe(21);
  });

  it("a clipping child contributes only its box", () => {
    const child = makeNode({
      style: { whiteSpace: "nowrap", overflow: { x: "clip", y: "clip" } },
      text: "a line far wider than the box",
    });
    const box = makeNode({
      style: {
        overflow: { x: "auto", y: "visible" },
        width: { kind: "cells", value: 8 },
      },
      children: [child],
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.scrollRange!.maxX).toBe(0);
  });

  it("child boxes extend the range", () => {
    const tall = makeNode({
      style: { height: { kind: "cells", value: 9 } },
      text: "",
    });
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        width: { kind: "cells", value: 10 },
        height: { kind: "cells", value: 4 },
      },
      children: [tall],
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 12);
    expect(box.scrollRange!.sizeY).toBe(9);
    expect(box.scrollRange!.maxY).toBe(5);
  });
});

describe("scrolled paint", () => {
  const make = () =>
    makeNode({
      style: {
        overflow: { x: "visible", y: "auto" },
        width: { kind: "cells", value: 8 },
        height: { kind: "cells", value: 2 },
      },
      text: "aa bb cc dd ee ff gg hh",
    });

  it("offsets content by the scroll and culls outside the box", () => {
    const box = make();
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    // Overflowing auto reserves its gutter: content box is 7 wide, so
    // the rows wrap as "aa bb", "cc dd", … — offset 1 shows row two on
    // top.
    box.scroll = { x: 0, y: 1 };
    const rows = renderPlainText(root).split("\n");
    expect(rows[0]!.startsWith("cc dd")).toBe(true);
  });

  it("overflowing auto reserves the gutter and looks like scroll", () => {
    const box = make();
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    // The second layout pass reserved the gutter (CSS parity)...
    expect(box.resolvedPadding.right).toBe(1);
    expect(box.scrollGutterCells).toEqual({ right: 1, bottom: 0 });
    expect(box.scrollRange!.maxY).toBeGreaterThan(0);
    // ...and paints the full bar at rest: thumb at top, track below.
    const rows = renderPlainText(root).split("\n");
    expect(rows[0]![7]).toBe("█");
    expect(rows[1]![7]).toBe("░");
  });

  it("a one-row overflow still shows a track cell beside the thumb", () => {
    // 6 visible of 7 rows rounds the thumb to the full track; the bar
    // must still tell "scrollable" from "fits".
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        width: { kind: "cells", value: 3 },
        height: { kind: "cells", value: 6 },
      },
      text: "a b c d e f g",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 6);
    expect(box.scrollRange!.maxY).toBe(1);
    const bar = renderPlainText(root)
      .split("\n")
      .map((row) => row[2])
      .join("");
    expect(bar).toBe("█████░");
    box.scroll = { x: 0, y: 1 };
    const scrolled = renderPlainText(root)
      .split("\n")
      .map((row) => row[2])
      .join("");
    expect(scrolled).toBe("░█████");
  });

  it("the thumb shrinks until every offset moves it", () => {
    // 6-cell track, 8 rows of content (max 2): proportional rounds to
    // 5 cells, which could only show two positions for three offsets.
    expect(thumbSpan(6, 8, 2, 0)).toEqual({ at: 0, len: 4 });
    expect(thumbSpan(6, 8, 2, 1)).toEqual({ at: 1, len: 4 });
    expect(thumbSpan(6, 8, 2, 2)).toEqual({ at: 2, len: 4 });
    // More offsets than track cells: a one-cell thumb does its best.
    expect(thumbSpan(3, 30, 27, 27)).toEqual({ at: 2, len: 1 });
    // Nothing scrolls: the full track.
    expect(thumbSpan(6, 4, 0, 0)).toEqual({ at: 0, len: 6 });
  });

  it("auto without overflow reserves nothing and paints nothing", () => {
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "auto" },
        width: { kind: "cells", value: 8 },
        height: { kind: "cells", value: 2 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.resolvedPadding.right).toBe(0);
    const art = renderPlainText(root);
    expect(art).not.toContain("░");
    expect(art).not.toContain("█");
  });

  it("scrollbar-size widens the gutter and the bar", () => {
    const box = makeNode({
      style: {
        overflow: { x: "visible", y: "scroll" },
        scrollbarSize: { x: 1, y: 2 },
        width: { kind: "cells", value: 10 },
        height: { kind: "cells", value: 2 },
      },
      text: "aa bb cc dd ee ff gg hh",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 12);
    expect(box.resolvedPadding.right).toBe(2);
    const rows = renderPlainText(root).split("\n");
    // Two thumb columns at the top row's end.
    expect(rows[0]!.slice(8, 10)).toBe("██");
  });

  it("nested clip composes: an inner scroll container cannot paint outside an outer clip", () => {
    const inner = makeNode({
      style: {
        overflow: { x: "visible", y: "auto" },
        width: { kind: "cells", value: 6 },
        height: { kind: "cells", value: 4 },
        insets: { top: 1, right: null, bottom: null, left: 0 },
        position: "relative",
      },
      text: "one two three",
    });
    const outer = makeNode({
      style: {
        overflow: { x: "clip", y: "clip" },
        width: { kind: "cells", value: 8 },
        height: { kind: "cells", value: 2 },
      },
      children: [inner],
    });
    const root = makeNode({ children: [outer] });
    layoutRoot(root, 10);
    // The inner scroll container is pushed down; the outer 2-row clip swallows
    // everything below row 1.
    expect(renderPlainText(root).split("\n").length).toBe(2);
  });
});
