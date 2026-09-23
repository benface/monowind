import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { layersAt, paintGrid, syncLayers } from "../src/paint.ts";
import { renderGridRows, renderPlainText } from "../src/plain-text.ts";
import { readCellStyle } from "../src/style.ts";
import { zeroInsets } from "../src/types.ts";
import { clusterAdvances } from "../src/width.ts";
import type { Layer, LayoutNode } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Layers (specs/layers.md): the read of a layer root's effects, the
 * paint of its subtree into a grid of its own, and the nodes the DOM
 * adapter gives it. */

/** The layer cell under a point, the one painted last's. */
const layerAt = (layers: HTMLElement, x: number, y: number) =>
  layersAt(layers, x, y).next().value ?? null;

const read = (style: string): Layer | null => {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  document.body.appendChild(el);
  return readCellStyle(el, 16).layer;
};

describe("layer read", () => {
  it("is null without a transform or a filter", () => {
    expect(read("color: red")).toBeNull();
    expect(read("transform: none; translate: none; filter: none")).toBeNull();
  });

  it("opens on any one of the effects, carrying the backdrop filter", () => {
    for (const [effect, resampled] of [
      ["transform: rotate(3deg)", true],
      ["translate: 2px 4px", false],
      ["rotate: 5deg", true],
      ["scale: 1.5", true],
      ["filter: blur(2px)", false],
    ] as const) {
      expect(read(effect), effect).toEqual({ backdropFilter: "none", resampled });
    }
    expect(read("backdrop-filter: blur(2px)")).toEqual({
      backdropFilter: "blur(2px)",
      resampled: false,
    });
  });

  it("takes an identity as none", () => {
    expect(read("transform: matrix(1, 0, 0, 1, 0, 0)")).toBeNull();
    expect(read("transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)")).toBeNull();
    expect(read("scale: 1; rotate: 0deg; translate: 0px 0px")).toBeNull();
    expect(read("transform: matrix(1, 0, 0, 1, 2, 0)")).toEqual({
      backdropFilter: "none",
      resampled: false,
    });
    expect(read("scale: 1 1.5")).toEqual({ backdropFilter: "none", resampled: true });
  });

  it("marks the effects that draw the cells at another size or angle", () => {
    // What the tiling fit's pin cannot follow (specs/wide-characters.md).
    for (const effect of [
      "scale: 1.5",
      "scale: 1 1.5",
      "rotate: 5deg",
      "transform: rotate(3deg)",
      // As a browser serializes them: a scale, a skew, and 3D.
      "transform: matrix(1.5, 0, 0, 1.5, 0, 0)",
      "transform: matrix(1, 0, 0.05, 1, 0, 0)",
      "transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1)",
    ]) {
      expect(read(effect)?.resampled, effect).toBe(true);
    }
    // Carried whole, or drawn over: the cells stay on their grid.
    for (const effect of [
      "translate: 2px 4px",
      "transform: translate(10px, 5px)",
      "transform: matrix(1, 0, 0, 1, 2, 0)",
      "filter: blur(2px)",
      "backdrop-filter: blur(2px)",
    ]) {
      expect(read(effect)?.resampled, effect).toBe(false);
    }
  });
});

/** A layer root's read, for a node under test. */
const layered = (resampled = false): Layer => ({ backdropFilter: "none", resampled });

/** An element with the effects a layer root's node copies. */
const effects = (style: string): Element => {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  document.body.appendChild(el);
  return el;
};

const border = { top: 1, right: 1, bottom: 1, left: 1 };
const cells = (value: number) => ({ kind: "cells" as const, value });

/** The main grid's rows and each layer's, as joined strings. */
const rowsOf = (root: LayoutNode) => {
  const painted = renderGridRows(root);
  return {
    main: painted.cells.map((row) => row.join("")),
    layers: painted.layers.map(({ layer }) => ({
      x: layer.x,
      y: layer.y,
      rows: layer.grid.map((row) => row.join("")),
      parent: layer.parent,
      node: layer.node,
    })),
  };
};

describe("layer paint (specs/layers.md)", () => {
  it("paints a layer root's subtree into its own grid, the main grid untouched beneath", () => {
    const badge = makeNode({
      style: { width: cells(4), border, layer: layered(), margin: { ...zeroInsets(), left: 2 } },
      text: "ab",
      intrinsicWidth: 2,
    });
    const root = makeNode({
      style: { width: cells(8), border },
      children: [badge],
    });
    layoutRoot(root, 8);
    const { main, layers } = rowsOf(root);
    expect(main).toEqual(["┌──────┐", "│      │", "│      │", "│      │", "└──────┘"]);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ x: 3, y: 1, node: badge, parent: null });
    expect(layers[0]!.rows).toEqual(["┌──┐", "│ab│", "└──┘"]);
  });

  it("composites the layers back for the transcript", () => {
    const tree = (layer: Layer | null) => {
      const root = makeNode({
        style: { width: cells(8), border },
        children: [
          makeNode({ style: { width: cells(4), border, layer }, text: "ab", intrinsicWidth: 2 }),
        ],
      });
      layoutRoot(root, 8);
      return renderPlainText(root);
    };
    expect(tree(layered())).toBe(tree(null));
    expect(tree(layered())).toBe(
      ["┌──────┐", "│┌──┐  │", "││ab│  │", "│└──┘  │", "└──────┘"].join("\n"),
    );
  });

  it("shows the main grid through a layer's unpainted cells", () => {
    // A bare layer over the parent's fill: its blank cells are
    // transparent, the fill shows through them — a bg-clear's too.
    const root = makeNode({
      style: { width: cells(6), backgroundColor: "red" },
      children: [
        makeNode({ style: { width: cells(4), layer: layered() }, text: "ab", intrinsicWidth: 2 }),
        makeNode({
          style: { width: cells(4), layer: layered(), backgroundClear: true },
          text: "cd",
          intrinsicWidth: 2,
        }),
      ],
    });
    layoutRoot(root, 6);
    const painted = renderGridRows(root);
    expect(painted.segments.map((row) => row[0])).toEqual([
      { text: "      ", backgroundColor: "red" },
      { text: "      ", backgroundColor: "red" },
    ]);
    expect(painted.layers[0]!.segments[0]).toEqual([{ text: "ab  " }]);
    expect(painted.layers[1]!.segments[0]).toEqual([{ text: "cd  " }]);
    expect(renderPlainText(root)).toBe("ab\ncd");
  });

  it("tells the paint which cells a resampled layer draws", () => {
    // A tiling box's clip edge seams every row of a layer drawn at
    // another size or angle — its own, or an enclosing layer's — so the
    // paint declines the box there (specs/wide-characters.md).
    const stem = (layer: Layer | null) =>
      makeNode({ style: { width: cells(2), layer }, text: "\u2502", intrinsicWidth: 1 });
    const root = makeNode({
      style: { width: cells(8) },
      children: [
        stem(null),
        stem(layered(true)),
        makeNode({ style: { width: cells(2), layer: layered(true) }, children: [stem(layered())] }),
        stem(layered()),
      ],
    });
    layoutRoot(root, 8);
    const resampled: boolean[] = [];
    renderGridRows(root, {
      boxed: (_cluster, _cells, _paint, drawnResampled) => {
        resampled.push(drawnResampled);
        return true;
      },
    });
    // The grid's own cells, a resampling layer's, a layer inside one —
    // its box is a child of theirs — and a layer that only stacks.
    expect(resampled).toEqual([false, true, true, false]);
  });

  it("grows the extent by what overflows the border box", () => {
    const shadow = { x: 1, y: 1, blur: 0, spread: 0, color: "black", inset: false };
    const root = makeNode({
      style: { width: cells(10), height: cells(6) },
      children: [
        makeNode({
          style: { width: cells(4), border, layer: layered(), boxShadow: [shadow] },
          children: [makeNode({ style: { width: cells(6) }, text: "abcdef", intrinsicWidth: 6 })],
        }),
      ],
    });
    layoutRoot(root, 10);
    const { layers } = rowsOf(root);
    // The shadow adds a row below; the visible overflow, the child past
    // the right edge, two columns beyond the shadow's.
    expect(layers[0]).toMatchObject({ x: 0, y: 0 });
    expect(layers[0]!.rows.map((row) => row.length)).toEqual([7, 7, 7, 7]);
    expect(layers[0]!.rows[1]).toBe("│abcdef");
  });

  it("nests a layer inside another's, in paint order", () => {
    const inner = makeNode({
      style: { width: cells(2), layer: layered() },
      text: "x",
      intrinsicWidth: 1,
    });
    const outer = makeNode({
      style: { width: cells(6), border, layer: layered() },
      children: [inner],
    });
    const root = makeNode({ style: { width: cells(8) }, children: [outer] });
    layoutRoot(root, 8);
    const { layers } = rowsOf(root);
    expect(layers.map((layer) => layer.node)).toEqual([outer, inner]);
    expect(layers[0]!.parent).toBeNull();
    expect(layers[1]!.parent?.node).toBe(outer);
    expect(layers[1]).toMatchObject({ x: 1, y: 1 });
    expect(layers[0]!.rows).toEqual(["┌────┐", "│    │", "└────┘"]);
    expect(layers[1]!.rows).toEqual(["x "]);
  });

  it("covers a layer's cells with the ink painted after it", () => {
    // A rotated badge under a later overlay and a later glyph: the
    // covered cells leave the layer, the main grid paints them.
    const badge = makeNode({
      style: { width: cells(4), border, layer: layered(), position: "absolute" },
      text: "ab",
      intrinsicWidth: 2,
    });
    const overlay = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 2 },
        width: cells(4),
        height: cells(2),
        backgroundColor: "red",
      },
    });
    const glyph = makeNode({
      style: {
        position: "absolute",
        insets: { top: 2, right: null, bottom: null, left: 0 },
        width: cells(1),
      },
      text: "x",
      intrinsicWidth: 1,
    });
    const root = makeNode({
      style: { width: cells(8), height: cells(4), position: "relative" },
      children: [badge, overlay, glyph],
    });
    layoutRoot(root, 8);
    const painted = renderGridRows(root);
    const { main, layers } = rowsOf(root);
    expect(layers[0]!.rows).toEqual(["┌─  ", "│a  ", " ──┘"]);
    expect(painted.layers[0]!.segments[1]).toEqual([{ text: "│a  " }]);
    expect(main).toEqual(["        ", "        ", "x       ", "        "]);
    expect(painted.segments[0]).toEqual([
      { text: "  " },
      { text: "    ", backgroundColor: "red" },
      { text: "  " },
    ]);
    expect(renderPlainText(root)).toBe(["┌─", "│a", "x──┘", ""].join("\n"));
  });

  it("leaves a layer above the ink painted before it, a lower z-index included", () => {
    const badge = makeNode({
      style: { width: cells(4), border, layer: layered(), position: "absolute", zIndex: 1 },
      text: "ab",
      intrinsicWidth: 2,
    });
    const under = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 0 },
        width: cells(4),
        height: cells(3),
        backgroundColor: "red",
        zIndex: 0,
      },
    });
    const root = makeNode({
      style: { width: cells(8), height: cells(4), position: "relative" },
      children: [badge, under],
    });
    layoutRoot(root, 8);
    const { layers } = rowsOf(root);
    expect(layers[0]!.rows).toEqual(["┌──┐", "│ab│", "└──┘"]);
  });

  it("covers a nested layer's cells through its parent's", () => {
    const inner = makeNode({
      style: { width: cells(2), layer: layered(), position: "absolute" },
      text: "xy",
      intrinsicWidth: 2,
    });
    const over = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 1 },
        width: cells(2),
        height: cells(1),
        backgroundColor: "red",
      },
    });
    const outer = makeNode({
      style: { width: cells(6), layer: layered(), position: "relative", height: cells(1) },
      children: [inner, over],
    });
    const lid = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 0 },
        width: cells(1),
        height: cells(1),
        backgroundColor: "blue",
      },
    });
    const root = makeNode({
      style: { width: cells(8), height: cells(2), position: "relative" },
      children: [outer, lid],
    });
    layoutRoot(root, 8);
    const { layers } = rowsOf(root);
    // The over box (inside the outer layer) covers the inner's "y"; the
    // lid (in the main grid) covers the inner's "x" through the outer.
    expect(layers.map((layer) => layer.rows[0])).toEqual(["      ", "  "]);
  });

  it("keeps a layer's cells past an ancestor's clip, the clip with it", () => {
    // The browser clips the transformed result: the layer paints
    // every cell within the grid and carries the clip for its box;
    // the transcript, with no transform to clip after, culls on the
    // layout positions.
    const badge = makeNode({
      style: { width: cells(6), border, layer: layered() },
      text: "abcd",
      intrinsicWidth: 4,
    });
    const box = makeNode({
      style: { width: cells(4), height: cells(2), overflow: { x: "clip", y: "clip" } },
      children: [badge],
    });
    const root = makeNode({ style: { width: cells(8) }, children: [box] });
    layoutRoot(root, 8);
    const painted = renderGridRows(root);
    const { main, layers } = rowsOf(root);
    expect(main).toEqual(["        ", "        "]);
    expect(layers[0]).toMatchObject({ x: 0, y: 0 });
    expect(layers[0]!.rows).toEqual(["┌────┐", "│abcd│"]);
    expect(painted.layers[0]!.layer.clip).toEqual({ x0: 0, y0: 0, x1: 4, y1: 2 });
    expect(renderPlainText(root)).toBe("┌───\n│abc");
  });

  it("clips a layer through every clipping ancestor", () => {
    const badge = makeNode({
      style: { layer: layered(), whiteSpace: "nowrap" },
      text: "abcdef",
      intrinsicWidth: 6,
    });
    const inner = makeNode({
      style: { width: cells(5), overflow: { x: "clip", y: "visible" } },
      children: [badge],
    });
    const outer = makeNode({
      style: { width: cells(6), height: cells(1), overflow: { x: "visible", y: "clip" } },
      children: [inner],
    });
    const root = makeNode({ style: { width: cells(8) }, children: [outer] });
    layoutRoot(root, 8);
    const painted = renderGridRows(root);
    expect(painted.layers[0]!.layer.clip).toEqual({ x0: 0, y0: 0, x1: 5, y1: 1 });
    expect(painted.layers[0]!.layer.grid[0]!.join("")).toBe("abcdef");
    expect(renderPlainText(root)).toBe("abcde");
  });

  it("gives a nested layer the clips inside its parent alone", () => {
    // The outer layer's box carries the scroller's clip; the inner
    // layer, inside the outer's transformed box, carries only the
    // clip between the two roots.
    const badge = makeNode({
      style: { layer: layered(), whiteSpace: "nowrap" },
      text: "abcdef",
      intrinsicWidth: 6,
    });
    const between = makeNode({
      style: { width: cells(3), overflow: { x: "clip", y: "visible" } },
      children: [badge],
    });
    const card = makeNode({ style: { width: cells(5), layer: layered() }, children: [between] });
    const scroller = makeNode({
      style: { width: cells(4), height: cells(1), overflow: { x: "clip", y: "clip" } },
      children: [card],
    });
    const root = makeNode({ style: { width: cells(8), height: cells(3) }, children: [scroller] });
    layoutRoot(root, 8);
    const [outer, inner] = renderGridRows(root).layers.map(({ layer }) => layer);
    expect(outer!.clip).toEqual({ x0: 0, y0: 0, x1: 4, y1: 1 });
    expect(inner!.clip).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
    expect(inner!.grid[0]!.join("")).toBe("abcdef");
    expect(renderPlainText(root)).toBe("abc\n\n");
  });

  it("leaves a layer scrolled out of view empty", () => {
    // Scrolled two rows up, the badge's cells land on the grid above
    // its container's clip: nothing of it can show.
    const lines = makeNode({ text: "one\ntwo\nthree", intrinsicWidth: 5, intrinsicHeight: 3 });
    const badge = makeNode({ style: { layer: layered() }, text: "b", intrinsicWidth: 1 });
    const box = makeNode({
      style: {
        width: cells(6),
        height: cells(2),
        overflow: { x: "visible", y: "scroll" },
        margin: { ...zeroInsets(), top: 2 },
      },
      children: [badge, lines],
    });
    const root = makeNode({ style: { width: cells(6), height: cells(6) }, children: [box] });
    layoutRoot(root, 6);
    box.scroll = { x: 0, y: 2 };
    const { layers } = rowsOf(root);
    expect(layers[0]!.rows).toEqual([]);
  });

  it("paints a layer inside a scroll container at its scrolled cells", () => {
    const lines = makeNode({ text: "one\ntwo\nthree", intrinsicWidth: 5, intrinsicHeight: 3 });
    const badge = makeNode({ style: { layer: layered() }, text: "b", intrinsicWidth: 1 });
    const box = makeNode({
      style: { width: cells(6), height: cells(2), overflow: { x: "visible", y: "scroll" } },
      children: [lines, badge],
    });
    const root = makeNode({ style: { width: cells(6) }, children: [box] });
    layoutRoot(root, 6);
    box.scroll = { x: 0, y: 2 };
    const { main, layers } = rowsOf(root);
    expect(main[0]!.startsWith("three")).toBe(true);
    expect(layers[0]).toMatchObject({ x: 0, y: 1 });
    expect(layers[0]!.rows).toEqual(["b    "]);
  });

  it("paints a scroll container's bars inside its layer", () => {
    const box = makeNode({
      style: {
        width: cells(6),
        height: cells(2),
        overflow: { x: "visible", y: "scroll" },
        layer: layered(),
      },
      children: [makeNode({ text: "one\ntwo\nthree", intrinsicWidth: 5, intrinsicHeight: 3 })],
    });
    const root = makeNode({ style: { width: cells(6) }, children: [box] });
    layoutRoot(root, 6);
    const { main, layers } = rowsOf(root);
    expect(main).toEqual(["      ", "      "]);
    expect(layers[0]!.rows).toEqual(["one  █", "two  ░"]);
  });
});

describe("layer nodes (paint.ts)", () => {
  const cell = { width: 10, height: 20 };
  const paint = (root: LayoutNode, layers: HTMLElement) => {
    const target = document.createElement("pre");
    paintGrid(root, target, { layers, cell });
    return target;
  };

  it("gives each layer a box at its extent carrying the root's effects, its grid inside", () => {
    const layers = document.createElement("div");
    const root = makeNode({
      style: { width: cells(8), border },
      children: [
        makeNode({
          style: {
            width: cells(4),
            border,
            layer: { backdropFilter: "blur(1px)", resampled: false },
            margin: { ...zeroInsets(), left: 2 },
          },
          text: "ab",
          intrinsicWidth: 2,
          source: effects("transform: rotate(3deg); filter: blur(2px); transform-origin: 8px 16px"),
        }),
      ],
    });
    layoutRoot(root, 8);
    const target = paint(root, layers);
    expect(target.textContent!.split("\n")).toEqual([
      "┌──────┐",
      "│      │",
      "│      │",
      "│      │",
      "└──────┘",
    ]);
    expect(layers.children).toHaveLength(1);
    const box = layers.firstElementChild as HTMLElement;
    expect(box.className).toBe("layer");
    expect(box.style.left).toBe("30px");
    expect(box.style.top).toBe("20px");
    expect(box.style.width).toBe("40px");
    expect(box.style.height).toBe("60px");
    expect(box.style.transform).toBe("rotate(3deg)");
    expect(box.style.filter).toBe("blur(2px)");
    expect(box.style.backdropFilter).toBe("blur(1px)");
    expect(box.style.transformOrigin).toBe("8px 16px");
    const grid = box.firstElementChild as HTMLElement;
    expect(grid.tagName).toBe("PRE");
    expect(grid.className).toBe("grid");
    expect(grid.textContent!.split("\n")).toEqual(["┌──┐", "│ab│", "└──┘"]);
  });

  it("moves the origin by the extent's offset from the border box", () => {
    const layers = document.createElement("div");
    const shadow = { x: -1, y: -1, blur: 0, spread: 0, color: "black", inset: false };
    const root = makeNode({
      style: { width: cells(8), height: cells(5) },
      children: [
        makeNode({
          style: {
            width: cells(4),
            border,
            layer: layered(),
            boxShadow: [shadow],
            margin: { ...zeroInsets(), left: 2, top: 1 },
          },
          text: "ab",
          intrinsicWidth: 2,
          source: effects("rotate: 3deg; transform-origin: 8px 16px; translate: 20px 3px"),
        }),
      ],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    const box = layers.firstElementChild as HTMLElement;
    expect(box.style.left).toBe("10px");
    expect(box.style.transformOrigin).toBe("18px 36px");
    expect(box.style.rotate).toBe("3deg");
    expect(box.style.translate).toBe("20px 3px");
  });

  it("keeps a layer's nodes across paints, nests them, and drops a layer painted no more", () => {
    const layers = document.createElement("div");
    const sources = [document.createElement("div"), document.createElement("div")] as const;
    const tree = (withInner: boolean) => {
      const inner = makeNode({
        style: { width: cells(2), layer: layered() },
        text: "x",
        intrinsicWidth: 1,
        source: sources[1],
      });
      const outer = makeNode({
        style: { width: cells(6), border, layer: layered() },
        children: withInner ? [inner] : [],
        source: sources[0],
      });
      const root = makeNode({ style: { width: cells(8) }, children: [outer] });
      layoutRoot(root, 8);
      return { root, outer, inner };
    };
    paint(tree(true).root, layers);
    const outerBox = layers.firstElementChild as HTMLElement;
    expect(outerBox.children).toHaveLength(2);
    const innerBox = outerBox.lastElementChild as HTMLElement;
    expect(innerBox.className).toBe("layer");
    expect(innerBox.style.left).toBe("10px");
    expect(innerBox.style.top).toBe("20px");
    // The same elements: the nodes are kept per root element, in place
    // — a move would collapse a selection inside them.
    const moves = { container: 0, box: 0 };
    layers.insertBefore = () => (moves.container++, layers) as never;
    outerBox.insertBefore = () => (moves.box++, outerBox) as never;
    paint(tree(true).root, layers);
    expect(moves).toEqual({ container: 0, box: 0 });
    expect(layers.firstElementChild).toBe(outerBox);
    expect(outerBox.lastElementChild).toBe(innerBox);
    paint(tree(false).root, layers);
    expect(layers.firstElementChild).toBe(outerBox);
    expect(outerBox.children).toHaveLength(1);
  });

  it("re-places a box from its root's effects as they change", () => {
    const layers = document.createElement("div");
    const source = effects("rotate: 3deg") as HTMLElement;
    const root = makeNode({
      style: { width: cells(8) },
      children: [makeNode({ style: { layer: layered() }, text: "ab", intrinsicWidth: 2, source })],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    const box = layers.firstElementChild as HTMLElement;
    expect(box.style.rotate).toBe("3deg");
    source.style.rotate = "45deg";
    syncLayers(layers);
    expect(box.style.rotate).toBe("45deg");
  });

  it("composites a layer's wide cluster whole", () => {
    const leaf = makeNode({ style: { layer: layered() }, text: "日本", intrinsicWidth: 4 });
    leaf.advances = clusterAdvances(leaf.text, 0);
    const root = makeNode({ style: { width: cells(6) }, children: [leaf] });
    layoutRoot(root, 6);
    expect(renderGridRows(root).layers[0]!.layer.grid[0]).toEqual(["日", "", "本", "", " ", " "]);
    expect(renderPlainText(root)).toBe("日本");
  });

  it("maps a point through nested layers' transforms", () => {
    const layers = document.createElement("div");
    const inner = makeNode({
      style: { layer: layered(), margin: { ...zeroInsets(), left: 1, top: 1 } },
      text: "xy",
      intrinsicWidth: 2,
      source: effects("transform-origin: 0px 0px; translate: 5px 0px"),
    });
    const outer = makeNode({
      style: { width: cells(6), height: cells(3), layer: layered() },
      children: [inner],
      source: effects("transform-origin: 0px 0px; scale: 2 1"),
    });
    const root = makeNode({ style: { width: cells(8) }, children: [outer] });
    layoutRoot(root, 8);
    paint(root, layers);
    // The outer box doubles every x: the inner box, 1 cell in and moved
    // 5px, has its "y" (its second cell, 10px to 20px of its own) at
    // (10 + 5 + 10) × 2 = 50px to 70px.
    expect(layerAt(layers, 55, 30)).toMatchObject({ col: 2, row: 1 });
    expect(layerAt(layers, 45, 30)).toMatchObject({ col: 1, row: 1 });
  });

  it("maps a point through a rotation", () => {
    const layers = document.createElement("div");
    const root = makeNode({
      style: { width: cells(8), height: cells(4) },
      children: [
        makeNode({
          style: { width: cells(3), layer: layered() },
          text: "abc",
          intrinsicWidth: 3,
          source: effects("transform-origin: 0px 0px; rotate: 90deg"),
        }),
      ],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    // A quarter turn about the corner: the box's cell 2 (20px to 30px
    // across, 0 to 20px down) shows at x from -20px to 0, y from 20px
    // to 30px.
    expect(layerAt(layers, -10, 25)).toMatchObject({ col: 2, row: 0 });
    expect(layerAt(layers, -10, 5)).toMatchObject({ col: 0, row: 0 });
    expect(layerAt(layers, 10, 5)).toBeNull();
  });

  it("wraps a clipped layer in a box the browser clips", () => {
    const layers = document.createElement("div");
    const badge = makeNode({
      style: { width: cells(6), border, layer: layered() },
      text: "abcd",
      intrinsicWidth: 4,
      source: effects("rotate: 0.01deg"),
    });
    const box = makeNode({
      style: {
        width: cells(4),
        height: cells(2),
        overflow: { x: "clip", y: "clip" },
        margin: { ...zeroInsets(), left: 1, top: 1 },
      },
      children: [badge],
    });
    const root = makeNode({ style: { width: cells(8), height: cells(4) }, children: [box] });
    layoutRoot(root, 8);
    paint(root, layers);
    const clip = layers.firstElementChild as HTMLElement;
    expect(clip.className).toBe("clip");
    expect([clip.style.left, clip.style.top, clip.style.width, clip.style.height]).toEqual([
      "10px",
      "20px",
      "40px",
      "40px",
    ]);
    const layer = clip.firstElementChild as HTMLElement;
    expect(layer.className).toBe("layer");
    expect([layer.style.left, layer.style.top]).toEqual(["0px", "0px"]);
    // The pointer reaches the layer inside the clip alone; a cell past
    // it is the grid's.
    expect(layerAt(layers, 25, 30)).toMatchObject({ col: 2, row: 1 });
    expect(layerAt(layers, 55, 30)).toBeNull();
  });

  it("hits a hidden layer root's visible fill, not its own blank box", () => {
    const layers = document.createElement("div");
    const fill = makeNode({
      style: { width: cells(2), height: cells(1), backgroundColor: "red", visible: true },
    });
    const root = makeNode({
      style: { width: cells(8), height: cells(4) },
      children: [
        makeNode({
          style: { width: cells(4), height: cells(2), layer: layered(), visible: false },
          children: [fill],
          source: effects("rotate: 0.01deg"),
        }),
      ],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    // The fill's cells are blank glyphs, yet ink; the root's are neither.
    expect(layerAt(layers, 5, 10)).toMatchObject({ col: 0, row: 0 });
    expect(layerAt(layers, 35, 10)).toBeNull();
  });

  it("falls through a layer's covered cell to the ink over it", () => {
    const layers = document.createElement("div");
    const badge = makeNode({
      style: { width: cells(4), border, layer: layered(), position: "absolute" },
      text: "ab",
      intrinsicWidth: 2,
      source: effects(""),
    });
    const lid = makeNode({
      style: {
        position: "absolute",
        insets: { top: 1, right: null, bottom: null, left: 1 },
        width: cells(1),
        height: cells(1),
        backgroundColor: "red",
      },
    });
    const root = makeNode({
      style: { width: cells(8), height: cells(4), position: "relative" },
      children: [badge, lid],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    expect(layerAt(layers, 5, 30)).toMatchObject({ col: 0, row: 1 });
    expect(layerAt(layers, 15, 30)).toBeNull();
  });

  it("maps a point through a layer's transform to its cell, and off its blank cells", () => {
    const layers = document.createElement("div");
    const root = makeNode({
      style: { width: cells(8), height: cells(5) },
      children: [
        makeNode({
          style: {
            width: cells(4),
            border,
            layer: layered(),
            margin: { ...zeroInsets(), left: 2 },
          },
          children: [makeNode({ style: { width: cells(6) }, text: "abcdef", intrinsicWidth: 6 })],
          source: effects("transform-origin: 0px 0px; scale: 2 1; translate: 10px 0px"),
        }),
      ],
    });
    layoutRoot(root, 8);
    paint(root, layers);
    // The box is at 20px, moved 10px right, twice as wide: its cell 1
    // (the "a") spans 50px to 70px.
    expect(layerAt(layers, 55, 30)).toMatchObject({ col: 3, row: 1, x: 2, y: 0 });
    expect(layerAt(layers, 10, 30)).toBeNull();
    // Past the border box, the overflowing child's glyphs hit and the
    // blank cells beside them are see-through.
    expect(layerAt(layers, 120, 30)).toMatchObject({ col: 6, row: 1 });
    expect(layerAt(layers, 120, 10)).toBeNull();
  });
});
