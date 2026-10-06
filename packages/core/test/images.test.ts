import { describe, expect, it } from "vitest";
import { intrinsicOuterWidth, layoutRoot, makeIntrinsicCache } from "../src/layout.ts";
import { pictureFit } from "../src/image.ts";
import { paintGrid } from "../src/paint.ts";
import { renderGridRows } from "../src/plain-text.ts";
import { pointsAround, selectedRanges, serializeSelection } from "../src/selection.ts";
import { buildTree } from "../src/tree.ts";
import { inlineBoxesOf, type LayoutNode } from "../src/types.ts";

/** Images as replaced boxes (specs/images.md "Sizing"), in a 1:2 cell
 * with a 16 px root: a cell is 4 px on the spacing scale, and a natural
 * ratio of 4:3 is 8 columns to 3 rows. The natural size is stubbed, as
 * happy-dom loads no image; how the browser maps an image's attributes
 * to its style is the stories'. */

/** An `<img>` loaded at a natural size, or loading (`null`), or broken. */
function stub(img: HTMLImageElement, natural: [number, number] | null | "broken"): void {
  const [width, height] = Array.isArray(natural) ? natural : [0, 0];
  Object.defineProperties(img, {
    naturalWidth: { get: () => width, configurable: true },
    naturalHeight: { get: () => height, configurable: true },
    complete: { get: () => natural !== null, configurable: true },
  });
}

/** The markup laid out in a container of `width` columns, the image
 * stubbed. */
function layOut(
  html: string,
  natural: [number, number] | null | "broken",
  width = 200,
): { root: LayoutNode; image: LayoutNode } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const container = host.firstElementChild!;
  const img = container.querySelector("img") ?? (container as HTMLImageElement);
  stub(img as HTMLImageElement, natural);
  const root = buildTree(container, 16)!;
  layoutRoot(root, width);
  return { root, image: find(root, img)! };
}

function find(node: LayoutNode, source: Element): LayoutNode | undefined {
  if (node.source === source) return node;
  for (const child of node.children) {
    const found = find(child, source);
    if (found) return found;
  }
  return undefined;
}

const size = (node: LayoutNode) => [node.localRect.width, node.localRect.height];

describe("an image's box", () => {
  it("takes its natural width on the spacing scale, its height from its natural ratio", () => {
    const { image } = layOut('<div><img style="display: block"></div>', [400, 300]);
    // 400 px is 100 columns; a 4:3 picture in 1:2 cells is 100 by 37.5 rows.
    expect(size(image)).toEqual([100, 38]);
  });

  it("narrows to its max-width, its height following", () => {
    const { image } = layOut(
      '<div><img style="display: block; max-width: 100%"></div>',
      [400, 300],
      50,
    );
    expect(size(image)).toEqual([50, 19]);
  });

  it("takes its width from a height set alone, through its ratio", () => {
    const { image } = layOut('<div><img style="display: block; height: 20px"></div>', [400, 300]);
    expect(size(image)).toEqual([13, 5]);
  });

  it("takes both sizes the author sets, as CSS does", () => {
    const { image } = layOut(
      '<div><img style="display: block; width: 80px; height: 40px"></div>',
      [400, 300],
    );
    expect(size(image)).toEqual([20, 10]);
  });

  it("draws `fill` as `cover` where rounding shaped its box, as written where the author did", () => {
    // A 1:2 cell, in cell widths: within half a cell of the image's
    // ratio is the rounding's shape.
    const cell = { width: 1, height: 2 };
    const fitOf = (style: string) => {
      const { width, height } = layOut(
        `<div><img style="display: block; ${style}"></div>`,
        [400, 300],
      ).image.localRect;
      return pictureFit("fill", { width: 400, height: 300 }, { width, height: height * 2 }, cell);
    };
    expect(fitOf("")).toBe("cover");
    expect(fitOf("width: 80px")).toBe("cover");
    expect(fitOf("aspect-ratio: auto 4 / 3")).toBe("cover");
    // A clamp, both sizes, a ratio of the author's own.
    expect(fitOf("width: 400px; max-height: 40px")).toBe("fill");
    expect(fitOf("width: 80px; height: 40px")).toBe("fill");
    expect(fitOf("width: 80px; aspect-ratio: 2 / 1")).toBe("fill");
  });

  it("takes its natural ratio over an `auto <ratio>`'s, as its attributes map to", () => {
    const { image } = layOut(
      '<div><img style="display: block; aspect-ratio: auto 1 / 1"></div>',
      [400, 300],
    );
    expect(size(image)).toEqual([100, 38]);
  });

  it("gives way to its container at min-content where a percentage sizes it", () => {
    // A compressible replaced box (css-sizing-3): none at min-content.
    for (const sizing of ["max-width: 100%", "width: 50%"]) {
      const { root } = layOut(`<div><img style="display: block; ${sizing}"></div>`, [400, 300]);
      expect(intrinsicOuterWidth(root, "min", makeIntrinsicCache()), sizing).toBe(0);
      expect(intrinsicOuterWidth(root, "max", makeIntrinsicCache()), sizing).toBe(100);
    }
  });

  it("gives way the same while it loads, down to a fixed min width", () => {
    const loading = layOut(
      '<div><img style="display: block; width: 600px; max-width: 100%"></div>',
      null,
    );
    expect(intrinsicOuterWidth(loading.root, "min", makeIntrinsicCache())).toBe(0);
    const floored = layOut(
      '<div><img style="display: block; min-width: 40px; max-width: 100%"></div>',
      [400, 300],
    );
    expect(intrinsicOuterWidth(floored.root, "min", makeIntrinsicCache())).toBe(10);
  });

  it("takes no box while it loads unsized", () => {
    const { image } = layOut('<div><img style="display: block"></div>', null);
    expect(size(image)).toEqual([0, 0]);
  });

  it("draws its alt as text once it fails", () => {
    const { image } = layOut('<div><img alt="A cat" style="display: block"></div>', "broken");
    expect(image.text).toBe("A cat");
    expect(image.image).toBeUndefined();
  });

  it("draws its alt's white space collapsed, as rendered text", () => {
    const { image } = layOut(
      '<div><img alt=" two\n   words " style="display: block"></div>',
      "broken",
    );
    expect(image.text).toBe("two words");
  });

  it("sits its bottom on the line's baseline, or its middle on it where middle", () => {
    const html = (align: string) => `<p>a <img style="width: 8px; vertical-align: ${align}"> b</p>`;
    // 2 columns of a 1:4 picture is 4 rows: the text on its last, or
    // its middle.
    expect(layOut(html("baseline"), [8, 32]).image.inlineTextRow).toBe(3);
    expect(layOut(html("middle"), [8, 32]).image.inlineTextRow).toBe(1);
    expect(layOut(html("top"), [8, 32]).image.inlineTextRow).toBe(0);
  });

  it("rides its line as an atomic inline box where it is inline", () => {
    const { root, image } = layOut('<p>a <img style="width: 8px"> b</p>', [8, 8]);
    expect(inlineBoxesOf(root)).toEqual([image]);
    expect(image.localRect.width).toBe(2);
  });
});

describe("an image's paint", () => {
  it("opens a surface of its own at its place in the paint order, which later ink covers", () => {
    // The caption comes first in the document but paints later, being
    // positioned: it covers the image, which a stacking context of the
    // image's own would have painted over it.
    const { root, image } = layOut(
      `<div style="position: relative">
        <span style="position: absolute; top: 0; left: 0">Hi</span>
        <img style="display: block">
      </div>`,
      [40, 20],
    );
    const { cells, layers } = renderGridRows(root);
    const layer = layers.find(({ layer }) => layer.node === image)?.layer;
    expect(layer).toBeDefined();
    expect([...layer!.holes].sort()).toEqual([0, 1]);
    expect(cells[0]!.slice(0, 2).join("")).toBe("Hi");
  });

  it("opens its surface inside its own layer where the image is a layer root", () => {
    const { root, image } = layOut(
      '<div><img style="display: block; translate: 4px 0"></div>',
      [16, 16],
    );
    const { layers } = renderGridRows(root);
    const own = layers.find(({ layer }) => layer.node === image && !layer.surface)?.layer;
    const surface = layers.find(({ layer }) => layer.surface === "picture")?.layer;
    expect(own).toBeDefined();
    expect(surface?.parent).toBe(own);
    const target = document.createElement("pre");
    const holder = document.createElement("div");
    document.body.append(target, holder);
    expect(() => paintGrid(root, target, { layers: holder })).not.toThrow();
  });

  it("takes its effects once where it is a layer root, its own layer's", () => {
    const { root } = layOut(
      '<div><img style="display: block; translate: 4px 0; opacity: 0.5; filter: blur(1px)"></div>',
      [16, 16],
    );
    const target = document.createElement("pre");
    const holder = document.createElement("div");
    document.body.append(target, holder);
    paintGrid(root, target, { layers: holder });
    const surface = holder.querySelector<HTMLElement>("canvas.picture")!.parentElement!;
    const own = surface.parentElement!.closest<HTMLElement>(".layer")!;
    expect(own.style.translate).not.toBe("none");
    expect([surface.style.translate, surface.style.filter, surface.style.opacity]).toEqual([
      "none",
      "none",
      "",
    ]);
  });

  it("keeps its picture while a new source loads", () => {
    const { root, image } = layOut('<div><img style="display: block"></div>', [16, 16]);
    const target = document.createElement("pre");
    const holder = document.createElement("div");
    document.body.append(target, holder);
    paintGrid(root, target, { layers: holder });
    expect(holder.querySelector("canvas.picture")).not.toBeNull();
    Object.defineProperty(image.source, "complete", { get: () => false });
    const again = buildTree(root.source, 16)!;
    layoutRoot(again, 200);
    paintGrid(again, target, { layers: holder });
    expect(holder.querySelector("canvas.picture")).not.toBeNull();
  });

  it("opens no surface where it is hidden", () => {
    const { root } = layOut(
      '<div><img style="display: block; visibility: hidden"></div>',
      [16, 16],
    );
    expect(renderGridRows(root).layers).toEqual([]);
  });
});

describe("an image under a selection", () => {
  it("is selected whole where a light-DOM range reaches it, an atomic box", () => {
    const { root, image } = layOut(
      '<div><p>above</p><img style="display: block"><p>below</p></div>',
      [40, 20],
    );
    const [above, , below] = Array.from(root.source.children);
    const range = (end: Node) => ({
      startContainer: above!.firstChild!,
      startOffset: 0,
      endContainer: end,
      endOffset: (end as Text).length,
    });
    expect(selectedRanges(root, range(below!.firstChild!)).get(image)).toEqual({
      start: 0,
      end: 1,
    });
    expect(selectedRanges(root, range(above!.firstChild!)).has(image)).toBe(false);
  });
});

describe("an image's cells in the grid", () => {
  it("are blank in the paint, its alt in them for a copy's render alone", () => {
    // 40 px square: 10 columns by 5 rows.
    const { root } = layOut(
      '<div><img alt="A sunset over the hills" style="display: block"></div>',
      [40, 40],
    );
    const row = (cells: string[][], y: number) => cells[y]!.join("").slice(0, 10);
    expect(row(renderGridRows(root).cells, 0)).toBe("          ");
    const copied = renderGridRows(root, { alt: true }).cells;
    expect([0, 1, 2].map((y) => row(copied, y))).toEqual([
      "A sunset  ",
      "over the  ",
      "hills     ",
    ]);
  });
});

/** A range around a node, its parent's points. */
const around = (node: LayoutNode) => {
  const { start, end } = pointsAround(node.source)!;
  return {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
  };
};

/** A range over all of the root's contents. */
const all = (root: LayoutNode) => ({
  startContainer: root.source,
  startOffset: 0,
  endContainer: root.source,
  endOffset: root.source.childNodes.length,
});

describe("an image's copy in text mode, its alt", () => {
  it("is its alt in the line, as a word of it", () => {
    const { root } = layOut('<p>See <img alt="the card" style="width: 40px"> here.</p>', [8, 8]);
    expect(serializeSelection(root, all(root))).toBe("See the card here.");
  });

  it("is its alt on a line of its own where it is a box, its white space collapsed", () => {
    const { root } = layOut(
      '<div>Above<img alt=" A sunset\n over  the hills " style="display: block">Below</div>',
      [40, 40],
    );
    expect(serializeSelection(root, all(root))).toBe("Above\nA sunset over the hills\nBelow");
  });

  it("is its alt alone, no border, where a range holds the image alone", () => {
    const { root, image } = layOut(
      '<p>See <img alt="the card" style="width: 16px; border: 4px solid"> here.</p>',
      [16, 16],
    );
    expect(serializeSelection(root, around(image))).toBe("the card");
  });

  it("is its alt where a range ends just past a link holding it", () => {
    const { root } = layOut(
      '<p>See <a href="#"><img alt="logo" style="width: 16px"></a> here.</p>',
      [16, 16],
    );
    const p = root.source;
    const points = { startContainer: p, startOffset: 0, endContainer: p, endOffset: 2 };
    expect(serializeSelection(root, points)).toBe("See logo");
  });

  it("is nothing where it has no alt", () => {
    const { root } = layOut('<div><img alt="" style="display: block"></div>', [16, 16]);
    expect(serializeSelection(root, all(root))).toBe("");
  });

  it("is nothing where it is hidden", () => {
    const { root } = layOut(
      '<div><p>a</p><img alt="secret" style="display: block; visibility: hidden"><p>b</p></div>',
      [16, 16],
    );
    expect(serializeSelection(root, all(root))).toBe("a\n\nb");
    expect(serializeSelection(root, all(root), { cells: true })).not.toContain("secret");
  });
});

describe("an image's copy in grid mode, its cells as the grid holds them", () => {
  const grid = { cells: true };

  it("is its alt in a line, as wide as the image", () => {
    // 40 px is 10 columns: the alt padded to them.
    const { root } = layOut('<p>See <img alt="the card" style="width: 40px"> here.</p>', [8, 8]);
    expect(serializeSelection(root, all(root), grid)).toBe("See the card   here.");
  });

  it("is its alt's lines in its rows, from the top, where it is a box", () => {
    const { root } = layOut(
      '<div><img alt="A sunset over the hills" style="display: block"></div>',
      [40, 40],
    );
    expect(serializeSelection(root, all(root), grid)).toBe(
      ["A sunset  ", "over the  ", "hills     ", "          ", "          "].join("\n"),
    );
  });

  it("is its cells where a range holds the image alone, its parent's points around it", () => {
    const { root, image } = layOut(
      '<p>See <img alt="the card" style="width: 8px"> here.</p>',
      [8, 8],
    );
    // 8 px is 2 columns: the alt's first line in them.
    expect(serializeSelection(root, around(image), grid)).toBe("th");
  });

  it("is its content box, the picture's, its border left out as the highlight leaves it", () => {
    // In a cell of border all round.
    const { root } = layOut(
      '<div><img alt="card" style="display: block; border: 4px solid"></div>',
      [16, 16],
    );
    expect(serializeSelection(root, all(root), grid)).toBe("card");
  });

  it("is its content's row its line's text sits on where it is inline, its border left out", () => {
    const { root } = layOut(
      '<p>See <img alt="the card" style="width: 24px; border: 4px solid"> here.</p>',
      [16, 16],
    );
    const copied = serializeSelection(root, all(root), grid);
    expect(copied).not.toMatch(/[┏┓┗┛━┃]/);
    expect(copied).toMatch(/^See the +here\.$/);
  });

  it("is the rows its clip shows", () => {
    // 64 px tall in a box 8 px, 2 rows, tall: its first 2 rows show.
    const { root } = layOut(
      `<div><p>top</p><div style="height: 8px; overflow: hidden"><img alt="tall" style="display: block"></div><p>bottom text</p></div>`,
      [16, 64],
    );
    expect(serializeSelection(root, all(root), grid)).toBe("top\n\ntall\n    \n\nbottom text");
  });

  it("is its alt where the image is a layer root", () => {
    const { root } = layOut(
      '<div><img alt="card" style="display: block; translate: 4px 0"></div>',
      [16, 16],
    );
    expect(serializeSelection(root, all(root), grid)).toBe("card\n    ");
  });

  it("is the blank cells it fills where it has no alt", () => {
    // 16 px square: 4 columns by 2 rows.
    const { root } = layOut('<div><img alt="" style="display: block"></div>', [16, 16]);
    expect(serializeSelection(root, all(root), grid)).toBe("    \n    ");
  });
});
