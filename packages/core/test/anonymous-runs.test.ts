import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { focusableRects } from "../src/focus.ts";
import { render } from "../src/render.ts";
import { hitChain } from "../src/pointer.ts";
import { leafExtent, selectedRanges, serializeSelection } from "../src/selection.ts";
import { buildChildren, buildTree, hostLeafStyle } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

/** Anonymous runs (specs/cell-model.md "Inline content"): a container's
 * text beside its block children, laid out on the grid, and the block
 * children kept in the browser's flow by engine margins so that text
 * sits natively on its rows. */

function build(html: string, cols = 20): { host: HTMLElement; root: LayoutNode } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const root = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(root, cols);
  return { host, root };
}

const texts = (host: Element): Text[] => {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
};

describe("anonymous runs", () => {
  it("places a block container's children in the browser's flow, runs between them", () => {
    // 4px cells: a 1-cell padding, 2-row margins on the block.
    const { root } = build(
      '<div style="width: 80px; padding: 4px">foo bar<div style="margin: 8px 0">block</div>baz</div>',
    );
    const [first, block, last] = root.children;
    expect(first!.localRect).toMatchObject({ x: 1, y: 1, height: 1 });
    expect(block!.localRect).toMatchObject({ x: 1, y: 4, height: 1 });
    expect(last!.localRect).toMatchObject({ x: 1, y: 7, height: 1 });
    // The block's native margins: the rows to it from the run before,
    // and from it to the run after.
    expect(block!.flow).toEqual({ top: 2, right: 0, bottom: 2, left: 0 });
    expect(first!.flow).toBeUndefined();
    expect(last!.flow).toBeUndefined();
  });

  it("counts a run's native line boxes under leading, and the half-leading shift", () => {
    // line-height 32px on 16px text: a row gap of one; the run's single
    // line is two rows natively, and the container's content shifts up
    // by half a row, so the block sits half a row lower natively.
    const { root } = build('<div style="width: 80px; line-height: 32px">foo<div>block</div></div>');
    const [run, block] = root.children;
    expect(run!.localRect.height).toBe(1);
    expect(block!.localRect.y).toBe(1);
    expect(block!.flow).toEqual({ top: -0.5, right: 0, bottom: 0, left: 0 });
  });

  it("lays a flex container's runs out as items, in the engine's flow only", () => {
    const { root } = build('<div style="display: flex; width: 80px">foo<div>bar</div>baz</div>');
    expect(root.children.map((child) => child.localRect.x)).toEqual([0, 3, 6]);
    expect(root.children.some((child) => child.flow)).toBe(false);
  });

  it("selects and copies across runs and blocks in document order", () => {
    const { host, root } = build("<div>foo <div>bar</div> baz</div>");
    const [foo, , baz] = texts(host);
    const points = { startContainer: foo!, startOffset: 1, endContainer: baz!, endOffset: 3 };
    expect([...selectedRanges(root, points).values()]).toEqual([
      { start: 1, end: 3 },
      { start: 0, end: 3 },
      { start: 0, end: 2 },
    ]);
    expect(serializeSelection(root, points)).toBe("oo\nbar\nba");
    // A range inside the block reaches no run, though every run shares
    // the block's container.
    const [bar] = texts(host).slice(1);
    const inside = { startContainer: bar!, startOffset: 1, endContainer: bar!, endOffset: 3 };
    expect([...selectedRanges(root, inside).values()]).toEqual([{ start: 1, end: 3 }]);
    expect(serializeSelection(root, inside)).toBe("ar");
  });

  it("bounds a run's paragraph by its own nodes, and hits its container once", () => {
    const { host, root } = build("<div><div>foo <b>x</b><div>bar</div>baz</div></div>", 8);
    const [foo, x] = texts(host);
    const container = root.children[0]!;
    expect(leafExtent(container.children[0]!)).toEqual({
      start: { node: foo, offset: 0 },
      end: { node: x, offset: 1 },
    });
    expect(hitChain(root, 1, 0)).toEqual([container.source]);
    expect(hitChain(root, 1, 1)).toEqual([container.source, container.source.querySelector("div")]);
  });

  it("keeps an out-of-flow element the run met below a direct child", () => {
    // A popover inside an inline wrapper — a custom element's shape:
    // it leaves the run, and the leaf keeps it for the positioning
    // pass the way it keeps its own (specs/cell-model.md).
    const { host, root } = build(
      '<div>foo <span><i style="position: absolute">abs</i></span> bar</div>',
    );
    const abs = host.querySelector("i")!;
    expect(root.children.map((child) => child.source)).toContain(abs);
    // And it lands where one the run met directly does.
    const direct = build('<div>foo <i style="position: absolute">abs</i> bar</div>');
    expect(renderPlainText(root)).toBe(renderPlainText(direct.root));
  });

  it("selects inside a run's out-of-flow child, and splits a run at a point on its container", () => {
    const { host, root } = build(
      '<div>foo <b>x</b><i style="position: absolute">abs</i><div>bar</div>baz</div>',
    );
    const [foo, , abs, bar] = texts(host);
    // The absolute box hangs off the run; a range inside it reaches it.
    const inside = { startContainer: abs!, startOffset: 0, endContainer: abs!, endOffset: 2 };
    expect([...selectedRanges(root, inside).values()]).toEqual([{ start: 0, end: 2 }]);
    expect(serializeSelection(root, inside)).toBe("ab");
    // A point on the container between the run's nodes splits the run there.
    const container = host.firstElementChild!;
    const split = { startContainer: container, startOffset: 1, endContainer: bar!, endOffset: 2 };
    const [run] = [...selectedRanges(root, split)];
    expect(run![0]!.charSource![0]!.node).toBe(foo);
    expect(run![1]).toEqual({ start: 4, end: 5 });
    expect(serializeSelection(root, split)).toBe("x\nabs\nba");
  });

  it("breaks once around a run in a <p>, as innerText does", () => {
    const { host, root } = build('<p>foo<span style="display: block">bar</span>baz</p>');
    const [foo, , baz] = texts(host);
    const points = { startContainer: foo!, startOffset: 0, endContainer: baz!, endOffset: 3 };
    expect(serializeSelection(root, points)).toBe("foo\nbar\nbaz");
  });

  it("nests: a flow child's own runs and blocks flow inside it, a scroller's too", () => {
    const { root } = build(
      '<div style="width: 80px">a<div style="margin-top: 4px">b<div>c</div>d</div>' +
        '<div style="overflow: auto; height: 8px">e<div>f</div></div></div>',
    );
    const [, outer, scroller] = root.children;
    expect(outer!.flow).toEqual({ top: 1, right: 0, bottom: 0, left: 0 });
    expect(outer!.children.map((child) => child.text)).toEqual(["b", "c", "d"]);
    expect(outer!.children[1]!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(scroller!.children[1]!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(renderPlainText(root)).toBe("a\n\nb\nc\nd\ne\nf");
  });

  it("makes a lone atomic box a run, and keeps a run's link focusable", () => {
    const { host, root } = build(
      '<div><span style="display: inline-block">chip</span><div>bar</div>' +
        'foo <a href="#">link</a></div>',
    );
    const [box, , tail] = root.children;
    expect(box!.anonymous).toBe(true);
    expect(box!.text).toBe("\uFFFC");
    expect(tail!.text).toBe("foo link");
    expect(focusableRects(root).map(({ element, rect }) => [element, rect])).toEqual([
      [host.querySelector("a"), { x: 4, y: 2, width: 4, height: 1 }],
    ]);
  });

  it("measures a sized inline box by its width, not by the text inside it", () => {
    // A box with a width of its own is that wide in the run that holds
    // it, so a max-content container leaves room for it: an indicator
    // in a 2-cell box beside a word of 12.
    const { root } = build(
      '<div style="width: max-content">' +
        '<p><span style="display: inline-block; width: 8px">*</span>abcdefghijkl</p></div>',
      40,
    );
    expect(root.localRect.width).toBe(2 + 12);
  });

  it("makes a sized inline box the widest unbreakable unit for min-content", () => {
    // The box rides the run as one unit, so a min-content container is
    // at least as wide as the box: 4 cells against two words of 2.
    const { root } = build(
      '<div style="width: min-content">' +
        '<p><span style="display: inline-block; width: 16px">*</span>ab cd</p></div>',
      40,
    );
    expect(root.localRect.width).toBe(4);
  });

  it("clamps a sized inline box's own measure by its min and max width", () => {
    const wide = build(
      '<div style="width: max-content">' +
        '<p><span style="display: inline-block; min-width: 12px">*</span>ab</p></div>',
      40,
    );
    expect(wide.root.localRect.width).toBe(3 + 2);
    const capped = build(
      '<div style="width: max-content">' +
        '<p><span style="display: inline-block; max-width: 8px">abcdef</span>ab</p></div>',
      40,
    );
    expect(capped.root.localRect.width).toBe(2 + 2);
  });

  it("keeps a positioned container's own z-index beside its runs", () => {
    const { root } = build(
      '<div><div style="position: relative; z-index: 10">foo<div>bar</div></div></div>',
    );
    render(root);
    const container = root.children[0]!.source as HTMLElement;
    expect(container.style.getPropertyValue("--mw-z")).toBe("10");
  });

  it("lays a mixed multicol container out, its text on the grid only", () => {
    const { root } = build(
      '<div style="column-count: 2; column-gap: 4px; width: 80px">foo<div>bar</div>baz</div>',
    );
    expect(root.children.map((child) => child.anonymous)).toEqual([true, undefined, true]);
    expect(root.children.some((child) => child.flow)).toBe(false);
    expect(renderPlainText(root).split(/\s+/).filter(Boolean).sort()).toEqual([
      "bar",
      "baz",
      "foo",
    ]);
  });

  it("renders the runs in the transcript", () => {
    const { root } = build("<div>foo<div>bar</div>baz</div>", 3);
    expect(renderPlainText(root)).toBe("foo\nbar\nbaz");
  });

  it("gives a run its container's text paint, leading, and tracking", () => {
    const { root } = build(
      '<div style="width: 80px; color: red; font-weight: 700; font-style: italic; line-height: 32px; letter-spacing: 0.4px">foo<div>bar</div></div>',
    );
    const run = root.children[0]!;
    expect(run.style).toMatchObject({
      color: "red",
      fontWeight: "700",
      fontStyle: "italic",
      lineGap: 1,
      tracking: 1,
    });
    expect(run.style.padding).toEqual(root.children[1]!.style.padding);
  });

  it("builds the host's own text beside a block child the same way, in the root leaf's style", () => {
    const host = document.createElement("div");
    host.style.cssText = "line-height: 32px; letter-spacing: 0.4px; color: red";
    host.innerHTML = "foo<div>bar</div>";
    document.body.appendChild(host);
    const style = hostLeafStyle(host, 16);
    const children = buildChildren(
      host,
      Array.from(host.childNodes),
      16,
      undefined,
      undefined,
      style,
    );
    expect(children.map((child) => child.text)).toEqual(["foo", "bar"]);
    expect(children[0]!.anonymous).toBe(true);
    expect(children[0]!.source).toBe(host);
    // The host's line-height and letter-spacing are the cell: no gap, no tracking.
    expect(children[0]!.style).toMatchObject({ lineGap: 0, tracking: 0, color: "red" });
  });
});
