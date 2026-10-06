import { afterEach, describe, expect, it, vi } from "vitest";
import { intrinsicOuterWidth, layoutRoot, makeIntrinsicCache } from "../src/layout.ts";
import { regionClip } from "../src/native.ts";
import { placePainted } from "../src/paint-origin.ts";
import {
  renderGridRows,
  renderPlainText,
  screenRows,
  type PaintedLayer,
} from "../src/plain-text.ts";
import { hitChain } from "../src/pointer.ts";
import { classifySelection, serializeSelection } from "../src/selection.ts";
import { buildRoot, buildTree } from "../src/tree.ts";
import { inlineBoxesOf, type LayoutNode } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Native regions (specs/native-regions.md), `mw-native`'s variable set
 * inline, with a 16 px root: a cell is 4 px on the spacing scale. */

const NATIVE = "--mw-native: 1";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The markup's first element, built and laid out `width` columns wide. */
function layOut(html: string, width = 80): LayoutNode {
  const container = document.createElement("div");
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  const root = buildTree(container.firstElementChild!, 16)!;
  layoutRoot(root, width);
  return root;
}

/** The box of the element `selector` names in the layout's markup. */
function find(root: LayoutNode, selector: string): LayoutNode {
  const el = root.source.matches(selector) ? root.source : root.source.querySelector(selector)!;
  const found = search(root, el);
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
}

function search(node: LayoutNode, source: Element): LayoutNode | undefined {
  if (node.source === source && !node.anonymous) return node;
  for (const child of node.children) {
    const found = search(child, source);
    if (found) return found;
  }
  return undefined;
}

const size = (node: LayoutNode) => [node.localRect.width, node.localRect.height];

describe("a native region's box", () => {
  it("is a leaf of its own: the engine builds none of its contents", () => {
    const root = layOut(
      `<div><div data-test="region" style="${NATIVE}"><p>inside</p> text <span>more</span></div></div>`,
    );
    const region = find(root, '[data-test="region"]');
    expect(region.native).toEqual({ replaced: false, inline: false });
    expect(region.children).toEqual([]);
    expect(region.text).toBe("");
  });

  it("takes the sizes, padding and border the author sets, in cells", () => {
    const root = layOut(
      `<div><div data-test="region" style="${NATIVE}; width: 40px; height: 32px; padding: 4px; border: 1px solid">text</div></div>`,
    );
    const region = find(root, '[data-test="region"]');
    expect(size(region)).toEqual([10, 8]);
    expect(region.resolvedPadding).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    expect(region.style.border).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
  });

  it("lays out as a block, whatever display its contents take", () => {
    const root = layOut(
      `<div><div data-test="flex" style="${NATIVE}; display: flex"><p>a</p></div>` +
        `<div data-test="grid" style="${NATIVE}; display: grid; grid-template-columns: 1fr 1fr"><p>a</p></div>` +
        `<div data-test="columns" style="${NATIVE}; column-count: 2"><p>a</p></div></div>`,
    );
    for (const selector of ['[data-test="flex"]', '[data-test="grid"]', '[data-test="columns"]']) {
      const { style } = find(root, selector);
      expect([style.display, style.columnCount], selector).toEqual(["block", null]);
    }
  });

  it("scrolls as the browser's, never the engine's", () => {
    const root = layOut(
      `<div><div data-test="region" style="${NATIVE}; height: 8px; overflow: auto"><p>a</p><p>b</p><p>c</p></div></div>`,
    );
    const region = find(root, '[data-test="region"]');
    expect(region.style.overflow).toEqual({ x: "hidden", y: "hidden" });
    expect(region.scrollRange).toBeUndefined();
  });

  it("has no line of the grid's: no leading, no tracking", () => {
    const root = layOut(
      `<div><div data-test="region" style="${NATIVE}; line-height: 3; letter-spacing: 8px">text</div></div>`,
    );
    const { style } = find(root, '[data-test="region"]');
    expect([style.lineGap, style.tracking]).toEqual([0, 0]);
  });

  it("sets a font size of its own unwarned", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    layOut(`<div><div style="${NATIVE}; font-size: 24px">text</div></div>`);
    expect(warn).not.toHaveBeenCalled();
  });

  it("holds an image's element, which draws no picture of the grid's", () => {
    const container = document.createElement("div");
    container.innerHTML = `<img style="${NATIVE}; display: block">`;
    document.body.appendChild(container);
    Object.defineProperties(container.firstElementChild!, {
      naturalWidth: { get: () => 400 },
      naturalHeight: { get: () => 300 },
      complete: { get: () => true },
    });
    const region = find(buildTree(container, 16)!, "img");
    expect(region.native).toEqual({ replaced: true, inline: false });
    expect(region.image).toBeUndefined();
  });
});

describe("an inline native region", () => {
  it("rides its line as one atomic box", () => {
    const root = layOut(
      `<p>before <span data-test="region" style="${NATIVE}; width: 20px; height: 8px">inside</span> after</p>`,
    );
    const region = find(root, '[data-test="region"]');
    expect(inlineBoxesOf(root)).toEqual([region]);
    expect(region.native).toEqual({ replaced: false, inline: true });
    expect(root.text).toBe("before ￼ after");
    expect(size(region)).toEqual([5, 2]);
  });

  it("keeps the blocks inside it, which split no line", () => {
    const root = layOut(
      `<p>before <span data-test="region" style="${NATIVE}"><div>block</div></span> after</p>`,
    );
    expect(root.text).toBe("before ￼ after");
    expect(root.children).toEqual([find(root, '[data-test="region"]')]);
  });

  it("aligns to its line's top or bottom, a replaced one's baseline at its bottom and middle at its center", () => {
    const align = (style: string, tag = "span") =>
      find(
        layOut(`<p>a <${tag} data-test="region" style="${NATIVE}; ${style}"></${tag}> b</p>`),
        '[data-test="region"]',
      ).style.verticalAlign;
    expect(align("vertical-align: middle")).toBe("start");
    expect(align("vertical-align: baseline")).toBe("start");
    expect(align("vertical-align: bottom")).toBe("end");
    expect(align("vertical-align: baseline", "iframe")).toBe("end");
    expect(align("vertical-align: middle", "iframe")).toBe("center");
  });
});

describe("mw-native", () => {
  it("is no region on a `display: contents` element, which has no box", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = layOut(
      `<div><div data-test="contents" style="${NATIVE}; display: contents"><p data-test="inner">inside</p></div></div>`,
    );
    expect(find(root, '[data-test="inner"]').native).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("display: contents"),
      expect.anything(),
    );
  });

  it("is no region on the host itself", () => {
    const host = document.createElement("div");
    host.setAttribute("style", NATIVE);
    host.innerHTML = "<p>inside</p>";
    document.body.appendChild(host);
    const root = buildRoot(host, 16);
    expect(root.native).toBeUndefined();
    expect(root.children.map((child) => child.source.localName)).toEqual(["p"]);
  });
});

/** A cell of 8 by 16 px. */
const CELL = { width: 8, height: 16, letterSpacing: 0 };

/** The markup's first element laid out `width` columns wide, its regions'
 * contents `measure`d — px at the width asked — and the widths asked. */
function layOutMeasured(
  html: string,
  measure: (width: string) => { width: number; height: number },
  width = 80,
): { root: LayoutNode; asked: Set<string> } {
  const container = document.createElement("div");
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  const asked = new Set<string>();
  const root = buildTree(container.firstElementChild!, 16, CELL, undefined, (_el, at) => {
    asked.add(at);
    return measure(at);
  })!;
  layoutRoot(root, width);
  return { root, asked };
}

/** An element built after `prepare` stubs it. */
function layOutStubbed(html: string, prepare: (el: Element) => void): LayoutNode {
  const container = document.createElement("div");
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  prepare(container.querySelector("[data-test]")!);
  const root = buildTree(container, 16, CELL)!;
  layoutRoot(root, 200);
  return root;
}

const stub = (el: Element, values: Record<string, number | boolean>): void => {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(el, name, { get: () => value, configurable: true });
  }
};

describe('a replaced region\'s size (specs/native-regions.md "Layout")', () => {
  it("is the default object's where it has no natural one: 300 by 150 px on the spacing scale", () => {
    const root = layOutStubbed(`<iframe data-test="region" style="${NATIVE}"></iframe>`, () => {});
    expect(size(find(root, "iframe"))).toEqual([75, 38]);
  });

  it("is a video's natural size and ratio once it has its metadata, the default object's before", () => {
    const before = layOutStubbed(`<video data-test="region" style="${NATIVE}"></video>`, () => {});
    expect(size(find(before, "video"))).toEqual([75, 38]);
    document.body.replaceChildren();
    const after = layOutStubbed(`<video data-test="region" style="${NATIVE}"></video>`, (el) =>
      stub(el, { videoWidth: 640, videoHeight: 360 }),
    );
    // 640 px is 160 columns; 16:9 in 1:2 cells is 160 by 45 rows.
    expect(size(find(after, "video"))).toEqual([160, 45]);
  });

  it("is a canvas's attributes, a ratio with them", () => {
    const root = layOutStubbed(
      `<canvas data-test="region" width="200" height="100" style="${NATIVE}"></canvas>`,
      () => {},
    );
    expect(size(find(root, "canvas"))).toEqual([50, 13]);
  });

  it("takes its height from a set width through an aspect ratio", () => {
    const root = layOutStubbed(
      `<iframe data-test="region" style="${NATIVE}; width: 160px; aspect-ratio: 16 / 9"></iframe>`,
      () => {},
    );
    expect(size(find(root, "iframe"))).toEqual([40, 11]);
  });

  it("is an image's natural size, as an image's box", () => {
    const root = layOutStubbed(`<img data-test="region" style="${NATIVE}; display: block">`, (el) =>
      stub(el, { naturalWidth: 400, naturalHeight: 300, complete: true }),
    );
    expect(size(find(root, "img"))).toEqual([100, 38]);
  });

  it("gives way to its container at min-content where a percentage sizes it", () => {
    const root = layOutStubbed(
      `<div data-test="box"><iframe style="${NATIVE}; display: block; width: 100%"></iframe></div>`,
      () => {},
    );
    expect(intrinsicOuterWidth(find(root, '[data-test="box"]'), "min", makeIntrinsicCache())).toBe(
      0,
    );
  });
});

describe('a flowed region\'s size (specs/native-regions.md "Layout")', () => {
  const contents = (width: string) =>
    width === "max-content"
      ? { width: 100.5, height: 18 }
      : width === "min-content"
        ? { width: 33.6, height: 54 }
        : { width: parseFloat(width), height: 50 };

  it("shrinks to fit its contents where its box does, rounded up through the cell", () => {
    const { root, asked } = layOutMeasured(
      `<p>a <span data-test="region" style="${NATIVE}">contents</span> b</p>`,
      contents,
    );
    // 100.5 px is 12.6 cells, 13; 50 px at those 104 px, 3.1 rows, 4.
    expect(size(find(root, '[data-test="region"]'))).toEqual([13, 4]);
    expect(asked).toEqual(new Set(["max-content", "104px"]));
  });

  it("fills its container where a block does, its height asked at its content width", () => {
    const { root, asked } = layOutMeasured(
      `<div><div data-test="region" style="${NATIVE}; padding: 4px; border: 1px solid">contents</div></div>`,
      contents,
    );
    expect(size(find(root, '[data-test="region"]'))).toEqual([80, 4 + 2 + 2]);
    expect(asked).toEqual(new Set([`${(80 - 4) * 8}px`]));
  });

  it("measures nothing where its author sizes it", () => {
    const { root, asked } = layOutMeasured(
      `<div><div data-test="region" style="${NATIVE}; width: 40px; height: 32px">contents</div></div>`,
      contents,
    );
    expect(size(find(root, '[data-test="region"]'))).toEqual([10, 8]);
    expect(asked).toEqual(new Set());
  });

  it("gives way in a flex row down to its contents' min-content", () => {
    const { root, asked } = layOutMeasured(
      `<div style="display: flex; width: 40px">` +
        `<div data-test="region" style="${NATIVE}">contents</div>` +
        `<div style="width: 200px; flex-shrink: 0">beside</div></div>`,
      contents,
    );
    // 33.6 px is 4.2 cells, 5.
    expect(find(root, '[data-test="region"]').localRect.width).toBe(5);
    expect(asked.has("min-content")).toBe(true);
  });

  it("is an aspect ratio's height, floored at its contents'", () => {
    const tall = layOutMeasured(
      `<div><div data-test="region" style="${NATIVE}; aspect-ratio: 16 / 9">contents</div></div>`,
      (width) => ({ width: parseFloat(width), height: 600 }),
    );
    expect(size(find(tall.root, '[data-test="region"]'))).toEqual([80, 38]);
    document.body.replaceChildren();
    const short = layOutMeasured(
      `<div><div data-test="region" style="${NATIVE}; aspect-ratio: 16 / 9">contents</div></div>`,
      contents,
    );
    // 80 columns of 16:9 in 1:2 cells: 22.5 rows, 23.
    expect(size(find(short.root, '[data-test="region"]'))).toEqual([80, 23]);
  });

  it("is measured whole as a list item, its marker hanging outside it, inside or not", () => {
    const { root } = layOutMeasured(
      `<ol><li data-test="region" style="${NATIVE}; list-style-position: inside">item</li></ol>`,
      () => ({ width: 40, height: 48 }),
    );
    const region = find(root, '[data-test="region"]');
    expect(region.style.marker?.inside).toBe(false);
    expect(size(region)[1]).toBe(3);
  });

  it("is measured as the browser lays out an inline SVG, or a broken image's alt", () => {
    // An image with no source is complete and broken.
    for (const tag of [`<svg style="${NATIVE}"></svg>`, `<img alt="broken" style="${NATIVE}">`]) {
      const { root } = layOutMeasured(`<p>a ${tag} b</p>`, contents);
      const region = find(root, "svg, img");
      expect(region.native?.replaced, tag).toBe(true);
      expect(size(region), tag).toEqual([13, 4]);
      document.body.replaceChildren();
    }
  });
});

describe('a native region in the paint order (specs/native-regions.md "Paint")', () => {
  /** The region's surface as a paint leaves it. */
  const surfaceOf = (root: LayoutNode): PaintedLayer =>
    renderGridRows(root).layers.find(({ layer }) => layer.surface === "region")!.layer;
  /** A surface's covered cells, in main-grid columns and rows. */
  const covered = ({ holes, x, y, width }: PaintedLayer): number[][] =>
    [...holes].sort((a, b) => a - b).map((i) => [x + (i % width), y + Math.floor(i / width)]);
  const REGION = `<div data-test="region" style="${NATIVE}; width: 40px; height: 16px; margin-left: 8px">inside</div>`;

  it("is cut where ink painted after it covers it, a block's background before its contents not", () => {
    const root = layOut(
      `<div style="position: relative">${REGION}` +
        `<div style="height: 8px; margin-top: -8px; background: red"></div>` +
        `<div style="position: absolute; left: 16px; top: 4px; width: 12px; height: 4px; background: blue"></div>` +
        `</div>`,
    );
    const surface = surfaceOf(root);
    expect(covered(surface)).toEqual([
      [4, 1],
      [5, 1],
      [6, 1],
    ]);
    expect(regionClip(surface, CELL)).toBe(
      'path(evenodd, "M-1e6 -1e6H1e6V1e6H-1e6ZM16 16h24v16h-24Z")',
    );
    // Where the block's background lies beneath it, the region takes the cell.
    const chain = hitChain(root, 3, 3, null);
    expect(chain.at(-1)).toBe(document.querySelector('[data-test="region"]'));
    // Its content box blank on the grid: its contents are the browser's.
    expect(renderPlainText(root)).not.toContain("inside");
  });

  it("is cut by a translucent box, and through a layer around it", () => {
    const faded = layOut(
      `<div style="position: relative">${REGION}` +
        `<div style="position: absolute; left: 8px; top: 0; width: 4px; height: 4px; background: blue; opacity: 0.5"></div>` +
        `</div>`,
    );
    expect(covered(surfaceOf(faded))).toEqual([[2, 0]]);
    document.body.replaceChildren();
    const turned = layOut(
      `<div style="position: relative"><div style="rotate: 3deg">${REGION}</div>` +
        `<div style="position: absolute; left: 8px; top: 0; width: 4px; height: 4px; background: blue"></div>` +
        `</div>`,
    );
    expect(covered(surfaceOf(turned))).toEqual([[2, 0]]);
  });

  it("is clipped in its own box's px as its scroller moves it", () => {
    const html =
      `<div style="position: relative"><div data-test="scroller" style="height: 16px; overflow-y: auto">` +
      `${REGION}<p>below</p><p>below</p><p>below</p></div>` +
      `<div style="position: absolute; left: 8px; top: 8px; width: 4px; height: 4px; background: blue"></div>` +
      `</div>`;
    const root = layOut(html);
    const at = (): string | null => regionClip(surfaceOf(root), CELL);
    expect(at()).toBe('path(evenodd, "M-1e6 -1e6H1e6V1e6H-1e6ZM0 32h8v16h-8Z")');
    const scroller = find(root, '[data-test="scroller"]');
    scroller.scroll = { x: 0, y: 1 };
    placePainted(root);
    expect(at()).toBe('path(evenodd, "M-1e6 -1e6H1e6V1e6H-1e6ZM0 48h8v16h-8Z")');
  });

  it("is hidden whole under a top-layer backdrop painted after it", () => {
    const region = makeNode({ style: { width: { kind: "cells", value: 4 } } });
    region.native = { replaced: false, inline: false };
    const backdrop = {
      backgroundColor: "rgb(0 0 0 / 0.5)",
      backgroundImage: "none",
      backdropFilter: "none",
      opacity: "1",
    };
    const dialog = makeNode({ style: { backdrop } });
    const root = makeNode({ children: [region] });
    root.topLayer = [{ node: dialog, ancestors: [root] }];
    region.localRect = { x: 0, y: 0, width: 4, height: 2 };
    dialog.localRect = { x: 0, y: 3, width: 4, height: 1 };
    root.localRect = { x: 0, y: 0, width: 10, height: 5 };
    placePainted(root);
    expect(regionClip(surfaceOf(root), CELL)).toBe("inset(50%)");
  });

  it("is cut where hidden too, under what covers it", () => {
    const root = layOut(
      `<div style="position: relative">` +
        `<div style="${NATIVE}; width: 40px; height: 16px; visibility: hidden"><p style="visibility: visible">shown</p></div>` +
        `<div style="position: absolute; left: 8px; top: 0; width: 4px; height: 4px; background: blue"></div>` +
        `</div>`,
    );
    expect(covered(surfaceOf(root))).toEqual([[2, 0]]);
  });

  it("merges each row's run of covered cells into one rectangle", () => {
    const surface = {
      box: { x: 2, y: 1, width: 6, height: 3 },
      x: 2,
      y: 1,
      width: 6,
      height: 3,
      holes: new Set([0, 1, 2, 5, 6, 7]),
      whole: false,
    } as unknown as PaintedLayer;
    expect(regionClip(surface, CELL)).toBe(
      'path(evenodd, "M-1e6 -1e6H1e6V1e6H-1e6ZM0 0h24v16h-24ZM40 0h8v16h-8ZM0 16h16v16h-16Z")',
    );
    surface.holes.clear();
    expect(regionClip(surface, CELL)).toBeNull();
  });
});

describe('a native region in a selection and a copy (specs/native-regions.md "Interaction")', () => {
  const points = (start: Node, startOffset: number, end: Node, endOffset: number) => ({
    startContainer: start,
    startOffset,
    endContainer: end,
    endOffset,
  });
  const textOf = (root: LayoutNode, selector: string): Text =>
    root.source.querySelector(selector)!.firstChild as Text;

  it("is the browser's selection inside one region, the light DOM's across its edge", () => {
    const host = document.createElement("div");
    host.setAttribute("data-mw-regions", "");
    host.innerHTML =
      "<p>out</p><div data-mw-native><p>one</p><p>two</p></div><div data-mw-native><p>three</p></div>";
    document.body.appendChild(host);
    const grid = document.createElement("pre");
    const [out, one, two, three] = [...host.querySelectorAll("p")].map((p) => p.firstChild!);
    expect(classifySelection(host, grid, points(one!, 0, two!, 1))).toBe("native");
    expect(classifySelection(host, grid, points(out!, 0, two!, 1))).toBe("light");
    expect(classifySelection(host, grid, points(two!, 0, three!, 1))).toBe("light");
    // A host's marks as of its last layout: none, no region yet.
    host.removeAttribute("data-mw-regions");
    expect(classifySelection(host, grid, points(one!, 0, two!, 1))).toBe("light");
  });

  it("is the browser's selection across the regions of a host running in one", () => {
    const host = document.createElement("div");
    host.setAttribute("data-mw-regions", "");
    host.innerHTML =
      "<div data-mw-native><div data-mw-regions><p>inner</p><div data-mw-native><p>its region</p></div></div></div>";
    document.body.appendChild(host);
    const [inner, nested] = [...host.querySelectorAll("p")].map((p) => p.firstChild!);
    const grid = document.createElement("pre");
    expect(classifySelection(host, grid, points(nested!, 0, inner!, 3))).toBe("native");
  });

  it("is the browser's selection in the shadow of a host running in a region", () => {
    const host = document.createElement("div");
    host.setAttribute("data-mw-regions", "");
    host.innerHTML = "<p>out</p><div data-mw-native><div></div></div>";
    document.body.appendChild(host);
    const inner = host.querySelector("[data-mw-native] > div")!.attachShadow({ mode: "open" });
    const text = inner.appendChild(document.createTextNode("its own grid"));
    const out = host.querySelector("p")!.firstChild!;
    const grid = document.createElement("pre");
    expect(classifySelection(host, grid, points(text, 0, text, 3))).toBe("native");
    expect(classifySelection(host, grid, points(out, 0, text, 3))).toBe("light");
  });

  it("copies the text a light selection holds of it, as the page renders it, a block a line", () => {
    const root = layOut(
      `<div><p data-test="before">before</p><div style="${NATIVE}"><p>one  two</p><p data-test="three">three <b>four</b></p></div><p>after</p></div>`,
    );
    const range = points(
      textOf(root, '[data-test="before"]'),
      2,
      textOf(root, '[data-test="three"]'),
      3,
    );
    expect(serializeSelection(root, range)).toBe("fore\n\none two\nthr");
  });

  it("copies nothing of a hidden image region, as of a hidden image", () => {
    const root = layOut(
      `<div><p>a</p><img alt="hidden" style="${NATIVE}; display: block; width: 40px; height: 16px; visibility: hidden"><p>b</p></div>`,
    );
    const range = points(root.source, 0, root.source, 3);
    expect(serializeSelection(root, range)).toBe("a\n\nb");
    expect(serializeSelection(root, range, { cells: true }), "in grid mode").toBe("a\n\nb");
    expect(screenRows(root, { alt: true }).join("\n")).not.toContain("hidden");
  });

  it("copies a field's value, white space as the page renders it, and a host's part as it copies it", () => {
    const root = layOut(
      `<div><div style="${NATIVE}"><textarea>default</textarea>` +
        `<p style="white-space: pre-line">Line   one\n   Line two</p><p>a&nbsp;&nbsp;b  c</p>` +
        `<div data-test="host">raw text</div></div></div>`,
    );
    root.source.querySelector("textarea")!.value = "typed";
    const nested = (el: Element) => (el.matches('[data-test="host"]') ? "its own part" : null);
    expect(serializeSelection(root, points(root.source, 0, root.source, 1), { nested })).toBe(
      "typed\nLine one\nLine two\na\u00a0\u00a0b c\nits own part",
    );
  });

  it("copies an image region's alt, and nothing of a frame's", () => {
    const root = layOut(
      `<div><p>a</p><img alt="A  cat" style="${NATIVE}; display: block; width: 40px; height: 16px">` +
        `<iframe style="${NATIVE}; display: block"></iframe><p>b</p></div>`,
    );
    expect(serializeSelection(root, points(root.source, 0, root.source, 4))).toBe(
      "a\n\nA cat\n\nb",
    );
  });

  it("writes its text in its content cells in a copy's render, wrapped and cut", () => {
    const root = layOut(
      `<div><div style="${NATIVE}; width: 40px; height: 16px; border: 1px solid">` +
        `<p>one two three</p><p>four</p><p>five</p></div></div>`,
      12,
    );
    const rows = screenRows(root, { alt: true }).map((row) => row.slice(1, 9));
    expect(rows).toEqual(["────────", "one two ", "three   ", "────────"]);
    // The grid shows none of it.
    expect(renderPlainText(root)).not.toContain("one");
  });

  it("copies its cells in grid mode", () => {
    const root = layOut(
      `<div><p data-test="before">before</p><div style="${NATIVE}; width: 32px; height: 8px"><p>one two</p></div><p>after</p></div>`,
    );
    const range = points(textOf(root, '[data-test="before"]'), 0, root.source, 3);
    expect(serializeSelection(root, range, { cells: true })).toBe(
      "before\n\none two \n        \n\nafter",
    );
  });
});
