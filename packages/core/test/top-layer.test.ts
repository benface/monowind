import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { paintGrid } from "../src/paint.ts";
import { renderGridRows } from "../src/plain-text.ts";
import { hitStack } from "../src/pointer.ts";
import { readCellStyle } from "../src/style.ts";
import { TopLayer, isTopLayer } from "../src/top-layer.ts";
import type { LayoutNode } from "../src/types.ts";
import { layered, makeNode, scrollBox } from "./helpers.ts";

/** The top layer (specs/top-layer.md): the read, the stack, the paint
 * after the tree from the host's origin, the backdrop tint, and the
 * pointer through it. */

/** An element that reports itself in the top layer, as the browser
 * would through `:popover-open` or `:modal`. */
const opened = (attributes: Record<string, string> = {}, open = true, tag = "div"): HTMLElement => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  document.body.appendChild(el);
  (el as { matches: (selector: string) => boolean }).matches = (selector) =>
    selector === ":popover-open, :modal" ? open : Element.prototype.matches.call(el, selector);
  return el;
};

describe("top layer read", () => {
  it("marks an open popover or modal dialog, laid out as a fixed box of the UA's geometry", () => {
    const style = readCellStyle(opened({ popover: "" }), 16);
    expect(style.topLayer).toBe(true);
    expect(style.position).toBe("fixed");
    expect(style.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(style.width).toEqual({ kind: "fit-content" });
    expect(style.height).toEqual({ kind: "fit-content" });
    expect(style.margin).toEqual({ top: null, right: null, bottom: null, left: null });
    expect(style.backdrop).toBeNull();
  });

  it("keeps the author's classes and inline style over the defaults", () => {
    const el = opened({ popover: "", class: "mt-2 w-10", style: "left: 3ch" });
    const style = readCellStyle(el, 16);
    expect(style.margin.top).not.toBeNull();
    expect(style.margin.left).toBeNull();
    expect(style.width).toEqual({ kind: "cells", value: 10 });
    expect(style.insets.left).not.toBe(0);
    expect(style.insets.top).toBe(0);
  });

  it("gives a displayed popover its geometry through its exit, off the stack", () => {
    const style = readCellStyle(opened({ popover: "" }, false), 16);
    expect(style.topLayer).toBe(false);
    expect(style.position).toBe("fixed");
    expect(style.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("leaves other elements alone", () => {
    const style = readCellStyle(opened({}, false), 16);
    expect(style.topLayer).toBe(false);
    expect(style.position).toBe("static");
    expect(isTopLayer(opened({}, false))).toBe(false);
    expect(isTopLayer(opened({}))).toBe(false);
    expect(isTopLayer(opened({ popover: "" }))).toBe(true);
    expect(isTopLayer(opened({}, true, "dialog"))).toBe(true);
  });
});

/** A laid-out tree with its stack assigned. */
const painted = (root: LayoutNode, width = 20, stack = new TopLayer()) => {
  layoutRoot(root, width);
  stack.assign(root);
  return renderGridRows(root);
};
const rowsOf = (root: LayoutNode, width = 20, stack?: TopLayer) =>
  painted(root, width, stack).cells.map((row) => row.join("").trimEnd());
const top = (text: string, x: number, y: number, extra: Parameters<typeof makeNode>[0] = {}) =>
  makeNode({
    text,
    source: document.createElement("div"),
    ...extra,
    style: {
      topLayer: true,
      position: "fixed",
      insets: { top: y, right: null, bottom: null, left: x },
      ...extra.style,
    },
  });
const scroller = (children: LayoutNode[], rows: number) =>
  makeNode({
    style: { overflow: { x: "visible", y: "auto" }, height: { kind: "cells", value: rows } },
    children,
  });
const spacer = (rows: number) => makeNode({ style: { height: { kind: "cells", value: rows } } });

describe("the stack", () => {
  it("ranks the elements found open in tree order, the toggled ones in their order", () => {
    const a = top("A", 0, 0);
    const b = top("B", 0, 0);
    const root = makeNode({ style: { minHeight: 2 }, children: [a, b] });
    layoutRoot(root, 10);
    const stack = new TopLayer();
    stack.assign(root);
    expect(root.topLayer!.map((entry) => entry.node)).toEqual([a, b]);
    expect(root.topLayer![0]!.ancestors).toEqual([root]);
    // Opened later, an element stacks on top, whatever its place in
    // the tree.
    const again = new TopLayer();
    again.enter(b.source);
    again.enter(a.source);
    again.assign(root);
    expect(root.topLayer!.map((entry) => entry.node)).toEqual([b, a]);
    expect(rowsOf(root, 10, again)[0]).toBe("A");
  });

  it("drops an element the tree no longer holds, and ranks it anew when it returns", () => {
    const a = top("A", 0, 0);
    const b = top("B", 0, 0);
    const stack = new TopLayer();
    const both = makeNode({ style: { minHeight: 2 }, children: [a, b] });
    layoutRoot(both, 10);
    stack.assign(both);
    const only = makeNode({ style: { minHeight: 2 }, children: [b] });
    layoutRoot(only, 10);
    stack.assign(only);
    expect(only.topLayer!.map((entry) => entry.node)).toEqual([b]);
    layoutRoot(both, 10);
    stack.assign(both);
    expect(both.topLayer!.map((entry) => entry.node)).toEqual([b, a]);
  });
});

describe("the UA's placement", () => {
  /** A dialog's geometry: the UA's insets and auto margins, which
   * center it in what it resolves against. */
  const dialog = (text: string) =>
    top(text, 0, 0, {
      intrinsicWidth: text.length,
      style: {
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: null, right: null, bottom: null, left: null },
        width: { kind: "fit-content" },
        height: { kind: "fit-content" },
      },
    });

  it("centers an element in the host, and in the cells the viewport shows of a taller one", () => {
    const root = makeNode({ style: { minHeight: 20 }, children: [dialog("dialog")] });
    layoutRoot(root, 20);
    // The whole host shows: centered in its 20 rows, a row tall.
    expect(root.children[0]!.localRect.y).toBe(9);
    // Only rows 12 to 20 show — the page scrolled the rest off: the
    // dialog opens centered THERE, never out of sight.
    const scrolled = makeNode({ style: { minHeight: 20 }, children: [dialog("dialog")] });
    scrolled.visibleCells = { x: 0, y: 12, width: 20, height: 8 };
    layoutRoot(scrolled, 20);
    expect(scrolled.children[0]!.localRect.y).toBe(15);
    expect(scrolled.children[0]!.hostRect).toEqual({ x: 7, y: 15 });
  });

  it("leaves an element the host's own box where nothing of the host shows", () => {
    const root = makeNode({ style: { minHeight: 20 }, children: [dialog("dialog")] });
    // A band past the host's cells meets none of them.
    root.visibleCells = { x: 0, y: 40, width: 20, height: 8 };
    layoutRoot(root, 20);
    expect(root.children[0]!.localRect.y).toBe(9);
  });

  it("leaves an ordinary fixed box the host, which it anchors to (specs/positioning.md)", () => {
    const fixed = makeNode({
      text: "fixed",
      source: document.createElement("div"),
      intrinsicWidth: 5,
      style: {
        position: "fixed",
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: null, right: null, bottom: null, left: null },
        width: { kind: "fit-content" },
        height: { kind: "fit-content" },
      },
    });
    const root = makeNode({ style: { minHeight: 20 }, children: [fixed] });
    root.visibleCells = { x: 0, y: 12, width: 20, height: 8 };
    layoutRoot(root, 20);
    expect(fixed.localRect.y).toBe(9);
  });
});

describe("top layer paint", () => {
  it("paints a fixed box inside a scroller at the host's cells, unmoved by the scroll", () => {
    const fixed = makeNode({
      text: "FIX",
      style: { position: "fixed", insets: { top: 0, right: null, bottom: null, left: 0 } },
    });
    const lines = Array.from({ length: 6 }, (_, i) => makeNode({ text: `line${i}` }));
    const box = scroller([...lines, fixed], 3);
    const root = makeNode({ children: [spacer(2), box] });
    expect(rowsOf(root)[0]).toBe("FIX");
    expect(fixed.hostRect).toEqual({ x: 0, y: 0 });
    scrollBox(root, box, 0, 2);
    const rows = renderGridRows(root).cells.map((row) => row.join("").trimEnd());
    expect(rows[0]).toBe("FIX");
    expect(rows[2]!.startsWith("line2")).toBe(true);
  });

  it("paints the stack after the tree, over a later sibling and outside a scroller's clip", () => {
    const menu = top("MENU", 0, 3);
    const box = scroller([makeNode({ text: "item" }), menu], 2);
    const root = makeNode({
      style: { minHeight: 6 },
      children: [box, makeNode({ text: "afterwards" })],
    });
    const rows = rowsOf(root);
    expect(rows[0]).toBe("item");
    expect(rows[2]).toBe("afterwards");
    expect(rows[3]).toBe("MENU");
  });

  it("stacks two elements in stack order, and lays their layers in it", () => {
    const first = top("FIRST", 0, 0);
    const second = top("SECOND", 0, 0);
    const root = makeNode({ style: { minHeight: 2 }, children: [second, first] });
    const stack = new TopLayer();
    stack.enter(first.source);
    stack.enter(second.source);
    expect(rowsOf(root, 20, stack)[0]).toBe("SECOND");
    // A layer root inside the stack paints into a layer of its own,
    // above the main grid.
    const badge = makeNode({
      text: "badge",
      style: { layer: layered() },
    });
    const dialog = top("", 0, 0, { children: [badge] });
    const page = makeNode({ children: [makeNode({ text: "page" }), dialog] });
    const { cells, layers } = painted(page);
    expect(cells[0]!.join("").trimEnd()).toBe("page");
    expect(layers).toHaveLength(1);
    expect(layers[0]!.layer.grid[0]!.join("").trimEnd()).toBe("badge");
  });

  it("covers a layer beneath, and ignores a layer root above", () => {
    const sticker = makeNode({
      text: "sticker",
      style: { layer: layered() },
    });
    const modal = top("MODAL", 0, 0);
    const root = makeNode({ children: [sticker, modal] });
    const { cells, layers } = painted(root);
    expect(cells[0]!.join("").trimEnd()).toBe("MODAL");
    expect(layers[0]!.layer.grid[0]!.join("").trimEnd()).toBe("     er");
    // Inside a layer root's subtree, the stack still paints on the
    // main grid, untransformed.
    const pop = top("POP", 0, 1);
    const turned = makeNode({
      style: { layer: layered() },
      children: [makeNode({ text: "turned" }), pop],
    });
    const page = makeNode({ style: { minHeight: 2 }, children: [turned] });
    const rows = rowsOf(page);
    expect(rows[1]).toBe("POP");
    expect(renderGridRows(page).layers[0]!.layer.grid.map((row) => row.join("").trimEnd())).toEqual(
      ["turned"],
    );
  });
});

describe("top layer opacity", () => {
  it("blends an element at its own opacity, its ancestors' escaped", () => {
    const pop = top("POP", 0, 0, { style: { opacity: 0.4, color: "rgb(0 0 0)" } });
    const dim = makeNode({ style: { opacity: 0.25 }, children: [makeNode({ text: "dim" }), pop] });
    const root = makeNode({ style: { minHeight: 2 }, children: [dim] });
    const { segments } = painted(root);
    const shown = segments[0]!.find((segment) => segment.text.startsWith("POP"))!;
    expect([shown.color, shown.opacity]).toEqual(["rgb(0 0 0)", 0.4]);
  });
});

describe("the backdrop box", () => {
  const cell = { width: 10, height: 20 };
  const backdrop = {
    backgroundColor: "rgb(0 0 0 / 0.5)",
    backgroundImage: "none",
    backdropFilter: "blur(2px)",
    opacity: "1",
  };

  it("draws the backdrop over the grid, beneath the element's own box, and removes it with the backdrop", () => {
    const dialog = top("D", 0, 0, {
      style: { backdrop, layer: layered() },
    });
    const root = makeNode({
      style: { minHeight: 3 },
      children: [makeNode({ text: "page" }), dialog],
    });
    layoutRoot(root, 12);
    new TopLayer().assign(root);
    const layers = document.createElement("div");
    const target = document.createElement("pre");
    paintGrid(root, target, { layers, cell });
    expect(target.textContent!.split("\n")[0]!.trimEnd()).toBe("page");
    expect(Array.from(layers.children).map((child) => child.className)).toEqual([
      "backdrop",
      "layer",
    ]);
    const box = layers.firstElementChild as HTMLElement;
    expect(box.style.width).toBe("120px");
    expect(box.style.height).toBe("60px");
    expect(box.style.backgroundColor).toBe("rgb(0 0 0 / 0.5)");
    expect(box.style.backdropFilter).toBe("blur(2px)");
    expect(layers.lastElementChild!.textContent!.trimEnd()).toBe("D");
    // Gone with the backdrop, the element's box staying.
    dialog.style.backdrop = null;
    paintGrid(root, target, { layers, cell });
    expect(Array.from(layers.children).map((child) => child.className)).toEqual(["layer"]);
  });
});

describe("the pointer through the stack", () => {
  it("hits the stack before the grid beneath, with the element's ancestors, and a fixed box unclipped", () => {
    const menu = top("MENU", 0, 3);
    const fixed = makeNode({
      text: "FIX",
      style: { position: "fixed", insets: { top: 0, right: null, bottom: null, left: 10 } },
    });
    const box = scroller([makeNode({ text: "item" }), menu, fixed], 2);
    const after = makeNode({ text: "afterwards" });
    const root = makeNode({ style: { minHeight: 6 }, children: [box, after] });
    painted(root);
    expect(hitStack(root, 1, 3, null)).toEqual([box, menu]);
    expect(hitStack(root, 6, 2, null)).toEqual([after]);
    expect(hitStack(root, 11, 0, null)).toEqual([box, fixed]);
  });

  it("places an element's ancestors where they paint, a fixed one from the host", () => {
    const menu = top("MENU", 0, 4);
    const fixed = makeNode({
      style: { position: "fixed", insets: { top: 0, right: null, bottom: null, left: 10 } },
      children: [makeNode({ text: "FIX" }), menu],
    });
    const lines = Array.from({ length: 4 }, (_, i) => makeNode({ text: `line${i}` }));
    const box = scroller([...lines, fixed], 2);
    const root = makeNode({ style: { minHeight: 6 }, children: [spacer(1), box] });
    painted(root);
    scrollBox(root, box, 0, 1);
    const stack = hitStack(root, 1, 4, null);
    expect(stack.map((node) => [node, node.paintOrigin.x, node.paintOrigin.y])).toEqual([
      [box, 0, 1],
      [fixed, 10, 0],
      [menu, 0, 4],
    ]);
  });
});
