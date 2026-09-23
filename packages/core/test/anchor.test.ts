import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { hitChain } from "../src/pointer.ts";
import { render } from "../src/render.ts";
import {
  parsePositionArea,
  parsePositionTryFallbacks,
  parsePositionVisibility,
  readCellStyle,
} from "../src/style.ts";
import type { Remembered } from "../src/positioning.ts";
import type { AnchorFallback, CellStyle, Flip, LayoutNode, PositionArea } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Anchor positioning (specs/anchor-positioning.md): the read, the
 * area and the anchor functions in layout, the fallbacks and their
 * order, the placement kept, `position-visibility`, and the area
 * written onto the element. */

/** The cell style of a box carrying `className`, absolutely positioned
 * unless `position` says otherwise. */
const readClasses = (className: string, position = "absolute"): CellStyle => {
  const box = document.createElement("div");
  box.style.position = position;
  box.className = className;
  document.body.appendChild(box);
  return readCellStyle(box, 16);
};

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

  it("parses the fallbacks: a tactic's flips in their order, areas of their own", () => {
    expect(parsePositionTryFallbacks("none")).toEqual([]);
    expect(parsePositionTryFallbacks("flip-block, flip-inline, flip-block flip-inline")).toEqual([
      { flips: ["block"] },
      { flips: ["inline"] },
      { flips: ["block", "inline"] },
    ]);
    expect(parsePositionTryFallbacks("flip-start, top")).toEqual([
      { flips: ["start"] },
      { x: "span-all", y: "start" },
    ]);
    // flip-x and flip-y are the inline and block flips of a horizontal host.
    expect(parsePositionTryFallbacks("flip-x flip-y, flip-start flip-block")).toEqual([
      { flips: ["inline", "block"] },
      { flips: ["start", "block"] },
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
    menu.style.setProperty("position-area", "bottom");
    document.body.appendChild(menu);
    expect(readCellStyle(menu, 16).positionAnchor).toBe("--mw:menu");
    expect(readCellStyle(document.createElement("div"), 16).positionAnchor).toBeNull();
  });

  it("reads the implicit anchor under auto, under normal only with an area, and none as none", () => {
    const popover = (anchor: string, area = "none") => {
      const menu = document.createElement("div");
      menu.id = "menu";
      menu.setAttribute("popover", "");
      menu.style.setProperty("position-anchor", anchor);
      menu.style.setProperty("position-area", area);
      document.body.appendChild(menu);
      expect(getComputedStyle(menu).getPropertyValue("position-anchor")).toBe(anchor);
      return readCellStyle(menu, 16).positionAnchor;
    };
    expect(popover("auto")).toBe("--mw:menu");
    // The browsers agree (probed 2026-09-22): a centered popover has no
    // default anchor, its invoker's scroll hiding nothing.
    expect(popover("normal")).toBeNull();
    expect(popover("normal", "bottom")).toBe("--mw:menu");
    expect(popover("none", "bottom")).toBeNull();
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

  it("reads an anchor-size() from a utility, the size unset until placed", () => {
    const style = readClasses(
      "w-[anchor-size(--b_height)] min-w-[anchor-size(width)] max-h-[anchor-size(--c_block)]",
    );
    expect(style.anchorSizes).toEqual({
      width: { anchor: "--b", dimension: "height" },
      minWidth: { anchor: null, dimension: "width" },
      maxHeight: { anchor: "--c", dimension: "height" },
    });
    // The browser's px is the pre-grid anchor's: unset until placed.
    expect(style.width).toEqual({ kind: "auto" });
    expect(style.minWidth).toBe("auto");
    expect(style.maxHeight).toBeUndefined();
    // Only an out-of-flow box takes one, as in CSS.
    expect(readClasses("min-w-[anchor-size(width)]", "static").anchorSizes).toEqual({});
  });

  it("reads an anchor() inset from a utility, another axis's side resolving to none", () => {
    const style = readClasses(
      "top-[anchor(--a_bottom)] left-[anchor(50%)] right-[anchor(bottom,1rem)] bottom-[anchor(toString)]",
    );
    // An unknown keyword reads as none, a name every object inherits too.
    expect(style.anchorInsets).toEqual({
      top: { anchor: "--a", fraction: 1 },
      left: { anchor: null, fraction: 0.5 },
      right: { anchor: null, fraction: null, fallback: 4 },
    });
    // The browser's px is the pre-grid anchor's: unset until placed.
    expect(style.insets).toMatchObject({ top: null, right: null, left: null });
  });

  it("reads anchor-size()'s dimensions, a size utility's two sizes, and a fallback", () => {
    const { anchorSizes } = readClasses(
      "size-[anchor-size(--b_inline,_2rem)] max-w-[anchor-size(self-block)]",
    );
    // 2rem is eight cells at a 16px root.
    expect(anchorSizes.width).toEqual({ anchor: "--b", dimension: "width", fallback: 8 });
    expect(anchorSizes.height).toEqual({ anchor: "--b", dimension: "width", fallback: 8 });
    expect(anchorSizes.maxWidth).toEqual({ anchor: null, dimension: "height" });
    expect(anchorSizes.minWidth).toBeUndefined();
  });

  it("reads anchor()'s logical sides, inside and outside, and a fallback", () => {
    const { anchorInsets } = readClasses(
      "top-[anchor(outside)] bottom-[anchor(--x_start,_1rem)] left-[anchor(inside,50%)] right-[anchor(25%)]",
    );
    // outside of top is the anchor's bottom; start is top on the block axis.
    expect(anchorInsets.top).toEqual({ anchor: null, fraction: 1 });
    expect(anchorInsets.bottom).toEqual({ anchor: "--x", fraction: 0, fallback: 4 });
    expect(anchorInsets.left).toEqual({ anchor: null, fraction: 0, fallback: { percent: 50 } });
    expect(anchorInsets.right).toEqual({ anchor: null, fraction: 0.25 });
  });

  it("reads a calc() fallback and a zero one", () => {
    const { anchorInsets, anchorSizes } = readClasses(
      "top-[anchor(bottom,calc(100%-1rem))] min-w-[anchor-size(width,0)]",
    );
    expect(anchorInsets.top).toEqual({
      anchor: null,
      fraction: 1,
      fallback: { percent: 100, cells: -4 },
    });
    expect(anchorSizes.minWidth).toEqual({ anchor: null, dimension: "width", fallback: 0 });
  });

  /** An absolute box carrying `className`, its Typed OM (which happy-dom
   * lacks) answering `computed`, read with the probe's `autoMinimum`. */
  const readTyped = (
    className: string,
    computed: Record<string, string>,
    setup?: (box: HTMLElement) => void,
    autoMinimum?: string,
  ): CellStyle => {
    const box = document.createElement("div");
    box.style.position = "absolute";
    box.className = className;
    setup?.(box);
    document.body.appendChild(box);
    (box as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) => computed[property] ?? null,
    });
    const metrics =
      autoMinimum === undefined
        ? undefined
        : { width: 9, height: 18, letterSpacing: 0, autoMinimum };
    return readCellStyle(box, 16, metrics);
  };

  it("takes a later utility a cell off the fallback as the one in effect", () => {
    // 17px rounds to the fallback's four cells, but is not 1rem.
    const style = readTyped("top-[anchor(bottom,1rem)] md:top-[17px]", { top: "17px" });
    expect(style.anchorInsets.top).toBeUndefined();
  });

  it("reads an anchor-size() minimum as WebKit computes an auto one", () => {
    // WebKit's Typed OM reads an `auto` minimum as 0px, as the probe finds.
    const minWidth = (autoMinimum: string, computed: string) =>
      readTyped("min-w-[anchor-size(width)]", { "min-width": computed }, undefined, autoMinimum)
        .anchorSizes.minWidth;
    expect(minWidth("0px", "0px")).toEqual({ anchor: null, dimension: "width" });
    expect(minWidth("auto", "0px")).toBeUndefined();
    expect(minWidth("auto", "auto")).toEqual({ anchor: null, dimension: "width" });
  });

  it("reads the anchor() utility the cascade leaves in effect among several", () => {
    // Under the read's anchor-scope an anchor() without a fallback computes
    // to the initial value, one with a fallback to its fallback (Chromium
    // and WebKit).
    const top = (className: string, computed: string) =>
      readTyped(className, { top: computed }).anchorInsets.top;
    const bottomOrRem = { anchor: null, fraction: 1, fallback: 4 };
    expect(top("hover:top-[anchor(bottom,1rem)] top-[anchor(top)]", "auto")).toEqual({
      anchor: null,
      fraction: 0,
    });
    expect(top("top-[anchor(bottom,1rem)] md:top-[anchor(top)]", "16px")).toEqual(bottomOrRem);
    expect(top("top-[anchor(bottom,1rem)] md:top-[anchor(top)]", "auto")).toEqual({
      anchor: null,
      fraction: 0,
    });
    // A later utility in effect leaves every anchor() out.
    expect(top("top-[anchor(bottom)] md:top-[anchor(bottom,1rem)] top-4", "4px")).toBeUndefined();
  });

  it("checks a popover's anchor() naming an anchor after its side", () => {
    // Only an anchor() naming none resolves natively against the invoker.
    const style = readTyped("top-[anchor(bottom_--a)]", { top: "16px" }, (box) => {
      box.id = "menu";
      box.setAttribute("popover", "");
      box.style.setProperty("position-anchor", "auto");
    });
    expect(style.positionAnchor).toBe("--mw:menu");
    expect(style.anchorInsets.top).toBeUndefined();
  });

  it("parses position-visibility, the initial anchors-visible, and both spellings", () => {
    expect(parsePositionVisibility("")).toEqual({
      anchorValid: false,
      anchorVisible: true,
      noOverflow: false,
    });
    expect(parsePositionVisibility("always")).toEqual({
      anchorValid: false,
      anchorVisible: false,
      noOverflow: false,
    });
    expect(parsePositionVisibility("anchors-valid no-overflow")).toEqual({
      anchorValid: true,
      anchorVisible: false,
      noOverflow: true,
    });
    expect(parsePositionVisibility("anchor-visible")).toMatchObject({ anchorVisible: true });
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
/** A `position-visibility`, each condition off unless given. */
const visibility = (value: Partial<CellStyle["positionVisibility"]>) => ({
  positionVisibility: { anchorValid: false, anchorVisible: false, noOverflow: false, ...value },
});
/** An absolute anchor named `name`, as wide as its text, `rows` tall,
 * at (`left`, `top`). */
const anchorAt = (left: number, top = 3, { name = "--a", text = "ANCH", rows = 1 } = {}) =>
  makeNode({
    text,
    source: document.createElement("div"),
    style: {
      anchorNames: [name],
      position: "absolute",
      insets: { top, right: null, bottom: null, left },
      height: { kind: "cells", value: rows },
    },
  });
/** A 20×8 host with a 4-wide anchor of `rows` at (`left`, `top`), and
 * the box's rect. */
const place = (box: LayoutNode, left = 6, rows = 1, top = 3) => {
  const root = makeNode({
    style: { minHeight: 8 },
    source: document.createElement("div"),
    children: [spacer(1), anchorAt(left, top, { rows }), box],
  });
  layoutRoot(root, 20);
  return { root, rect: box.localRect };
};
/** A box placed by its insets alone, anchored to `--a`. */
const inset = (insets: CellStyle["anchorInsets"], extra: Partial<CellStyle> = {}) =>
  makeNode({
    text: "x",
    source: document.createElement("div"),
    style: { position: "absolute", positionAnchor: "--a", anchorInsets: insets, ...extra },
  });

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

  it("sizes the box from its anchor's cells under anchor-size()", () => {
    const sized = (text: string, sizes: CellStyle["anchorSizes"], area: PositionArea) =>
      anchored(text, area, { style: { anchorSizes: sizes } });
    const below = { x: "span-end", y: "end" } as const;
    // At least as wide as the 4-wide anchor, wider for wider content.
    const minimum = { minWidth: { anchor: null, dimension: "width" } } as const;
    expect(place(sized("x", minimum, below)).rect).toMatchObject({ width: 4 });
    expect(place(sized("a wide menu", minimum, below)).rect).toMatchObject({ width: 11 });
    // As wide as the anchor under a min-width of max-content, as the UI
    // package's positioner has it: wider content widens it.
    const exact = { width: { anchor: null, dimension: "width" } } as const;
    const positioner = (text: string) =>
      anchored(text, below, { style: { anchorSizes: exact, minWidth: "max-content" } });
    expect(place(positioner("x")).rect).toMatchObject({ width: 4 });
    expect(place(positioner("a wide menu")).rect).toMatchObject({ width: 11 });
    // As tall as a 2-row anchor, beside it.
    const tall = { height: { anchor: null, dimension: "height" } } as const;
    expect(place(sized("x", tall, { x: "end", y: "span-end" }), 6, 2).rect).toMatchObject({
      height: 2,
    });
    // A name no anchor carries leaves the initial value, as in CSS.
    const lost = { minWidth: { anchor: "--none", dimension: "width" } } as const;
    expect(place(sized("x", lost, below)).rect).toMatchObject({ width: 1 });
  });

  it("insets the box to its anchor's sides under anchor()", () => {
    // The 4-wide anchor at (6, 3): under its right edge, and flush
    // left of it, its middle, a quarter along, and a named anchor
    // missing leaving auto.
    const under = inset({
      top: { anchor: null, fraction: 1 },
      left: { anchor: null, fraction: 1 },
    });
    expect(place(under).rect).toMatchObject({ x: 10, y: 4 });
    const before = inset({
      right: { anchor: null, fraction: 0 },
      top: { anchor: null, fraction: 0 },
    });
    expect(place(before).rect).toMatchObject({ x: 5, y: 3 });
    const middle = inset({
      left: { anchor: null, fraction: 0.5 },
      top: { anchor: null, fraction: 1 },
    });
    expect(place(middle).rect).toMatchObject({ x: 8, y: 4 });
    const quarter = inset({
      left: { anchor: null, fraction: 0.25 },
      top: { anchor: null, fraction: 1 },
    });
    expect(place(quarter).rect).toMatchObject({ x: 7, y: 4 });
    const lost = inset({
      top: { anchor: "--none", fraction: 1 },
      left: { anchor: null, fraction: 1 },
    });
    expect(place(lost).rect).toMatchObject({ x: 10 });
    expect(lost.style.insets.top).toBeNull();
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

  it("shifts the box along its anchor by a negative margin", () => {
    // Beside the anchor, top edges together, a row up: a submenu's first
    // item level with the item that opened it, past the submenu's border.
    const box = anchored(
      "x",
      { x: "end", y: "span-end" },
      { style: { margin: { top: -1, right: 0, bottom: 0, left: 0 } } },
    );
    expect(place(box).rect).toMatchObject({ x: 10, y: 2 });
  });

  it("mirrors the margins through a flip, so the gap follows the box", () => {
    // Two rows below the anchor in a 6-row host: two rows under a row
    // of margin overflow below and flip above, the margin its gap there
    // — the box ends at row 2, a row above the anchor.
    const box = anchored(
      "x",
      { x: "span-all", y: "end" },
      {
        style: {
          height: { kind: "cells", value: 2 },
          margin: { top: 1, right: 0, bottom: 0, left: 0 },
        },
      },
      [{ flips: ["block"] }],
    );
    const root = makeNode({ style: { minHeight: 6 }, children: [spacer(1), anchorAt(6), box] });
    layoutRoot(root, 20);
    expect(box.localRect).toMatchObject({ y: 0, height: 2 });
    expect(box.anchorArea).toEqual({ x: "span-all", y: "start" });
  });

  it("fits a box with its gap where the rows are exactly enough", () => {
    // The anchor's bottom at row 4 of 6: a row of gap and a row of box
    // fit below, so the first placement stands.
    const box = anchored(
      "x",
      { x: "span-all", y: "end" },
      { style: { margin: { top: 1, right: 0, bottom: 0, left: 0 } } },
      [{ flips: ["block"] }],
    );
    const root = makeNode({ style: { minHeight: 6 }, children: [spacer(1), anchorAt(6), box] });
    layoutRoot(root, 20);
    expect(box.localRect.y).toBe(5);
    expect(box.anchorArea).toEqual({ x: "span-all", y: "end" });
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
      [{ flips: ["block"] }],
    );
    const { rect } = place(tall);
    expect(rect.height).toBe(5);
    expect(rect.y).toBe(4);
    expect(tall.anchorArea).toEqual({ x: "span-all", y: "end" });
    const three = anchored(
      "a b c",
      { x: "span-all", y: "end" },
      { style: { width: { kind: "cells", value: 1 } } },
      [{ flips: ["block"] }],
    );
    // Shrink the space below to two rows: the host is 6 rows tall.
    const root = makeNode({ style: { minHeight: 6 }, children: [spacer(1), anchorAt(6), three] });
    layoutRoot(root, 20);
    expect(three.localRect.y).toBe(0);
    expect(three.anchorArea).toEqual({ x: "span-all", y: "start" });
    // Beside an anchor near the right edge, a wide box flips to the left,
    // flush against it.
    const wide = anchored("abcdefghijkl", { x: "end", y: "center" }, {}, [{ flips: ["inline"] }]);
    expect(place(wide, 14).rect.x).toBe(2);
    expect(wide.anchorArea).toEqual({ x: "start", y: "center" });
  });

  it("swaps the axes for flip-start, and takes an area of its own", () => {
    // The right column is 10 wide: a 12-wide box swaps to the rows below.
    const start = anchored("abcdefghijkl", { x: "end", y: "span-all" }, {}, [{ flips: ["start"] }]);
    place(start);
    expect(start.anchorArea).toEqual({ x: "span-all", y: "end" });
    const own = anchored("abcdefghijkl", { x: "end", y: "center" }, {}, [
      { x: "span-all", y: "start" },
    ]);
    place(own);
    expect(own.anchorArea).toEqual({ x: "span-all", y: "start" });
  });

  it("applies a tactic's flips in their written order", () => {
    // Too wide for the right column: start then block reaches the rows
    // above, spanning right; block then start, the narrow left column.
    const tactic = (flips: Flip[]) =>
      anchored("abcdefghijkl", { x: "end", y: "span-end" }, {}, [{ flips }]);
    const startBlock = tactic(["start", "block"]);
    place(startBlock);
    expect(startBlock.anchorArea).toEqual({ x: "span-end", y: "start" });
    const blockStart = tactic(["block", "start"]);
    place(blockStart);
    expect(blockStart.anchorArea, "nothing fits: the base stands").toEqual({
      x: "end",
      y: "span-end",
    });
  });

  it("mirrors self-alignment with the area", () => {
    // Beside an anchor at row 5, a 4-row box has 3 rows spanning down:
    // flipped to span up, its start alignment becomes end, its bottom
    // on the anchor's bottom.
    const box = anchored(
      "a b c d",
      { x: "end", y: "span-end" },
      { style: { width: { kind: "cells", value: 1 }, alignSelf: "start" } },
      [{ flips: ["block"] }],
    );
    expect(place(box, 6, 1, 5).rect).toMatchObject({ y: 2 });
  });
});

describe("the last successful placement", () => {
  /** A 3-row box under an anchor at `top`, flipping above, laid out in
   * a 20×8 host with the placements `remembered` from the last layout. */
  const source = document.createElement("div");
  const laidOut = (
    top: number,
    remembered: Map<Element, Remembered>,
    extra: Partial<CellStyle> = {},
  ) => {
    const box = anchored(
      "a b c",
      { x: "span-all", y: "end" },
      { source, style: { width: { kind: "cells", value: 1 }, ...extra } },
      [{ flips: ["block"] }],
    );
    const root = makeNode({
      style: { minHeight: 8 },
      source: document.createElement("div"),
      children: [anchorAt(6, top), box],
    });
    layoutRoot(root, 20, undefined, remembered);
    return box.anchorArea?.y;
  };

  it("keeps a flipped box where it last fit, trying again once it overflows there", () => {
    const remembered = new Map<Element, Remembered>();
    // At row 5, two rows below: it flips above.
    expect(laidOut(5, remembered)).toBe("start");
    // At row 3 both fit: it stays above.
    expect(laidOut(3, remembered)).toBe("start");
    // At row 1 one row above: it goes back below, and stays there.
    expect(laidOut(1, remembered)).toBe("end");
    expect(laidOut(3, remembered)).toBe("end");
  });

  it("forgets it when the box's styles change, or a layout leaves the box out", () => {
    const remembered = new Map<Element, Remembered>();
    expect(laidOut(5, remembered)).toBe("start");
    expect(laidOut(3, remembered, { margin: { top: 0, right: 0, bottom: 0, left: 1 } })).toBe(
      "end",
    );
    expect(laidOut(5, remembered)).toBe("start");
    layoutRoot(makeNode({ source: document.createElement("div") }), 20, undefined, remembered);
    expect(remembered.size).toBe(0);
    expect(laidOut(3, remembered)).toBe("end");
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
  it("places a fixed box against the anchor where the scroll shows it", () => {
    const still = anchored("x", { x: "end", y: "center" }, { style: { position: "fixed" } });
    expect(scrolledAnchor(still, 0).rect).toMatchObject({ x: 4, y: 3 });
    const box = anchored("x", { x: "end", y: "center" }, { style: { position: "fixed" } });
    const { root, list, rect } = scrolledAnchor(box, 2);
    expect(rect).toMatchObject({ x: 4, y: 1 });
    expect(root.anchorScrollers).toEqual(new Set([list.source]));
  });

  it("leaves a box in the same scroller where the layout put it, scrolling with the anchor", () => {
    const box = anchored("x", { x: "end", y: "center" });
    const { root, rect } = scrolledAnchor(box, 2);
    expect(rect).toMatchObject({ x: 4, y: 2 });
    expect(root.anchorScrollers).toBeUndefined();
  });

  it("reads an anchor in a fixed box's scroller at the scroll synced as the box is placed", () => {
    // A menu's list takes its size in the positioning pass: its scroll,
    // down 4 rows, reaches the submenu anchored to its sixth row.
    const anchor = makeNode({
      text: "ANCH",
      source: document.createElement("div"),
      style: { anchorNames: ["--a"], width: { kind: "cells", value: 4 } },
    });
    const list = makeNode({
      source: document.createElement("div"),
      style: { overflow: { x: "visible", y: "auto" }, height: { kind: "cells", value: 3 } },
      children: [spacer(5), anchor, spacer(4)],
    });
    const menu = makeNode({
      source: document.createElement("div"),
      style: { position: "fixed", width: { kind: "cells", value: 6 } },
      children: [list],
    });
    const submenu = anchored("x", { x: "end", y: "center" }, { style: { position: "fixed" } });
    const root = makeNode({
      style: { minHeight: 8 },
      source: document.createElement("div"),
      children: [menu, submenu],
    });
    layoutRoot(root, 20, () => {
      if (list.scrollRange) list.scroll = { x: 0, y: 4 };
    });
    expect(submenu.forceHidden).not.toBe(true);
    expect(submenu.localRect).toMatchObject({ x: 4, y: 1 });
    expect(root.anchorScrollers).toEqual(new Set([list.source]));
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

describe("a top-layer element inside a box position-visibility hides", () => {
  it("is flagged to show as authored, an invisible one not", () => {
    const top = (visible: boolean) => {
      const node = makeNode({
        text: "p",
        source: document.createElement("div"),
        style: { visible },
      });
      node.topLayerRank = 0;
      return node;
    };
    const shown = top(true);
    const hidden = top(false);
    const menu = makeNode({ source: document.createElement("div"), children: [shown, hidden] });
    menu.forceHidden = true;
    render(makeNode({ source: document.createElement("div"), children: [menu] }));
    expect(menu.source.hasAttribute("data-mw-force-hidden")).toBe(true);
    expect(shown.source.hasAttribute("data-mw-top-shown")).toBe(true);
    expect(hidden.source.hasAttribute("data-mw-top-shown")).toBe(false);
  });
});

describe("anchor() in layout", () => {
  it("stretches a box between two named anchors, and between an anchor's own two sides", () => {
    const between = inset({
      left: { anchor: "--a", fraction: 1 },
      right: { anchor: "--b", fraction: 0 },
      top: { anchor: "--a", fraction: 1 },
    });
    const root = makeNode({
      style: { minHeight: 8 },
      source: document.createElement("div"),
      children: [anchorAt(2), anchorAt(12, 3, { name: "--b" }), between],
    });
    layoutRoot(root, 20);
    expect(between.localRect).toMatchObject({ x: 6, y: 4, width: 6 });
    // Top on the anchor's top, bottom on its bottom: its rows.
    const rows = inset(
      { top: { anchor: null, fraction: 0 }, bottom: { anchor: null, fraction: 1 } },
      { insets: { top: null, right: null, bottom: null, left: 0 } },
    );
    expect(place(rows, 6, 3).rect).toMatchObject({ y: 3, height: 3 });
  });

  it("falls back to the length after the comma where no anchor resolves", () => {
    const box = inset({
      top: { anchor: "--none", fraction: 1, fallback: 2 },
      left: { anchor: null, fraction: 1 },
    });
    expect(place(box).rect).toMatchObject({ x: 10, y: 2 });
    const sized = anchored(
      "x",
      { x: "span-end", y: "end" },
      {
        style: { anchorSizes: { minWidth: { anchor: "--none", dimension: "width", fallback: 6 } } },
      },
    );
    expect(place(sized).rect).toMatchObject({ width: 6 });
    const zero = inset({ top: { anchor: "--none", fraction: 1, fallback: 0 } });
    expect(place(zero).rect).toMatchObject({ y: 0 });
  });

  it("resolves another axis's side to its fallback alone, else unsets the inset", () => {
    const fallback = inset({
      top: { anchor: null, fraction: null, fallback: 2 },
      left: { anchor: null, fraction: 1 },
    });
    expect(place(fallback).rect).toMatchObject({ x: 10, y: 2 });
    // A popover's UA `inset: 0` gives way: the top is auto, the bottom 0.
    const popover = inset(
      { top: { anchor: null, fraction: null } },
      { position: "fixed", insets: { top: 0, right: 0, bottom: 0, left: 0 } },
    );
    expect(place(popover).rect).toMatchObject({ y: 7 });
  });

  it("rounds an anchor's point once, so boxes on either side of it meet", () => {
    const anchor = anchorAt(6, 3, { text: "ANC" });
    const after = inset({
      left: { anchor: null, fraction: 0.5 },
      top: { anchor: null, fraction: 1 },
    });
    const before = inset({
      right: { anchor: null, fraction: 0.5 },
      top: { anchor: null, fraction: 1 },
    });
    const root = makeNode({
      style: { minHeight: 8 },
      source: document.createElement("div"),
      children: [anchor, after, before],
    });
    layoutRoot(root, 20);
    expect(before.localRect.x + before.localRect.width).toBe(after.localRect.x);
  });

  it("rounds the point from the anchor's edge, wherever the anchor sits", () => {
    // Half of a 3-wide anchor is two cells from its left edge, at 5 as
    // at -5.
    for (const left of [5, -5]) {
      const box = inset({ left: { anchor: null, fraction: 0.5 } });
      const root = makeNode({
        style: { minHeight: 8 },
        source: document.createElement("div"),
        children: [anchorAt(left, 3, { text: "ANC" }), box],
      });
      layoutRoot(root, 20);
      expect(box.localRect.x, `anchor at ${left}`).toBe(left + 2);
    }
  });

  it("centers a box on its anchor under anchor-center, auto insets as zero", () => {
    const centered = inset(
      { top: { anchor: null, fraction: 1 } },
      { anchorCenter: { x: true, y: false } },
    );
    // Under the 4-wide anchor at 6, a 1-wide box at its middle.
    expect(place(centered).rect).toMatchObject({ x: 7, y: 4 });
    // Near the edge, a 7-wide one shifts to stay in its containing block.
    const wide = inset(
      { top: { anchor: null, fraction: 1 } },
      { anchorCenter: { x: true, y: false }, width: { kind: "cells", value: 7 } },
    );
    expect(place(wide, 16).rect).toMatchObject({ x: 13, y: 4 });
  });
});

describe("the fallbacks of a box placed by its insets", () => {
  /** A 3-row box under a 4-row anchor, overflowing the host's 8 rows. */
  const under = (extra: Partial<CellStyle> = {}) =>
    inset(
      { top: { anchor: null, fraction: 1 }, left: { anchor: null, fraction: 0 } },
      { height: { kind: "cells", value: 3 }, ...extra },
    );
  const flipBlock = { flips: ["block"] } satisfies AnchorFallback;

  it("flips its anchor() sides with its insets, taking the first that fits", () => {
    expect(place(under(), 6, 4).rect).toMatchObject({ x: 6, y: 7 });
    // Flipped: bottom: anchor(top), the box ending on the anchor's top.
    const flipped = under({ positionTryFallbacks: [flipBlock] });
    expect(place(flipped, 6, 4).rect).toMatchObject({ x: 6, y: 0 });
    // Beside an anchor near the right edge: left: anchor(right) becomes
    // right: anchor(left), the box ending on the anchor's left.
    const beside = inset(
      { left: { anchor: null, fraction: 1 } },
      { width: { kind: "cells", value: 8 }, positionTryFallbacks: [{ flips: ["inline"] }] },
    );
    expect(place(beside, 14).rect).toMatchObject({ x: 6 });
  });

  it("rounds a flipped anchor() point from the mirrored edge", () => {
    // top: anchor(center) on a 1-row anchor at row 6 starts the box a
    // row under it; flipped, bottom: anchor(center) ends it a row above.
    const centered = inset(
      { top: { anchor: null, fraction: 0.5 } },
      { height: { kind: "cells", value: 2 }, positionTryFallbacks: [flipBlock] },
    );
    expect(place(centered, 6, 1, 6).rect).toMatchObject({ y: 4 });
  });

  it("mirrors the margins with the insets", () => {
    const gap = { top: 1, right: 0, bottom: 0, left: 0 };
    const flipped = under({
      positionTryFallbacks: [flipBlock],
      margin: gap,
      height: { kind: "cells", value: 2 },
    });
    // The gap moves under the 2-row box: it ends a row above the anchor.
    expect(place(flipped, 6, 4).rect).toMatchObject({ y: 0 });
  });

  it("swaps an anchor() onto the other axis under flip-start", () => {
    const start = under({
      positionTryFallbacks: [{ flips: ["start"] }],
    });
    // top: anchor(bottom) becomes left: anchor(right); left: anchor(left)
    // becomes top: anchor(top).
    expect(place(start, 6, 4).rect).toMatchObject({ x: 10, y: 3 });
  });

  it("moves anchor-center to the other axis under flip-start", () => {
    // top: anchor(bottom), centered across: 3 rows under the anchor's
    // row 5 overflow the 8, so flip-start places it at left:
    // anchor(right), centered on the anchor's row.
    const centered = inset(
      { top: { anchor: null, fraction: 1 } },
      {
        height: { kind: "cells", value: 3 },
        anchorCenter: { x: true, y: false },
        positionTryFallbacks: [{ flips: ["start"] }],
      },
    );
    expect(place(centered, 6, 1, 5).rect).toMatchObject({ x: 10, y: 4 });
  });

  it("takes an area of its own against its default anchor", () => {
    const own = under({ positionTryFallbacks: [{ x: "end", y: "center" }] });
    const { rect } = place(own, 6, 4);
    expect(rect).toMatchObject({ x: 10, y: 3 });
    expect(own.anchorArea).toEqual({ x: "end", y: "center" });
  });

  it("hides under no-overflow when its margin box leaves the block its insets leave", () => {
    const hidden = under(visibility({ noOverflow: true }));
    place(hidden, 6, 4);
    expect(hidden.forceHidden).toBe(true);
    const fits = under(visibility({ noOverflow: true }));
    place(fits, 6, 2);
    expect(fits.forceHidden).toBe(false);
  });
});

describe("position-try-order", () => {
  /** A box too wide beside the anchor, with room above (3 rows) and
   * below (4). */
  const tried = (order: CellStyle["positionTryOrder"]) =>
    anchored("a wide menu", { x: "end", y: "center" }, { style: { positionTryOrder: order } }, [
      { x: "span-all", y: "start" },
      { x: "span-all", y: "end" },
    ]);

  it("tries the fallbacks in order, or the roomiest first on the axis it names", () => {
    expect(place(tried("normal")).rect).toMatchObject({ y: 2 });
    expect(place(tried("most-height")).rect).toMatchObject({ y: 4 });
  });

  it("sorts by width under most-width", () => {
    // The left column (6) is too narrow; both spans below fit.
    const wide = (order: CellStyle["positionTryOrder"]) =>
      anchored("wide box", { x: "start", y: "center" }, { style: { positionTryOrder: order } }, [
        { x: "span-start", y: "end" },
        { x: "span-end", y: "end" },
      ]);
    expect(place(wide("normal")).rect).toMatchObject({ x: 2, y: 4 });
    expect(place(wide("most-width")).rect).toMatchObject({ x: 6, y: 4 });
  });

  it("sorts the base with the fallbacks, the roomiest first where the base fits too", () => {
    const fitting = (order: CellStyle["positionTryOrder"]) =>
      anchored("x", { x: "end", y: "center" }, { style: { positionTryOrder: order } }, [
        { x: "span-all", y: "end" },
      ]);
    expect(place(fitting("normal")).rect).toMatchObject({ x: 10, y: 3 });
    // The base's area is the anchor's one row; below it, four.
    expect(place(fitting("most-height")).rect).toMatchObject({ y: 4 });
  });

  it("sorts a box placed by its insets by the block they leave", () => {
    // Under an anchor at row 5 there are 2 rows; above it, 5.
    const box = (order: CellStyle["positionTryOrder"]) =>
      inset(
        { top: { anchor: null, fraction: 1 } },
        { positionTryOrder: order, positionTryFallbacks: [{ flips: ["block"] }] },
      );
    expect(place(box("normal"), 6, 1, 5).rect).toMatchObject({ y: 6 });
    expect(place(box("most-height"), 6, 1, 5).rect).toMatchObject({ y: 4 });
  });
});

describe("position-visibility", () => {
  it("hides a box whose anchor does not resolve under anchors-valid, as the initial value does not", () => {
    const lost = (value: Partial<CellStyle["positionVisibility"]>) => {
      const box = anchored(
        "lost",
        { x: "span-all", y: "end" },
        { style: { positionAnchor: "--none", ...visibility(value) } },
      );
      const { root } = place(box);
      return { box, art: renderPlainText(root) };
    };
    expect(lost({ anchorValid: true }).box.forceHidden).toBe(true);
    expect(lost({ anchorValid: true }).art).not.toContain("lost");
    expect(lost({ anchorVisible: true }).box.forceHidden).toBe(false);
    expect(lost({ anchorVisible: true }).art).toContain("lost");
  });

  it("hides a box that overflows after the fallbacks under no-overflow", () => {
    const wide = anchored(
      "a much too wide menu here",
      { x: "end", y: "center" },
      { style: visibility({ noOverflow: true }) },
    );
    place(wide);
    expect(wide.forceHidden).toBe(true);
    const fits = anchored(
      "x",
      { x: "end", y: "center" },
      { style: visibility({ noOverflow: true }) },
    );
    place(fits);
    expect(fits.forceHidden).toBe(false);
  });

  it("hides a fixed box whose anchor scrolled out of its scroller, and shows it back", () => {
    const fixed = (value: Partial<CellStyle["positionVisibility"]>) =>
      anchored(
        "x",
        { x: "end", y: "center" },
        { style: { position: "fixed", ...visibility(value) } },
      );
    const shown = fixed({ anchorVisible: true });
    scrolledAnchor(shown, 0);
    expect(shown.forceHidden).toBe(false);
    const gone = fixed({ anchorVisible: true });
    const { root, list } = scrolledAnchor(gone, 3);
    expect(gone.forceHidden).toBe(true);
    // The scroller relayouts the box, so it shows again as it scrolls back.
    expect(root.anchorScrollers).toEqual(new Set([list.source]));
    const always = fixed({});
    scrolledAnchor(always, 3);
    expect(always.forceHidden).toBe(false);
  });

  it("keeps a box in its anchor's own scroller visible, the scroller clipping both", () => {
    const box = anchored(
      "x",
      { x: "end", y: "center" },
      { style: visibility({ anchorVisible: true }) },
    );
    scrolledAnchor(box, 3);
    expect(box.forceHidden).toBe(false);
  });

  it("counts an anchor() naming none as needing the default anchor, a named one not", () => {
    const valid = visibility({ anchorValid: true });
    const own = inset(
      { top: { anchor: null, fraction: 1 } },
      { positionAnchor: "--none", ...valid },
    );
    place(own);
    expect(own.forceHidden).toBe(true);
    const named = inset(
      { top: { anchor: "--a", fraction: 1 } },
      { positionAnchor: null, ...valid },
    );
    place(named);
    expect(named.forceHidden).toBe(false);
  });

  it("hides a box whose anchor is hidden by its visibility", () => {
    const box = anchored(
      "x",
      { x: "end", y: "center" },
      { style: visibility({ anchorVisible: true }) },
    );
    const anchor = anchorAt(6);
    anchor.style.visible = false;
    layoutRoot(
      makeNode({
        style: { minHeight: 8 },
        source: document.createElement("div"),
        children: [anchor, box],
      }),
      20,
    );
    expect(box.forceHidden).toBe(true);
  });

  it("hides a submenu whose menu hid as its button scrolled away", () => {
    const chained = (rows: number) => {
      const item = makeNode({
        text: "ITEM",
        source: document.createElement("div"),
        style: { anchorNames: ["--item"] },
      });
      const menu = anchored(
        "",
        { x: "span-end", y: "end" },
        { style: { position: "fixed", ...visibility({ anchorVisible: true }) }, children: [item] },
      );
      const submenu = anchored(
        "SUB",
        { x: "end", y: "center" },
        {
          style: {
            position: "fixed",
            positionAnchor: "--item",
            ...visibility({ anchorVisible: true }),
          },
        },
      );
      scrolledAnchor(menu, rows, [submenu]);
      return { menu, submenu };
    };
    expect(chained(0).submenu.forceHidden).toBe(false);
    const { menu, submenu } = chained(3);
    expect(menu.forceHidden).toBe(true);
    expect(submenu.forceHidden).toBe(true);
  });

  it("judges an anchor in a fixed box by the clips and scrolls inside that box alone", () => {
    const opened = (rows: number) => {
      const item = makeNode({
        text: "ITEM",
        source: document.createElement("div"),
        style: { anchorNames: ["--item"] },
      });
      // A fixed menu declared in the scroller, painted under it.
      const menu = makeNode({
        source: document.createElement("div"),
        style: {
          position: "fixed",
          insets: { top: 5, right: null, bottom: null, left: 2 },
          width: { kind: "cells", value: 6 },
        },
        children: [item],
      });
      const submenu = anchored(
        "SUB",
        { x: "end", y: "center" },
        {
          style: {
            position: "fixed",
            positionAnchor: "--item",
            ...visibility({ anchorVisible: true }),
          },
        },
      );
      inScroller(menu, rows, [submenu]);
      return submenu;
    };
    for (const rows of [0, 1]) {
      const submenu = opened(rows);
      expect(submenu.forceHidden, `scrolled ${rows}`).toBe(false);
      expect(submenu.hostRect, `scrolled ${rows}`).toEqual({ x: 8, y: 5 });
    }
  });

  it("reads a fixed anchor where the host paints it, outside the scroller it is declared in", () => {
    const opened = (rows: number) => {
      const menu = makeNode({
        text: "MENU",
        source: document.createElement("div"),
        style: {
          anchorNames: ["--menu"],
          position: "fixed",
          insets: { top: 6, right: null, bottom: null, left: 2 },
        },
      });
      const box = anchored(
        "SUB",
        { x: "end", y: "center" },
        {
          style: {
            position: "fixed",
            positionAnchor: "--menu",
            ...visibility({ anchorVisible: true }),
          },
        },
      );
      inScroller(menu, rows, [box]);
      return box;
    };
    for (const rows of [0, 4]) {
      const box = opened(rows);
      expect(box.forceHidden, `scrolled ${rows}`).toBe(false);
      expect(box.hostRect, `scrolled ${rows}`).toEqual({ x: 6, y: 6 });
    }
  });

  it("sees a zero-height anchor while its edge is inside the scroller's window", () => {
    const box = (rows: number) => {
      const fixed = anchored(
        "x",
        { x: "end", y: "center" },
        { style: { position: "fixed", ...visibility({ anchorVisible: true }) } },
      );
      scrolledAnchor(fixed, rows, [], 0);
      return fixed.forceHidden;
    };
    expect(box(2)).toBe(false);
    expect(box(3)).toBe(true);
  });

  it("hides the whole subtree, a visible descendant too, from the paint and the hit", () => {
    const child = makeNode({ text: "inner", source: document.createElement("span") });
    const box = anchored(
      "",
      { x: "span-all", y: "end" },
      {
        style: { positionAnchor: "--none", ...visibility({ anchorValid: true }) },
        children: [child],
      },
    );
    const { root } = place(box);
    expect(renderPlainText(root)).not.toContain("inner");
    for (let col = 0; col < 20; col++) {
      for (let row = 0; row < 8; row++)
        expect(hitChain(root, col, row, null)).not.toContain(child.source);
    }
  });
});

/** A 20×8 host with, a row down, a 3-row scroller scrolled down
 * `rows`: `first` on its row 2 and `rest` after five more, `outside`
 * after the scroller. */
function inScroller(
  first: LayoutNode,
  rows: number,
  rest: LayoutNode[] = [],
  outside: LayoutNode[] = [],
) {
  const list = makeNode({
    source: document.createElement("div"),
    style: { overflow: { x: "visible", y: "auto" }, height: { kind: "cells", value: 3 } },
    children: [spacer(2), first, spacer(5), ...rest],
  });
  list.scroll = { x: 0, y: rows };
  const root = makeNode({
    style: { minHeight: 8 },
    source: document.createElement("div"),
    children: [spacer(1), list, ...outside],
  });
  layoutRoot(root, 20);
  return { root, list };
}

/** The 4-wide anchor `--a`, `height` rows tall, on row 2 of that
 * scroller (3 rows down puts it out of view), the box inside the
 * scroller or, fixed, after it, then `after`. */
function scrolledAnchor(box: LayoutNode, rows: number, after: LayoutNode[] = [], height = 1) {
  const anchor = makeNode({
    text: height > 0 ? "ANCH" : "",
    source: document.createElement("div"),
    style: {
      anchorNames: ["--a"],
      width: { kind: "cells", value: 4 },
      height: { kind: "cells", value: height },
    },
  });
  const inside = box.style.position !== "fixed";
  const { root, list } = inScroller(anchor, rows, inside ? [box] : [], [
    ...(inside ? [] : [box]),
    ...after,
  ]);
  return { root, list, rect: box.localRect };
}
