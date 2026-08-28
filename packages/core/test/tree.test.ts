import { describe, expect, it } from "vitest";
import { buildTree } from "../src/tree.ts";
import type { PerSide } from "../src/types.ts";

/**
 * DOM → LayoutNode tests (happy-dom): leaf/container decisions, text
 * extraction (whitespace collapsing, `<br>`, NBSP), and inline-relative
 * collection. Style *interpretation* is covered by browser tests — these
 * cover the tree builder's structural rules from the cell-model spec.
 */

function el(html: string): Element {
  // Attached to the document — getComputedStyle on detached elements
  // returns empty values (the engine only ever reads connected elements).
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  return host.firstElementChild!;
}

describe("buildTree", () => {
  it("collapses source-formatting whitespace to single spaces (only <br> hard-breaks)", () => {
    const node = buildTree(el("<div>\n      hello\n      world\n    </div>"), 16)!;
    expect(node.text).toBe("hello world");
    expect(node.intrinsicHeight).toBe(1);
  });

  it("turns <br> into hard line breaks and trims around them", () => {
    const node = buildTree(el("<div>first line<br />\n  second</div>"), 16)!;
    expect(node.text).toBe("first line\nsecond");
    expect(node.intrinsicWidth).toBe(10);
    expect(node.intrinsicHeight).toBe(2);
  });

  it("preserves NBSP as content", () => {
    const node = buildTree(el("<div>10 km</div>"), 16)!;
    expect(node.text).toBe("10 km");
    expect(node.intrinsicWidth).toBe(5);
  });

  it("treats an element with only inline children as a leaf with combined text", () => {
    const node = buildTree(el("<div>hello <span>wide</span> <b>world</b></div>"), 16)!;
    expect(node.children).toEqual([]);
    expect(node.text).toBe("hello wide world");
  });

  it("treats an element with a block child as a container and drops direct text", () => {
    const node = buildTree(el("<div>orphan text<div>child</div></div>"), 16)!;
    expect(node.text).toBe("");
    expect(node.children.length).toBe(1);
    expect(node.children[0]!.text).toBe("child");
  });

  it("skips display: none subtrees entirely", () => {
    const node = buildTree(
      el('<div><div style="display: none">gone</div><div>kept</div></div>'),
      16,
    )!;
    expect(node.children.length).toBe(1);
    expect(node.children[0]!.text).toBe("kept");
  });

  it("collects inline elements with authored relative insets, converted to cells", () => {
    const node = buildTree(
      el('<div>a <span style="position: relative; top: 4px">shifted</span> b</div>'),
      16,
    )!;
    expect(node.inlineElements?.length).toBe(1);
    expect(node.inlineElements![0]!.insets).toEqual({
      top: 1, // 4px = 1 cell at 16px root font size
      right: null,
      bottom: null,
      left: null,
    });
  });

  it("records inline elements without insets as not positioned (percent insets too)", () => {
    const node = buildTree(
      el(
        '<div><span style="position: relative">plain</span> <i style="position: relative; top: 50%">pct</i></div>',
      ),
      16,
    )!;
    const noInsets = (e: { insets: PerSide<number | null> | null }) =>
      e.insets === null || Object.values(e.insets).every((v) => v === null);
    expect(node.inlineElements?.every(noInsets)).toBe(true);
  });

  it("gives tracked characters wider advances, inline spans included", () => {
    const node = buildTree(
      el(
        '<div style="letter-spacing: 0.35px">ab <span style="letter-spacing: 0.7px">cd</span></div>',
      ),
      16,
    )!;
    // Leaf tracking: 0.35px / (0.025 × 16px = 0.4px) → 0; span: 0.7 / 0.4 → 1.
    // The span's trailing gap stays (browsers keep it too).
    expect(node.text).toBe("ab cd");
    expect(node.advances).toEqual([1, 1, 1, 2, 2]);
    expect(node.intrinsicWidth).toBe(7);
    expect(node.inlineElements?.[0]?.tracking).toBe(1);
  });

  it("collapses whitespace across inline-element boundaries", () => {
    const node = buildTree(el("<div>a <span> b </span> c</div>"), 16)!;
    expect(node.text).toBe("a b c");
  });
});
