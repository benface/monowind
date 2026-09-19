import { expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { buildTree } from "../src/tree.ts";
import { inlineBoxesOf } from "../src/types.ts";
import type { LayoutNode } from "../src/types.ts";

/** A line's atomic inline boxes move with its text under `text-align`
 * and `text-indent` (specs/cell-model.md "Text alignment"), so the grid
 * and the native box agree on the box's cells. */

function build(html: string): LayoutNode {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const root = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(root, 20);
  return root;
}
const firstRow = (root: LayoutNode) => renderPlainText(root).split("\n")[0];
const box = (root: LayoutNode) => inlineBoxesOf(root)[0]!.localRect;

it("ends a line holding an inline box at the content's end, the box on its cells", () => {
  const root = build(
    '<div style="width: 80px; text-align: right">before <span style="display: inline-block">ok</span> after</div>',
  );
  expect(firstRow(root)).toBe("     before ok after");
  expect(box(root)).toMatchObject({ x: 12, y: 0, width: 2 });
});

it("centers a box alone on its line", () => {
  const root = build(
    '<div style="width: 80px; text-align: center"><span style="display: inline-block">ok</span></div>',
  );
  expect(firstRow(root)).toBe("         ok");
  expect(box(root).x).toBe(9);
});

it("aligns a box in the content a flex leaf folded its leftover out of", () => {
  // The widest line is 16 cells: the flex leaf centers it by folding 2
  // cells into each padding, and the first line aligns in those 16.
  const root = build(
    '<div style="display: flex; justify-content: center; width: 80px; text-align: right">ab <span style="display: inline-block">X</span> abcdefghijklmnop</div>',
  );
  expect(firstRow(root)).toBe("              ab X");
  expect(box(root).x).toBe(17);
});

it("aligns a box in its band beside a float", () => {
  const root = build(
    '<div style="width: 80px"><div style="float: left; width: 28px; height: 8px"></div><p style="text-align: right">ab <span style="display: inline-block">X</span></p></div>',
  );
  const paragraph = root.children[1]!;
  expect(firstRow(root)).toBe("                ab X");
  expect(inlineBoxesOf(paragraph)[0]!.localRect.x).toBe(19);
});

it("aligns a box in its column of a multicol leaf", () => {
  const root = build(
    '<div style="column-count: 2; column-gap: 4px; width: 36px; text-align: right">aa <span style="display: inline-block">XX</span> bb cc</div>',
  );
  expect(renderPlainText(root).split("\n")).toEqual(["  aa   bb", "  XX   cc"]);
  expect(box(root).x).toBe(2);
});

it("indents the first line's box with its text", () => {
  // The box resets the inherited indent, which would indent its own line.
  const root = build(
    '<div style="width: 80px; text-indent: 8px"><span style="display: inline-block; text-indent: 0">ok</span> then</div>',
  );
  expect(firstRow(root)).toBe("  ok then");
  expect(box(root).x).toBe(2);
});
