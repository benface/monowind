import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { hitChain, nearestCells, scrollStep } from "../src/pointer.ts";
import { buildTree } from "../src/tree.ts";
import { makeNode } from "./helpers.ts";
import type { LayoutNode } from "../src/types.ts";

/** A node with a hand-set border-box rect (hitChain only reads rects,
 * children, paint order, and tableHidden — no layout pass needed). */
function box(
  name: string,
  rect: [x: number, y: number, width: number, height: number],
  overrides: Parameters<typeof makeNode>[0] = {},
): LayoutNode {
  const node = makeNode({ source: { name } as unknown as Element, ...overrides });
  node.localRect = { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
  return node;
}

const names = (chain: Element[]) => chain.map((el) => (el as unknown as { name: string }).name);

describe("hitChain", () => {
  it("returns the innermost element plus its ancestors, outermost first", () => {
    const inner = box("inner", [1, 1, 4, 1]);
    const outer = box("outer", [2, 0, 10, 3], { children: [inner] });
    const root = box("root", [0, 0, 20, 5], { children: [outer] });
    // Cell inside inner: rects nest (inner is at absolute 3,1).
    expect(names(hitChain(root, 3, 1))).toEqual(["outer", "inner"]);
    // Cell inside outer but past inner.
    expect(names(hitChain(root, 8, 1))).toEqual(["outer"]);
  });

  it("misses gaps and out-of-bounds cells", () => {
    const a = box("a", [0, 0, 3, 1]);
    const b = box("b", [0, 2, 3, 1]);
    const root = box("root", [0, 0, 10, 4], { children: [a, b] });
    expect(hitChain(root, 1, 1)).toEqual([]); // the gap row between them
    expect(hitChain(root, 50, 0)).toEqual([]);
    expect(hitChain(root, -1, 0)).toEqual([]);
  });

  it("resolves overlapping siblings to the topmost in paint order", () => {
    const under = box("under", [0, 0, 4, 1]);
    const over = box("over", [2, 0, 4, 1]);
    const root = box("root", [0, 0, 10, 2], { children: [under, over] });
    // Document order breaks the tie in the overlap.
    expect(names(hitChain(root, 3, 0))).toEqual(["over"]);
    // z-index beats document order — where CSS lets it apply (a
    // positioned child; it stays inert on static block-flow ones).
    under.style.position = "relative";
    under.style.zIndex = 1;
    expect(names(hitChain(root, 3, 0))).toEqual(["under"]);
  });

  it("stops at a clipping container's padding box, as the paint does", () => {
    const child = box("child", [1, 1, 8, 5]);
    const scroller = box("scroller", [0, 0, 10, 4], {
      style: {
        overflow: { x: "scroll", y: "scroll" },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      children: [child],
    });
    scroller.scrollGutterCells = { right: 1, bottom: 0 };
    const root = box("root", [0, 0, 12, 8], { children: [scroller] });
    expect(names(hitChain(root, 2, 2))).toEqual(["scroller", "child"]);
    // The bottom border row and the gutter column: the child sits
    // beneath, unpainted.
    expect(names(hitChain(root, 2, 3))).toEqual(["scroller"]);
    expect(names(hitChain(root, 8, 2))).toEqual(["scroller"]);
  });

  it("hits a text leaf's ink past its box, an unwrapped line overflowing", () => {
    const line = box("line", [1, 1, 8, 1]);
    line.textExtent = { width: 20, rows: 1 };
    const scroller = box("scroller", [0, 0, 12, 3], {
      style: { overflow: { x: "scroll", y: "scroll" } },
      children: [line],
    });
    const root = box("root", [0, 0, 30, 5], { children: [scroller] });
    expect(names(hitChain(root, 10, 1))).toEqual(["scroller", "line"]);
    // Its own clip keeps the ink inside the box.
    line.style.overflow = { x: "clip", y: "clip" };
    expect(names(hitChain(root, 10, 1))).toEqual(["scroller"]);
  });

  it("skips table-hidden nodes", () => {
    const hidden = box("hidden", [0, 0, 4, 1]);
    hidden.tableHidden = true;
    const root = box("root", [0, 0, 10, 2], { children: [hidden] });
    expect(hitChain(root, 1, 0)).toEqual([]);
  });
});

describe("hitChain in a paragraph-flow multicol container", () => {
  it("hits the paragraph whose line fragment is under the cell, not the last one", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="column-count: 2; column-gap: 4px; width: 36px"><p>aaa bbb</p><p>ccc ddd</p></div>`;
    document.body.appendChild(host);
    const root = buildTree(host, 16)!;
    layoutRoot(root, 60);
    const rows = renderPlainText(root).split("\n");
    const [first, second] = Array.from(host.querySelectorAll("p"));
    const cellOf = (glyph: string) => {
      const row = rows.findIndex((line) => line.includes(glyph));
      return { col: rows[row]!.indexOf(glyph), row };
    };
    const a = cellOf("aaa");
    const d = cellOf("ddd");
    expect(hitChain(root, a.col, a.row).at(-1)).toBe(first);
    expect(hitChain(root, d.col, d.row).at(-1)).toBe(second);
    // A cell in the gap between the columns hits the container only.
    expect(hitChain(root, a.col + 4, a.row).at(-1)).toBe(host.firstElementChild);
  });
});

describe("nearestCells", () => {
  const order = (width: number, height: number, col: number, row: number) =>
    Array.from(nearestCells(width, height, col, row), ({ x, y, edge }) => `${x},${y}${edge[0]}`);

  it("tries the cell, its row outward, then the rows above and below", () => {
    expect(order(4, 3, 1, 1)).toEqual([
      "1,1s",
      "0,1e",
      "2,1s",
      "3,1s",
      "3,0e",
      "2,0e",
      "1,0e",
      "0,0e",
      "0,2s",
      "1,2s",
      "2,2s",
      "3,2s",
    ]);
  });

  it("clamps a cell past the grid and yields nothing for an empty one", () => {
    expect(order(2, 1, 9, -3)).toEqual(["1,0s", "0,0e"]);
    expect(order(0, 3, 0, 0)).toEqual([]);
  });
});

describe("scrollStep (specs/wide-characters.md auto-scroll)", () => {
  it("counts the cells past each edge, rounded up, zero inside", () => {
    const box = { left: 10, top: 20, right: 110, bottom: 60 };
    const cell = { width: 8, height: 16 };
    expect(scrollStep(box, { x: 50, y: 40 }, cell)).toEqual({ x: 0, y: 0 });
    expect(scrollStep(box, { x: 111, y: 61 }, cell)).toEqual({ x: 1, y: 1 });
    expect(scrollStep(box, { x: 130, y: 100 }, cell)).toEqual({ x: 3, y: 3 });
    expect(scrollStep(box, { x: 0, y: 3 }, cell)).toEqual({ x: -2, y: -2 });
    expect(scrollStep(box, { x: 110, y: 20 }, cell)).toEqual({ x: 0, y: 0 });
  });
});
