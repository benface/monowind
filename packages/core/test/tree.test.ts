import { describe, expect, it } from "vitest";
import { buildTree } from "../src/tree.ts";
import { INLINE_PAD } from "../src/wrap.ts";
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

  it("gives a computed-block span its own layout node (blockification honored)", () => {
    const node = buildTree(
      el('<div>before <span style="display: block">own line</span> after</div>'),
      16,
    )!;
    // An in-flow block child forces container mode (the direct text is
    // dropped — the documented mixed-content deviation).
    expect(node.children.length).toBe(1);
    expect(node.children[0]!.text).toBe("own line");
  });

  it("excludes display: none inline content from the text run", () => {
    const node = buildTree(el('<div>a <span style="display: none">hidden</span> b</div>'), 16)!;
    expect(node.children).toEqual([]);
    expect(node.text).toBe("a b");
  });

  it("pulls an absolute span out of the run as an out-of-flow child", () => {
    const node = buildTree(
      el('<div>a <span style="position: absolute; top: 0px; left: 0px">badge</span> b</div>'),
      16,
    )!;
    // The leaf keeps its (reflowed) text AND carries the positioned box.
    expect(node.text).toBe("a b");
    expect(node.children.length).toBe(1);
    expect(node.children[0]!.text).toBe("badge");
    expect(node.children[0]!.style.position).toBe("absolute");
  });

  it("keeps a plain inline div in the run; an atomic box becomes a U+FFFC marker", () => {
    const inline = buildTree(el('<div>a <div style="display: inline">b</div> c</div>'), 16)!;
    expect(inline.children).toEqual([]);
    expect(inline.text).toBe("a b c");
    const atomic = buildTree(el('<div>a <div style="display: inline-flex">xy</div> b</div>'), 16)!;
    expect(atomic.text).toBe("a \uFFFC b");
    expect(atomic.children.length).toBe(1);
    expect(atomic.children[0]!.inlineBox).toBe(true);
    expect(atomic.children[0]!.text).toBe("xy");
    // The marker's intrinsic advance is the box's max-content width.
    expect(atomic.advances![2]).toBe(2);
  });

  it("maps an inline-flex box's inner layout to flex", () => {
    const node = buildTree(
      el('<div><div style="display: inline-flex"><i>a</i></i></div></div>'),
      16,
    )!;
    expect(node.children[0]!.style.display).toBe("flex");
  });

  it("skips block-level elements nested inside a run", () => {
    const node = buildTree(
      el('<div>a <span>b <span style="display: block">skipped</span></span> c</div>'),
      16,
    )!;
    expect(node.text).toBe("a b c");
  });

  it("collects a NESTED atomic inline box as a marker too", () => {
    const node = buildTree(
      el('<div>a <span>b <span style="display: inline-block">chip</span></span> c</div>'),
      16,
    )!;
    expect(node.text).toBe("a b \uFFFC c");
    expect(node.children[0]!.inlineBox).toBe(true);
  });

  it("flags dropped direct text on mixed containers (hidden + warned)", () => {
    const mixed = buildTree(el("<div>orphan <div>child</div></div>"), 16)!;
    expect(mixed.droppedText).toBe(true);
    // Whitespace-only text between block children is not "dropped text".
    const clean = buildTree(el("<div>\n  <div>a</div>\n  <div>b</div>\n</div>"), 16)!;
    expect(clean.droppedText).toBeUndefined();
  });

  it("collapses whitespace across inline-element boundaries", () => {
    const node = buildTree(el("<div>a <span> b </span> c</div>"), 16)!;
    expect(node.text).toBe("a b c");
  });
});

describe("inline padding", () => {
  it("reserves quantized cells as glued pad markers and records them", () => {
    // Root 16px → cell 4px: 4px padding = 1 cell each side.
    const node = buildTree(el('<div>a <span style="padding: 0 4px">bb</span> c</div>'), 16)!;
    expect(node.text).toBe(`a ${INLINE_PAD}bb${INLINE_PAD} c`);
    expect(node.advances).toBeUndefined(); // every advance is 1 cell
    expect(node.inlineElements).toHaveLength(1);
    expect(node.inlineElements![0]!.padLeft).toBe(1);
    expect(node.inlineElements![0]!.padRight).toBe(1);
    expect(node.intrinsicWidth).toBe(8);
  });

  it("emits one marker per cell for multi-cell padding", () => {
    const node = buildTree(el('<div><span style="padding-left: 8px">x</span></div>'), 16)!;
    expect(node.text).toBe(`${INLINE_PAD}${INLINE_PAD}x`);
  });

  it("collapses spaces through pad markers, per CSS", () => {
    const node = buildTree(el('<div>a <span style="padding-left: 4px"> b</span></div>'), 16)!;
    // The space inside the span follows the outer space (padding between
    // them is not a character) — collapsed.
    expect(node.text).toBe(`a ${INLINE_PAD}b`);
  });
});

describe("white-space: pre", () => {
  it("preserves spaces and newlines, dropping only a final newline", () => {
    const node = buildTree(
      el('<div style="white-space: pre">  two  spaces\nsecond line\n</div>'),
      16,
    )!;
    expect(node.text).toBe("  two  spaces\nsecond line");
    expect(node.intrinsicHeight).toBe(2);
    expect(node.intrinsicWidth).toBe(13);
    expect(node.style.whiteSpace).toBe("pre");
  });

  it("expands tabs to tab stops from each hard line's start", () => {
    const node = buildTree(el('<div style="white-space: pre">ab\tc\n\td</div>'), 16)!;
    // Column 2 → next stop 8; line start → stop 8.
    expect(node.text).toBe("ab      c\n        d");
  });

  it("keeps collapsing without the pre flag", () => {
    const node = buildTree(el('<div style="white-space: pre-line">a\n b</div>'), 16)!;
    expect(node.style.whiteSpace).toBe("normal");
    expect(node.text).toBe("a b");
  });
});
