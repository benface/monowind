import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { render } from "../src/render.ts";
import { parsePositionArea, parsePositionTryFallbacks, readCellStyle } from "../src/style.ts";
import type { AnchorFallback, LayoutNode, PositionArea } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Anchor positioning (specs/anchor-positioning.md): the read of the
 * properties, an anchored box in its area, aligned toward the anchor,
 * its fallbacks on overflow, and the area written onto the element. */

describe("the read", () => {
  it("parses a computed position-area as the engines serialize it", () => {
    expect(parsePositionArea("none")).toBeNull();
    expect(parsePositionArea("bottom")).toEqual({ x: "span-all", y: "end" });
    expect(parsePositionArea("left top")).toEqual({ x: "start", y: "start" });
    expect(parsePositionArea("span-right bottom")).toEqual({ x: "span-end", y: "end" });
    expect(parsePositionArea("right span-bottom")).toEqual({ x: "end", y: "span-end" });
    expect(parsePositionArea("center")).toEqual({ x: "center", y: "center" });
    expect(parsePositionArea("end start")).toEqual({ x: "start", y: "end" });
    expect(parsePositionArea("self-end")).toEqual({ x: "end", y: "end" });
    expect(parsePositionArea("inline-start block-end")).toEqual({ x: "start", y: "end" });
    expect(parsePositionArea("wherever")).toBeNull();
  });

  it("parses the fallbacks: flip tactics together, areas of their own", () => {
    expect(parsePositionTryFallbacks("none")).toEqual([]);
    expect(parsePositionTryFallbacks("flip-block, flip-inline, flip-block flip-inline")).toEqual([
      { flipBlock: true, flipInline: false, flipStart: false },
      { flipBlock: false, flipInline: true, flipStart: false },
      { flipBlock: true, flipInline: true, flipStart: false },
    ]);
    expect(parsePositionTryFallbacks("flip-start, top")).toEqual([
      { flipBlock: false, flipInline: false, flipStart: true },
      { x: "span-all", y: "start" },
    ]);
  });

  it("names an invoker for its target and anchors a popover to its own id", () => {
    const button = document.createElement("button");
    button.setAttribute("popovertarget", "menu");
    document.body.appendChild(button);
    expect(readCellStyle(button, 16).anchorNames).toEqual(["--mw:menu"]);
    const named = document.createElement("div");
    named.style.setProperty("anchor-name", "--a, --b");
    document.body.appendChild(named);
    expect(readCellStyle(named, 16).anchorNames).toEqual(["--a", "--b"]);
    const menu = document.createElement("div");
    menu.id = "menu";
    menu.setAttribute("popover", "");
    document.body.appendChild(menu);
    expect(readCellStyle(menu, 16).positionAnchor).toBe("--mw:menu");
    expect(readCellStyle(document.createElement("div"), 16).positionAnchor).toBeNull();
  });

  it("reads the implicit anchor under both its keywords and none as none", () => {
    const popover = (anchor: string) => {
      const menu = document.createElement("div");
      menu.id = "menu";
      menu.setAttribute("popover", "");
      menu.style.setProperty("position-anchor", anchor);
      document.body.appendChild(menu);
      expect(getComputedStyle(menu).getPropertyValue("position-anchor")).toBe(anchor);
      return readCellStyle(menu, 16).positionAnchor;
    };
    expect(popover("auto")).toBe("--mw:menu");
    expect(popover("normal")).toBe("--mw:menu");
    expect(popover("none")).toBeNull();
    expect(popover("--other")).toBe("--other");
  });

  it("takes the parent's anchor under match-parent, up through matching parents", () => {
    const grandparent = document.createElement("div");
    grandparent.style.setProperty("position-anchor", "--up");
    const parent = document.createElement("div");
    parent.style.setProperty("position-anchor", "match-parent");
    const child = document.createElement("div");
    child.style.position = "absolute";
    child.style.setProperty("position-anchor", "match-parent");
    grandparent.append(parent);
    parent.append(child);
    document.body.appendChild(grandparent);
    expect(readCellStyle(child, 16).positionAnchor).toBe("--up");
    const orphan = document.createElement("div");
    orphan.style.position = "absolute";
    orphan.style.setProperty("position-anchor", "match-parent");
    document.body.appendChild(orphan);
    expect(readCellStyle(orphan, 16).positionAnchor).toBeNull();
    // An in-flow box is anchored to nothing, whatever it says.
    const flow = document.createElement("div");
    flow.style.setProperty("position-anchor", "--up");
    document.body.appendChild(flow);
    expect(readCellStyle(flow, 16).positionAnchor).toBeNull();
  });
});

const anchored = (
  text: string,
  area: PositionArea,
  extra: Parameters<typeof makeNode>[0] = {},
  fallbacks: AnchorFallback[] = [],
) =>
  makeNode({
    text,
    source: document.createElement("div"),
    ...extra,
    style: {
      position: "absolute",
      positionAnchor: "--a",
      positionArea: area,
      positionTryFallbacks: fallbacks,
      ...extra.style,
    },
  });
const spacer = (rows: number) =>
  makeNode({
    source: document.createElement("div"),
    style: { height: { kind: "cells", value: rows } },
  });
/** A 20×8 host with a 4-wide anchor of `rows` at (`left`, 3), and the
 * box's rect. */
const place = (box: LayoutNode, left = 6, rows = 1) => {
  const anchor = makeNode({
    text: "ANCH",
    source: document.createElement("div"),
    style: {
      anchorNames: ["--a"],
      position: "absolute",
      insets: { top: 3, right: null, bottom: null, left },
      height: { kind: "cells", value: rows },
    },
  });
  const root = makeNode({
    style: { minHeight: 8 },
    source: document.createElement("div"),
    children: [spacer(1), anchor, box],
  });
  layoutRoot(root, 20);
  return { root, rect: box.localRect };
};

describe("the area", () => {
  it("puts the box under, above, beside, and on its anchor, flush against it", () => {
    expect(place(anchored("x", { x: "span-all", y: "end" })).rect).toMatchObject({ x: 7, y: 4 });
    expect(place(anchored("x", { x: "span-all", y: "start" })).rect).toMatchObject({ x: 7, y: 2 });
    expect(place(anchored("xy", { x: "end", y: "center" })).rect).toMatchObject({ x: 10, y: 3 });
    expect(place(anchored("xy", { x: "start", y: "center" })).rect).toMatchObject({ x: 4, y: 3 });
    expect(place(anchored("xy", { x: "center", y: "center" })).rect).toMatchObject({ x: 7, y: 3 });
  });

  it("aligns along the edge a span keeps, and centers where an axis spans all", () => {
    // bottom span-right: left edges together; bottom span-left: right.
    expect(place(anchored("menu", { x: "span-end", y: "end" })).rect).toMatchObject({ x: 6, y: 4 });
    expect(place(anchored("menu", { x: "span-start", y: "end" })).rect).toMatchObject({
      x: 6,
      y: 4,
    });
    expect(place(anchored("wide menu", { x: "span-start", y: "end" })).rect).toMatchObject({
      x: 1,
      y: 4,
    });
    // A box centered on a 4-wide anchor, a 2-wide box at its middle.
    expect(place(anchored("xy", { x: "span-all", y: "end" })).rect).toMatchObject({ x: 7, y: 4 });
  });

  it("takes justify-self and align-self over the default, anchor-center from any side", () => {
    const box = anchored("x", { x: "span-all", y: "end" }, { style: { justifySelf: "start" } });
    expect(place(box).rect).toMatchObject({ x: 0, y: 4 });
    const end = anchored("x", { x: "span-all", y: "end" }, { style: { justifySelf: "end" } });
    expect(place(end).rect).toMatchObject({ x: 19, y: 4 });
    // Beside a 3-row anchor, on its rows and below, a box hugs the top
    // of the area, or centers on the anchor under anchor-center.
    const hugging = anchored("x", { x: "end", y: "span-end" });
    expect(place(hugging, 6, 3).rect).toMatchObject({ x: 10, y: 3 });
    const centered = anchored(
      "x",
      { x: "end", y: "span-end" },
      { style: { anchorCenter: { x: false, y: true } } },
    );
    expect(place(centered, 6, 3).rect).toMatchObject({ x: 10, y: 4 });
  });

  it("lays the box out in the area, a narrow one wrapping it", () => {
    // Right of the anchor: 10 columns; the text wraps in them.
    const box = anchored("one two three four", { x: "end", y: "center" });
    const { rect } = place(box);
    expect(rect.x).toBe(10);
    expect(rect.width).toBeLessThanOrEqual(10);
    expect(rect.height).toBeGreaterThan(1);
  });

  it("keeps a margin as the gap", () => {
    const box = anchored(
      "x",
      { x: "span-all", y: "end" },
      {
        style: { margin: { top: 1, right: 0, bottom: 0, left: 0 } },
      },
    );
    expect(place(box).rect).toMatchObject({ y: 5 });
  });
});

describe("the fallbacks", () => {
  it("flips the block axis when the box overflows below, the inline one when it overflows beside", () => {
    // Under the anchor there are 4 rows; a 5-row box flips above (4 rows,
    // still overflowing) — the first placement stands; a 3-row box fits
    // above after failing below.
    const tall = anchored(
      "a b c d e",
      { x: "span-all", y: "end" },
      { style: { width: { kind: "cells", value: 1 } } },
      [{ flipBlock: true, flipInline: false, flipStart: false }],
    );
    const { rect } = place(tall);
    expect(rect.height).toBe(5);
    expect(rect.y).toBe(4);
    expect(tall.anchorArea).toEqual({ x: "span-all", y: "end" });
    const three = anchored(
      "a b c",
      { x: "span-all", y: "end" },
      { style: { width: { kind: "cells", value: 1 } } },
      [{ flipBlock: true, flipInline: false, flipStart: false }],
    );
    // Shrink the space below to two rows: the host is 6 rows tall.
    const anchor = makeNode({
      text: "ANCH",
      style: {
        anchorNames: ["--a"],
        position: "absolute",
        insets: { top: 3, right: null, bottom: null, left: 6 },
      },
    });
    const root = makeNode({ style: { minHeight: 6 }, children: [spacer(1), anchor, three] });
    layoutRoot(root, 20);
    expect(three.localRect.y).toBe(0);
    expect(three.anchorArea).toEqual({ x: "span-all", y: "start" });
    // Beside an anchor near the right edge, a wide box flips to the left,
    // flush against it.
    const wide = anchored("abcdefghijkl", { x: "end", y: "center" }, {}, [
      { flipBlock: false, flipInline: true, flipStart: false },
    ]);
    expect(place(wide, 14).rect.x).toBe(2);
    expect(wide.anchorArea).toEqual({ x: "start", y: "center" });
  });

  it("swaps the axes for flip-start, and takes an area of its own", () => {
    // The right column is 10 wide: a 12-wide box swaps to the rows below.
    const start = anchored("abcdefghijkl", { x: "end", y: "span-all" }, {}, [
      { flipBlock: false, flipInline: false, flipStart: true },
    ]);
    place(start);
    expect(start.anchorArea).toEqual({ x: "span-all", y: "end" });
    const own = anchored("abcdefghijkl", { x: "end", y: "center" }, {}, [
      { x: "span-all", y: "start" },
    ]);
    place(own);
    expect(own.anchorArea).toEqual({ x: "span-all", y: "start" });
  });
});

describe("a fixed box", () => {
  it("keeps its host rect for the walks that paint and hit it from the host", () => {
    const box = anchored("x", { x: "span-end", y: "end" }, { style: { position: "fixed" } });
    const { rect } = place(box);
    expect(box.hostRect).toEqual({ x: rect.x, y: rect.y });
  });
});

describe("an anchor in a scroller", () => {
  /** A 20-wide host: a 3-row scroller of 8 rows with the 4×1 anchor on
   * its row 2, scrolled down `rows`, and the box after it. */
  const scrolled = (box: LayoutNode, rows: number) => {
    const anchor = makeNode({
      text: "ANCH",
      source: document.createElement("div"),
      style: { anchorNames: ["--a"], width: { kind: "cells", value: 4 } },
    });
    const list = makeNode({
      source: document.createElement("div"),
      style: { overflow: { x: "visible", y: "auto" }, height: { kind: "cells", value: 3 } },
      children: [spacer(2), anchor, spacer(5), ...(box.style.position === "fixed" ? [] : [box])],
    });
    list.scroll = { x: 0, y: rows };
    const root = makeNode({
      style: { minHeight: 8 },
      source: document.createElement("div"),
      children: [spacer(1), list, ...(box.style.position === "fixed" ? [box] : [])],
    });
    layoutRoot(root, 20);
    return { root, list, rect: box.localRect };
  };

  it("places a fixed box against the anchor where the scroll shows it", () => {
    const still = anchored("x", { x: "end", y: "center" }, { style: { position: "fixed" } });
    expect(scrolled(still, 0).rect).toMatchObject({ x: 4, y: 3 });
    const box = anchored("x", { x: "end", y: "center" }, { style: { position: "fixed" } });
    const { root, list, rect } = scrolled(box, 2);
    expect(rect).toMatchObject({ x: 4, y: 1 });
    expect(root.anchorScrollers).toEqual(new Set([list.source]));
  });

  it("leaves a box in the same scroller where the layout put it, scrolling with the anchor", () => {
    const box = anchored("x", { x: "end", y: "center" });
    const { root, rect } = scrolled(box, 2);
    expect(rect).toMatchObject({ x: 4, y: 2 });
    expect(root.anchorScrollers).toBeUndefined();
  });
});

describe("the light element", () => {
  it("carries the area taken as physical keywords", () => {
    const box = anchored("x", { x: "span-end", y: "end" });
    const { root } = place(box);
    render(root);
    expect(box.source.getAttribute("data-mw-area")).toBe("span-right bottom");
    const plain = makeNode({ text: "p", source: document.createElement("div") });
    render(makeNode({ source: document.createElement("div"), children: [plain] }));
    expect(plain.source.hasAttribute("data-mw-area")).toBe(false);
  });
});
