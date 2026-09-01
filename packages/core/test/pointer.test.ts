import { describe, expect, it } from "vitest";
import { hitChain } from "../src/pointer.ts";
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

  it("skips table-hidden nodes", () => {
    const hidden = box("hidden", [0, 0, 4, 1]);
    hidden.tableHidden = true;
    const root = box("root", [0, 0, 10, 2], { children: [hidden] });
    expect(hitChain(root, 1, 0)).toEqual([]);
  });
});
