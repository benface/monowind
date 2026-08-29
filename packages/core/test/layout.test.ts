import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { makeNode } from "./helpers.ts";

/**
 * Tests for the layoutRoot pipeline: pure-math, no DOM — each builds a
 * hand-crafted LayoutNode tree and asserts on the resulting `localRect`
 * coordinates. Flex resolver units live in flex.test.ts, positioning in
 * positioning.test.ts.
 */

describe("margin collapsing in block flow", () => {
  it("collapses adjacent positive sibling margins to their max", () => {
    const a = makeNode({ text: "a", style: { margin: { top: 0, right: 0, bottom: 4, left: 0 } } });
    const b = makeNode({ text: "b", style: { margin: { top: 2, right: 0, bottom: 0, left: 0 } } });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1 → a bottom at y=1. Collapsed gap = max(4, 2) = 4.
    // → b at y = 1 + 4 = 5.
    expect(a.localRect.y).toBe(0);
    expect(b.localRect.y).toBe(5);
  });

  it("collapses adjacent negative sibling margins to the more negative", () => {
    const a = makeNode({
      text: "a",
      style: { margin: { top: 0, right: 0, bottom: -3, left: 0 } },
    });
    const b = makeNode({
      text: "b",
      style: { margin: { top: -1, right: 0, bottom: 0, left: 0 } },
    });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1. b at y = 1 + min(-3, -1) = 1 + -3 = -2.
    expect(b.localRect.y).toBe(-2);
  });

  it("sums mixed-sign sibling margins", () => {
    const a = makeNode({ text: "a", style: { margin: { top: 0, right: 0, bottom: 5, left: 0 } } });
    const b = makeNode({
      text: "b",
      style: { margin: { top: -2, right: 0, bottom: 0, left: 0 } },
    });
    const container = makeNode({ children: [a, b] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // a at y=0, height 1. b at y = 1 + (5 + -2) = 4.
    expect(b.localRect.y).toBe(4);
  });

  it("does not collapse the container's leading/trailing gaps (no parent-child collapse)", () => {
    const child = makeNode({
      text: "x",
      style: { margin: { top: 3, right: 0, bottom: 4, left: 0 } },
    });
    const container = makeNode({ children: [child] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // container height = child.marginTop (3) + child.height (1) + child.marginBottom (4) = 8.
    expect(container.localRect.height).toBe(8);
    expect(child.localRect.y).toBe(3);
  });
});

describe("min-width / max-width / min-height / max-height clamping", () => {
  it("clamps a fill-mode container down to max-width", () => {
    const container = makeNode({
      style: { maxWidth: 10 },
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    expect(container.localRect.width).toBe(10);
  });

  it("clamps intrinsic content down to max-width when smaller", () => {
    const child = makeNode({ text: "hello world hello world" });
    const container = makeNode({
      style: { maxWidth: 8 },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Container capped at max-width 8; the child must be laid out AGAINST
    // the clamped width (not the raw 40), so its text wraps to 4 lines.
    expect(container.localRect.width).toBe(8);
    expect(child.localRect.width).toBe(8);
    expect(child.localRect.height).toBe(4);
  });

  it("respects min-width even if intrinsic content is smaller", () => {
    const child = makeNode({ text: "hi" });
    const container = makeNode({
      style: { minWidth: 12, width: { kind: "cells", value: 4 } },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Explicit width 4, but min-width 12 wins.
    expect(container.localRect.width).toBe(12);
  });

  it("clamps content-driven height down to max-height", () => {
    const child = makeNode({ text: "a\nb\nc\nd\ne" }); // 5 lines
    const container = makeNode({
      style: { maxHeight: 3 },
      children: [child],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    // Natural height would be 5; capped at 3.
    expect(container.localRect.height).toBe(3);
  });

  it("white-space nowrap: text stays one row instead of wrapping at max-width", () => {
    const leaf = makeNode({
      text: "this text is much longer than the container",
      style: { whiteSpace: "nowrap" },
    });
    const container = makeNode({ style: { maxWidth: 10 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Normal wrapping would need 5+ rows at width 10; nowrap keeps 1.
    expect(container.localRect.width).toBe(10);
    expect(leaf.localRect.height).toBe(1);
  });

  it("white-space nowrap: hard <br> breaks still count", () => {
    const leaf = makeNode({
      text: "line one that is long\nline two",
      style: { whiteSpace: "nowrap" },
    });
    const container = makeNode({ style: { maxWidth: 10 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(leaf.localRect.height).toBe(2);
  });

  it("w-min: box narrows to the longest word and mx-auto centers it", () => {
    const item = makeNode({
      text: "w-min mx-auto",
      intrinsicWidth: 13,
      style: {
        width: { kind: "min-content" },
        margin: { top: 0, right: null, bottom: 0, left: null },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
      },
    });
    const container = makeNode({ children: [item] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Breakable segments: "w-", "min", "mx-", "auto" (hyphens are break
    // opportunities, like the browser) → min-content = "auto" (4) + px (2)
    // + border (2) = 8. Text wraps to 4 lines inside → height 4 + border 2.
    // Centered: (40 - 8) / 2 = 16.
    expect(item.localRect.width).toBe(8);
    expect(item.localRect.height).toBe(6);
    expect(item.localRect.x).toBe(16);
  });

  it("w-fit: shrink-to-fit between min-content and available", () => {
    const wide = makeNode({
      text: "short text",
      intrinsicWidth: 10,
      style: { width: { kind: "fit-content" } },
    });
    const root = makeNode({ children: [wide] });
    layoutRoot(root, 40);
    // max-content 10 < available 40 → fit-content = 10.
    expect(wide.localRect.width).toBe(10);
  });

  it("w-max: box takes its unwrapped width even beyond the available space", () => {
    const leaf = makeNode({
      text: "this is a very long unwrapped line",
      intrinsicWidth: 34,
      style: { width: { kind: "max-content" } },
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 20);
    expect(leaf.localRect.width).toBe(34);
  });

  it("max-w-full (percent limit) caps an intrinsic-keyword width to the container", () => {
    const wide = makeNode({
      text: "a very long unwrappable-ish line of text",
      intrinsicWidth: 40,
      style: { width: { kind: "max-content" }, maxWidth: { percent: 100 } },
    });
    const container = makeNode({ style: { maxWidth: 20 }, children: [wide] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 60);
    // w-max wants 40, but max-width: 100% of the 20-wide container clamps it.
    expect(wide.localRect.width).toBe(20);
  });

  it("min > max: max wins as the ceiling, then min pushes back up", () => {
    // CSS clamps `max(min, min(max, value))` — if min > max, min wins.
    const container = makeNode({
      style: { minWidth: 15, maxWidth: 10 },
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 30);
    // value=30 → min(10, 30)=10 → max(15, 10)=15.
    expect(container.localRect.width).toBe(15);
  });
});

describe("text leaves with non-block display", () => {
  it("a display:flex element with only text is sized by its text", () => {
    // Regression: flex-display text leaves were routed to the (empty)
    // flex path and got height 0, so the text overflowed the box into
    // the parent's padding.
    const leaf = makeNode({
      text: "one two three",
      style: { display: "flex", flexDirection: "row" },
    });
    const container = makeNode({ style: { maxWidth: 5 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(leaf.localRect.height).toBe(3);
  });
});

describe("atomic inline boxes in text runs", () => {
  const leafWithBox = () => {
    // "aa \uFFFC bb" with a 4-cell box (its own text "wxyz").
    const box = makeNode({ text: "wxyz" });
    box.inlineBox = true;
    const leaf = makeNode({ text: "aa \uFFFC bb", children: [box] });
    leaf.advances = [1, 1, 1, 1, 1, 1, 1];
    return { box, leaf };
  };

  it("wraps the box atomically at its laid-out width", () => {
    const { leaf } = leafWithBox();
    const container = makeNode({ style: { maxWidth: 8 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // "aa " + 4-cell box = 7 ≤ 8, " bb" wraps → 2 lines; the box never
    // splits internally.
    expect(leaf.localRect.height).toBe(2);
  });

  it("places the box at its wrapped line and column", () => {
    const { box, leaf } = leafWithBox();
    const container = makeNode({ style: { maxWidth: 8 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(box.localRect).toEqual({ x: 3, y: 0, width: 4, height: 1 });
  });

  it("moves the whole box to the next line when it doesn't fit", () => {
    const { box, leaf } = leafWithBox();
    const container = makeNode({ style: { maxWidth: 5 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // "aa" line 1; box (4) line 2; "bb" fits after? 4 + space 1 + 2 = 7 > 5
    // → "bb" line 3.
    expect(leaf.localRect.height).toBe(3);
    expect(box.localRect.x).toBe(0);
    expect(box.localRect.y).toBe(1);
  });
});

describe("multi-row inline boxes grow their line (CSS line-box growth)", () => {
  it("pushes following lines down by the box's extra rows", () => {
    // Box is 2 rows tall (hard break); leaf wraps to put text after it.
    const box = makeNode({ text: "aa\nbb" });
    box.inlineBox = true;
    const leaf = makeNode({ text: "xx \uFFFC yy", children: [box] });
    leaf.advances = [1, 1, 1, 1, 1, 1, 1];
    const container = makeNode({ style: { maxWidth: 5 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // Line 1: "xx" (1 row). Line 2: the 2-row box. Line 3: "yy" starts
    // BELOW the grown line, at row 3.
    expect(box.localRect.height).toBe(2);
    expect(box.localRect.y).toBe(1);
    expect(leaf.localRect.height).toBe(4);
  });
});

describe("percent spacing", () => {
  it("percent padding resolves against the containing block width", () => {
    const box = makeNode({
      text: "hi",
      style: { padding: { top: 0, right: { percent: 10 }, bottom: 0, left: { percent: 10 } } },
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 40);
    // 10% of 40 = 4 cells per side; fill-width box, content inset by 4.
    expect(box.resolvedPadding.left).toBe(4);
    expect(box.resolvedPadding.right).toBe(4);
  });

  it("percent margin resolves against the parent content width", () => {
    const child = makeNode({
      text: "hi",
      style: { margin: { top: 0, right: 0, bottom: 0, left: { percent: 25 } } },
    });
    const container = makeNode({ children: [child] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // 25% of 40 = 10 cells of left margin.
    expect(child.localRect.x).toBe(10);
  });

  it("percent column-gap resolves against the container's content width", () => {
    const items = ["aa", "bb"].map((text) => makeNode({ text }));
    const container = makeNode({
      style: { display: "flex", flexDirection: "row", gapX: { percent: 10 } },
      children: items,
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // gap = 10% of 40 = 4: second item at 2 + 4 = 6.
    expect(items[1]!.localRect.x).toBe(6);
  });
});

describe("overflow", () => {
  it("carries overflow: clip through to CellStyle so the CSS override applies", () => {
    const container = makeNode({ style: { overflow: "clip" } });
    expect(container.style.overflow).toBe("clip");
  });
});

describe("percent sizes", () => {
  it("percent height resolves against the parent's definite content height", () => {
    const half = makeNode({ text: "x", style: { height: { kind: "percent", value: 50 } } });
    const container = makeNode({
      style: { height: { kind: "cells", value: 10 } },
      children: [half],
    });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(half.localRect.height).toBe(5);
  });

  it("percent height with an indefinite parent behaves as auto", () => {
    const half = makeNode({ text: "x", style: { height: { kind: "percent", value: 50 } } });
    const container = makeNode({ children: [half] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 20);
    expect(half.localRect.height).toBe(1);
  });
});

describe("absolute children and intrinsic sizing", () => {
  it("an absolute child doesn't widen its shrink-to-fit parent", () => {
    const wide = makeNode({
      text: "very very wide absolute content",
      style: { position: "absolute", insets: { top: 0, right: null, bottom: null, left: 0 } },
    });
    const label = makeNode({ text: "hi" });
    const item = makeNode({
      style: { position: "relative", alignSelf: "start" },
      children: [label, wide],
    });
    const column = makeNode({
      style: { display: "flex", flexDirection: "column" },
      children: [item],
    });
    const root = makeNode({ children: [column] });
    layoutRoot(root, 40);
    // self-start → shrink-to-fit: only the in-flow "hi" counts.
    expect(item.localRect.width).toBe(2);
  });
});

describe("intrinsic keywords as min/max limits", () => {
  it("max-w-max caps a fill-width box at its max-content size", () => {
    const box = makeNode({ text: "hello world", style: { maxWidth: "max-content" } });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 40);
    expect(box.localRect.width).toBe(11);
  });

  it("max-w-fit behaves like max-w-max when space is ample", () => {
    const box = makeNode({ text: "hi there", style: { maxWidth: "fit-content" } });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 40);
    expect(box.localRect.width).toBe(8);
  });

  it("min-w-max forces a narrow box up to its unwrapped width", () => {
    const box = makeNode({
      text: "wide unwrapped line",
      style: { width: { kind: "cells", value: 4 }, minWidth: "max-content" },
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 40);
    expect(box.localRect.width).toBe(19);
  });

  it("intrinsic keywords on height limits are no-ops", () => {
    const box = makeNode({ text: "a\nb\nc", style: { maxHeight: "max-content" } });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 10);
    expect(box.localRect.height).toBe(3);
  });
});

describe("typography on the grid", () => {
  it("line gap adds empty rows between wrapped lines only", () => {
    const single = makeNode({ text: "short", style: { lineGap: 1 } });
    const wrapped = makeNode({ text: "one two three", style: { lineGap: 1 } });
    const container = makeNode({ style: { maxWidth: 5 }, children: [single, wrapped] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    expect(single.localRect.height).toBe(1);
    // 3 lines + 2 gaps.
    expect(wrapped.localRect.height).toBe(5);
  });

  it("tracked text takes its advances into account for width and wrapping", () => {
    const leaf = makeNode({ text: "ab cd", intrinsicWidth: 9 });
    leaf.advances = [2, 2, 1, 2, 2];
    const container = makeNode({ style: { maxWidth: 6 }, children: [leaf] });
    const root = makeNode({ children: [container] });
    layoutRoot(root, 40);
    // "ab" (4) + space (1) + "cd" (4) = 9 > 6 → wraps to 2 lines.
    expect(leaf.localRect.height).toBe(2);
  });
});

describe("quantized content alignment on text leaves", () => {
  it("centers bare text in a flex box via engine padding, on whole cells", () => {
    const leaf = makeNode({
      text: "abcd",
      style: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: { kind: "cells", value: 5 },
      },
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 20);
    // Horizontal: leftover 16 → 8 each side; vertical: leftover 4 → 2 + 2.
    expect(leaf.resolvedPadding).toEqual({ top: 2, right: 8, bottom: 2, left: 8 });
    expect(leaf.localRect.height).toBe(5);
  });

  it("floors odd leftovers and pushes end-alignment fully over", () => {
    const centered = makeNode({
      text: "abc",
      style: { display: "flex", justifyContent: "center" },
    });
    const ended = makeNode({
      text: "abc",
      style: { display: "flex", justifyContent: "end" },
    });
    const root = makeNode({ children: [centered, ended] });
    layoutRoot(root, 10);
    // Leftover 7: center floors to 3 (4 on the right); end takes all 7.
    expect(centered.resolvedPadding.left).toBe(3);
    expect(centered.resolvedPadding.right).toBe(4);
    expect(ended.resolvedPadding.left).toBe(7);
    expect(ended.resolvedPadding.right).toBe(0);
  });

  it("swaps axes for flex columns and honors grid place-items", () => {
    const column = makeNode({
      text: "ab",
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "end",
        alignItems: "center",
        height: { kind: "cells", value: 4 },
      },
    });
    const grid = makeNode({
      text: "ab",
      style: {
        display: "grid",
        justifyItems: "center",
        alignItems: "center",
        height: { kind: "cells", value: 3 },
      },
    });
    const root = makeNode({ children: [column, grid] });
    layoutRoot(root, 10);
    // Column: justify = vertical (end → all 3 rows above), align =
    // horizontal (center → 4 + 4).
    expect(column.resolvedPadding).toEqual({ top: 3, right: 4, bottom: 0, left: 4 });
    // Grid: place-items center on both axes.
    expect(grid.resolvedPadding).toEqual({ top: 1, right: 4, bottom: 1, left: 4 });
  });

  it("leaves default (stretch) alignment and wrapped text untouched", () => {
    const plain = makeNode({
      text: "abcd",
      style: { display: "flex", height: { kind: "cells", value: 5 } },
    });
    const wrapped = makeNode({
      text: "one two three",
      style: { display: "flex", justifyContent: "center", maxWidth: 5 },
    });
    const root = makeNode({ children: [plain, wrapped] });
    layoutRoot(root, 20);
    // Default justify/align resolve to stretch → no offsets.
    expect(plain.resolvedPadding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // Wrapped: widest line is "three" (5) = the content width → no
    // horizontal leftover, and the wrap is unchanged (3 lines).
    expect(wrapped.localRect.height).toBe(3);
    expect(wrapped.resolvedPadding.left).toBe(0);
  });
});
