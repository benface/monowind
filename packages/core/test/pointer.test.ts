import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { paintGrid } from "../src/paint.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { cellAtPoint, hitChain, nearestCells, pointKey, scrollStep } from "../src/pointer.ts";
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
    expect(names(hitChain(root, 3, 1, null))).toEqual(["outer", "inner"]);
    // Cell inside outer but past inner.
    expect(names(hitChain(root, 8, 1, null))).toEqual(["outer"]);
  });

  it("misses gaps and out-of-bounds cells", () => {
    const a = box("a", [0, 0, 3, 1]);
    const b = box("b", [0, 2, 3, 1]);
    const root = box("root", [0, 0, 10, 4], { children: [a, b] });
    expect(hitChain(root, 1, 1, null)).toEqual([]); // the gap row between them
    expect(hitChain(root, 50, 0, null)).toEqual([]);
    expect(hitChain(root, -1, 0, null)).toEqual([]);
  });

  it("resolves overlapping siblings to the topmost in paint order", () => {
    const under = box("under", [0, 0, 4, 1]);
    const over = box("over", [2, 0, 4, 1]);
    const root = box("root", [0, 0, 10, 2], { children: [under, over] });
    // Document order breaks the tie in the overlap.
    expect(names(hitChain(root, 3, 0, null))).toEqual(["over"]);
    // z-index beats document order — where CSS lets it apply (a
    // positioned child; it stays inert on static block-flow ones).
    under.style.position = "relative";
    under.style.zIndex = 1;
    expect(names(hitChain(root, 3, 0, null))).toEqual(["under"]);
  });

  it("passes through a box that takes no pointer events, to what is beneath", () => {
    const under = box("under", [0, 0, 6, 1]);
    const overlay = box("overlay", [0, 0, 6, 2], { style: { pointerEvents: false } });
    const root = box("root", [0, 0, 10, 3], { children: [under, overlay] });
    // Painted over `under`, the overlay leaves the cell to it.
    expect(names(hitChain(root, 2, 0, null))).toEqual(["under"]);
    // Where nothing is beneath, nothing is hit.
    expect(names(hitChain(root, 2, 1, null))).toEqual([]);
  });

  it("still hits a child that takes pointer events inside one that does not", () => {
    const button = box("button", [1, 0, 3, 1]);
    const overlay = box("overlay", [0, 0, 6, 2], {
      style: { pointerEvents: false },
      children: [button],
    });
    const root = box("root", [0, 0, 10, 3], { children: [overlay] });
    // Its ancestors carry the hover as natively, the box passed through
    // among them.
    expect(names(hitChain(root, 2, 0, null))).toEqual(["overlay", "button"]);
    expect(names(hitChain(root, 5, 1, null))).toEqual([]);
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
    expect(names(hitChain(root, 2, 2, null))).toEqual(["scroller", "child"]);
    // The bottom border row and the gutter column: the child sits
    // beneath, unpainted.
    expect(names(hitChain(root, 2, 3, null))).toEqual(["scroller"]);
    expect(names(hitChain(root, 8, 2, null))).toEqual(["scroller"]);
  });

  it("hits a text leaf's ink past its box, an unwrapped line overflowing", () => {
    const line = box("line", [1, 1, 8, 1]);
    line.textExtent = { width: 20, rows: 1 };
    const scroller = box("scroller", [0, 0, 12, 3], {
      style: { overflow: { x: "scroll", y: "scroll" } },
      children: [line],
    });
    const root = box("root", [0, 0, 30, 5], { children: [scroller] });
    expect(names(hitChain(root, 10, 1, null))).toEqual(["scroller", "line"]);
    // Its own clip keeps the ink inside the box.
    line.style.overflow = { x: "clip", y: "clip" };
    expect(names(hitChain(root, 10, 1, null))).toEqual(["scroller"]);
  });

  it("skips table-hidden nodes", () => {
    const hidden = box("hidden", [0, 0, 4, 1]);
    hidden.tableHidden = true;
    const root = box("root", [0, 0, 10, 2], { children: [hidden] });
    expect(hitChain(root, 1, 0, null)).toEqual([]);
  });
});

describe("hitChain through an inline element that takes pointer events again", () => {
  it("hits its characters in a paragraph that takes none, over the box beneath", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="position: relative"><div data-test="zone">zone text here</div><p data-test="p" style="pointer-events: none; position: absolute; top: 0; left: 0">aa <a data-test="link" style="pointer-events: auto">link</a></p></div>`;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 20);
    const chain = (col: number) =>
      hitChain(root, col, 0, null).map((el) => el.getAttribute("data-test"));
    // The link's cells are its paragraph's, as natively: its ancestors
    // hover, the paragraph among them.
    expect(chain(4)).toEqual(["p"]);
    // The paragraph's own text passes the pointer to the zone.
    expect(chain(0)).toEqual(["zone"]);
  });
});

describe("the pointer's cell through a layer (specs/layers.md)", () => {
  const cell = { width: 10, height: 20 };
  const layer = { backdropFilter: "none", resampled: false };

  /** Nodes over real elements, `markup` naming each by its data-test,
   * painted with their layers placed; the chain under a point in px. */
  function scene(markup: string, build: (node: typeof at) => LayoutNode) {
    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.appendChild(host);
    function at(
      name: string,
      rect: [x: number, y: number, width: number, height: number],
      overrides: Parameters<typeof makeNode>[0] = {},
    ): LayoutNode {
      const source = name === "root" ? host : host.querySelector(`[data-test="${name}"]`)!;
      const node = makeNode({ source, ...overrides });
      node.localRect = { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
      return node;
    }
    const root = build(at);
    const grid = document.createElement("pre");
    const layers = document.createElement("div");
    paintGrid(root, grid, { layers, cell });
    return (x: number, y: number) => {
      const hit = cellAtPoint(root, layers, grid, x, y, cell);
      const chain = hitChain(root, hit.col, hit.row, hit.layerRoot);
      return {
        chain: chain.map((el) => el.getAttribute("data-test")),
        onMainGrid: hit.grid === grid,
      };
    };
  }

  const badgeMarkup = `<div data-test="wrapper"><div data-test="button"></div><div data-test="badge" style="translate: 20px 0px"></div></div>`;
  const badgeScene = (pointerEvents: boolean) =>
    scene(badgeMarkup, (at) =>
      at("root", [0, 0, 10, 2], {
        children: [
          at("wrapper", [0, 0, 6, 1], {
            children: [
              at("button", [0, 0, 6, 1]),
              at("badge", [4, 0, 2, 1], {
                style: { layer, pointerEvents, position: "absolute" },
              }),
            ],
          }),
        ],
      }),
    );

  it("passes a layer that takes no pointer events to what lies beneath where it is drawn", () => {
    // Laid out over the button's end, drawn two cells past it: the
    // point is off the button.
    expect(badgeScene(false)(65, 10)).toEqual({ chain: [], onMainGrid: true });
  });

  it("gives a layer's cell to the layer where it takes pointer events", () => {
    expect(badgeScene(true)(65, 10)).toEqual({ chain: ["wrapper", "badge"], onMainGrid: false });
  });

  it("hits the box a layer that takes no pointer events is drawn over", () => {
    const pointAt = scene(
      `<div data-test="row"><div data-test="button"></div><div data-test="tip" style="translate: -100px 0px"></div></div>`,
      (at) =>
        at("root", [0, 0, 20, 2], {
          children: [
            at("row", [0, 0, 20, 1], {
              children: [
                at("button", [0, 0, 6, 1]),
                at("tip", [10, 0, 3, 1], {
                  style: { layer, pointerEvents: false, position: "absolute" },
                }),
              ],
            }),
          ],
        }),
    );
    expect(pointAt(15, 10)).toEqual({ chain: ["row", "button"], onMainGrid: true });
  });

  it("leaves a layer's cell to its own subtree, not a box at its laid-out cells", () => {
    // A transparent overlay painted after the layer sits where the
    // layer was laid out, not where it is drawn.
    const pointAt = scene(
      `<div data-test="moved" style="translate: 50px 0px"></div><div data-test="overlay"></div>`,
      (at) =>
        at("root", [0, 0, 10, 2], {
          children: [
            at("moved", [0, 0, 2, 1], { style: { layer, position: "absolute" } }),
            at("overlay", [0, 0, 2, 1], { style: { position: "absolute" } }),
          ],
        }),
    );
    expect(pointAt(55, 10)).toEqual({ chain: ["moved"], onMainGrid: false });
    expect(pointAt(5, 10)).toEqual({ chain: ["overlay"], onMainGrid: true });
  });

  it("hits a layer drawn into its clipping ancestor's view, laid out past it", () => {
    // A carousel's track, translated so its second slide shows: the
    // slide's laid-out cells are past the view's clip, its drawn ones
    // inside it.
    const pointAt = scene(
      `<div data-test="view"><div data-test="track" style="translate: -40px 0px"><div data-test="one"></div><div data-test="two"></div></div></div>`,
      (at) =>
        at("root", [0, 0, 10, 2], {
          children: [
            at("view", [0, 0, 4, 1], {
              style: { overflow: { x: "clip", y: "clip" } },
              children: [
                at("track", [0, 0, 8, 1], {
                  style: { layer },
                  children: [at("one", [0, 0, 4, 1]), at("two", [4, 0, 4, 1])],
                }),
              ],
            }),
          ],
        }),
    );
    expect(pointAt(15, 10)).toEqual({ chain: ["view", "track", "two"], onMainGrid: false });
  });

  it("gives the pointer to a box painted over a layer where the layer is drawn", () => {
    // A stretched link over a card whose icon is translated: the link
    // paints after the icon, so it takes the icon's drawn cells.
    const pointAt = scene(
      `<div data-test="card"><div data-test="icon" style="translate: 10px 0px"></div><div data-test="link"></div></div>`,
      (at) =>
        at("root", [0, 0, 10, 2], {
          children: [
            at("card", [0, 0, 8, 1], {
              children: [
                at("icon", [2, 0, 2, 1], { style: { layer } }),
                at("link", [0, 0, 8, 1], { style: { position: "absolute" } }),
              ],
            }),
          ],
        }),
    );
    expect(pointAt(35, 10)).toEqual({ chain: ["card", "link"], onMainGrid: true });
  });

  it("gives the pointer to a top-layer box over a layer", () => {
    const pointAt = scene(
      `<div data-test="moved" style="translate: 30px 0px"></div><div data-test="popover"></div>`,
      (at) => {
        const popover = at("popover", [0, 0, 10, 2], { style: { position: "fixed" } });
        popover.topLayerRank = 0;
        popover.hostRect = { x: 0, y: 0 };
        const root = at("root", [0, 0, 10, 2], {
          children: [at("moved", [0, 0, 3, 1], { style: { layer } }), popover],
        });
        root.topLayer = [{ node: popover, ancestors: [root] }];
        return root;
      },
    );
    expect(pointAt(45, 10)).toEqual({ chain: ["popover"], onMainGrid: true });
  });

  it("keys a point by its main-grid cell and every layer's cell under it", () => {
    // Drawn half a cell right: the layer's cells change between the main
    // grid's.
    const host = document.createElement("div");
    host.innerHTML = `<div data-test="moved" style="translate: 5px 0px"></div>`;
    document.body.appendChild(host);
    const moved = makeNode({ source: host.firstElementChild!, style: { layer } });
    moved.localRect = { x: 0, y: 0, width: 4, height: 1 };
    const root = makeNode({ source: host, children: [moved] });
    root.localRect = { x: 0, y: 0, width: 10, height: 2 };
    const layers = document.createElement("div");
    paintGrid(root, document.createElement("pre"), { layers, cell });
    const key = (x: number) => pointKey(layers, x, 10, cell);
    expect(key(16)).toEqual(key(18));
    expect(key(12)).not.toEqual(key(16));
    expect(key(12)).toEqual([1, 0, moved, 0, 0]);
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
    expect(hitChain(root, a.col, a.row, null).at(-1)).toBe(first);
    expect(hitChain(root, d.col, d.row, null).at(-1)).toBe(second);
    // A cell in the gap between the columns hits the container only.
    expect(hitChain(root, a.col + 4, a.row, null).at(-1)).toBe(host.firstElementChild);
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
