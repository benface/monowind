import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import {
  applyCellPaint,
  charIndexAtCell,
  renderCellSegments,
  renderGridRows,
  renderPlainText,
} from "../src/plain-text.ts";
import { buildTree } from "../src/tree.ts";
import { clusterAdvances } from "../src/width.ts";
import { lineAdvance, wrapLines } from "../src/wrap.ts";
import { makeNode } from "./helpers.ts";
import type { LayoutNode } from "../src/types.ts";

/** Wide clusters on the grid (specs/wide-characters.md): table widths,
 * code-unit indexing, continuation cells, blanking, boxing, the
 * painted selection. */

function wide(text: string, overrides: Parameters<typeof makeNode>[0] = {}): LayoutNode {
  const node = makeNode({ ...overrides, text });
  node.advances = clusterAdvances(text, overrides.style?.tracking ?? 0);
  return node;
}

function plainText(root: LayoutNode, availableWidth: number): string {
  layoutRoot(root, availableWidth);
  return renderPlainText(root);
}

describe("runs", () => {
  it("indexes advances and inline entries per code unit", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>😀<a href="#">中x</a>é</p>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    expect(node.text).toBe("😀中xé");
    expect(node.advances).toEqual([2, 0, 2, 1, 1, 0]);
    expect(node.charInline).toEqual([-1, -1, 0, 0, -1, -1]);
    expect(node.charSource!.map((run) => [run.index, run.length, run.offset])).toEqual([
      [0, 2, 0],
      [2, 2, 0],
      [4, 2, 0],
    ]);
    expect(node.intrinsicWidth).toBe(6);
  });

  it("keeps a zero-width cluster in the text at no cost", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>a​b</p>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    expect(node.text).toBe("a​b");
    expect(node.advances).toEqual([1, 0, 1]);
    expect(node.intrinsicWidth).toBe(2);
  });

  it("keeps CRLF one break under white-space: pre", () => {
    const host = document.createElement("div");
    host.innerHTML = `<pre style="white-space: pre">a\r\n日</pre>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    expect(node.text).toBe("a\n日");
    expect(node.advances).toEqual([1, 0, 2]);
  });

  it("sizes a textarea's rows and a select's labels by cluster widths", () => {
    const host = document.createElement("div");
    host.innerHTML = `<select><option>日本語</option><option>ab</option></select>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    expect(node.intrinsicWidth).toBe(6);
  });
});

describe("wrap", () => {
  it("never splits a cluster and counts a wide one as two cells", () => {
    const text = "日本語のテキスト";
    expect(wrapLines(text, 5, { advances: clusterAdvances(text) })).toEqual([
      "日本",
      "語の",
      "テキ",
      "スト",
    ]);
    const family = "x👨‍👩‍👧y";
    expect(wrapLines(family, 2, { advances: clusterAdvances(family) })).toEqual(["x", "👨‍👩‍👧", "y"]);
  });

  it("reads a tracked line's trailing gap from the cluster's first unit", () => {
    const text = "a中";
    const advances = clusterAdvances(text, 1);
    expect(advances).toEqual([2, 3]);
    expect(lineAdvance(text, 0, 2, advances, 1)).toBe(4);
    const emoji = "a😀";
    expect(lineAdvance(emoji, 0, 3, clusterAdvances(emoji, 1), 1)).toBe(4);
    // The wide cluster inside an untracked inline element: its gap is 0,
    // so the leaf's tracking has nothing to absorb.
    expect(lineAdvance(text, 0, 2, [2, 2], 1)).toBe(4);
    expect(lineAdvance("a\uFFFC", 0, 2, [2, 5], 1)).toBe(6);
  });
});

describe("paint", () => {
  it("paints wide text in a border, continuation cells empty", () => {
    const box = wide("日本 ok", { style: { border: { top: 1, right: 1, bottom: 1, left: 1 } } });
    const root = makeNode({ children: [box] });
    expect(plainText(root, 9)).toBe(["┌───────┐", "│日本 ok│", "└───────┘"].join("\n"));
    const { cells } = renderGridRows(root);
    expect(cells[1]).toEqual(["│", "日", "", "本", "", " ", "o", "k", "│"]);
    expect(cells.every((row) => row.length === 9)).toBe(true);
  });

  it("centers a wide line by whole cells", () => {
    const box = wide("中", { style: { textAlign: "center", width: { kind: "cells", value: 5 } } });
    const root = makeNode({ children: [box] });
    expect(plainText(root, 5)).toBe(" 中");
  });

  it("truncates before a wide cluster that does not fit", () => {
    const box = wide("日本語", {
      style: {
        width: { kind: "cells", value: 5 },
        whiteSpace: "nowrap",
        overflow: { x: "clip", y: "clip" },
        textOverflow: "ellipsis",
      },
    });
    const root = makeNode({ children: [box] });
    expect(plainText(root, 5)).toBe("日本…");
  });

  it("blanks a cluster cut by a clip edge", () => {
    const leaf = wide("日本", {
      style: {
        width: { kind: "cells", value: 3 },
        whiteSpace: "nowrap",
        overflow: { x: "clip", y: "visible" },
      },
    });
    const root = makeNode({ children: [leaf] });
    expect(plainText(root, 3)).toBe("日");
    expect(renderGridRows(root).cells[0]).toEqual(["日", "", " "]);
  });

  it("blanks a cluster a later glyph overwrites", () => {
    const text = wide("日本");
    const over = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 1 },
        width: { kind: "cells", value: 1 },
        height: { kind: "cells", value: 1 },
        backgroundColor: "red",
      },
    });
    const root = makeNode({ children: [text, over], style: { position: "relative" } });
    layoutRoot(root, 4);
    expect(renderGridRows(root).cells[0]).toEqual([" ", " ", "本", ""]);
  });

  it("maps both cells of a wide cluster to its first unit", () => {
    const leaf = wide("a😀b");
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 4);
    expect(charIndexAtCell(leaf, 0, 0, 1, 0)).toBe(1);
    expect(charIndexAtCell(leaf, 0, 0, 2, 0)).toBe(1);
    expect(charIndexAtCell(leaf, 0, 0, 3, 0)).toBe(3);
  });

  it("boxes the clusters the caller names, one segment each", () => {
    const leaf = wide("a★中b");
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 5);
    expect(renderCellSegments(root)[0]).toEqual([{ text: "a★中b" }]);
    const boxed = (cluster: string) => cluster !== "★";
    expect(renderCellSegments(root, { boxed })[0]).toEqual([
      { text: "a★" },
      { text: "中", cells: 2, box: true },
      { text: "b" },
    ]);
  });

  it("paints a selection as swapped colors, over an inverted control too", () => {
    const plain = wide("ab");
    const control = wide("go", { style: { color: "black", backgroundColor: "white" } });
    const root = makeNode({ children: [plain, control] });
    layoutRoot(root, 2);
    const selection = new Map([
      [plain, { start: 1, end: 2 }],
      [control, { start: 0, end: 2 }],
    ]);
    const rows = renderCellSegments(root, { selection });
    expect(rows[0]).toEqual([{ text: "a" }, { text: "b", selected: true }]);
    expect(rows[1]).toEqual([
      { text: "go", color: "black", backgroundColor: "white", selected: true },
    ]);
    const style = {} as CSSStyleDeclaration;
    applyCellPaint(rows[1]![0]!, style);
    expect(style.color).toBe("white");
    expect(style.backgroundColor).toBe("black");
    applyCellPaint(rows[0]![1]!, style);
    expect(style.color).toBe("var(--mw-bg, canvas)");
    expect(style.backgroundColor).toBe("var(--mw-fg, canvastext)");
  });
});
