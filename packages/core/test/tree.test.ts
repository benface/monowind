import { describe, expect, it, vi } from "vitest";
import { renderPlainText } from "../src/plain-text.ts";
import { layoutRoot } from "../src/layout.ts";
import { charIndexAt, positionOf } from "../src/selection.ts";
import { buildTree } from "../src/tree.ts";
import { INLINE_PAD } from "../src/wrap.ts";
import { inlineBoxesOf } from "../src/types.ts";
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

  it("keeps edge <br> line boxes like browsers (final one excepted)", () => {
    // a<br><br> renders one blank line; <br>a renders a blank first line;
    // a lone <br> makes the leaf one line tall (probed, all engines).
    expect(buildTree(el("<div>a<br /><br /></div>"), 16)!.intrinsicHeight).toBe(2);
    expect(buildTree(el("<div><br />a</div>"), 16)!.intrinsicHeight).toBe(2);
    expect(buildTree(el("<div><br /></div>"), 16)!.intrinsicHeight).toBe(1);
    expect(buildTree(el("<div>a<br /></div>"), 16)!.intrinsicHeight).toBe(1);
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
  it("preserves spaces and newlines; the final newline adds no line", () => {
    const node = buildTree(
      el('<div style="white-space: pre">  two  spaces\nsecond line\n</div>'),
      16,
    )!;
    // The final newline survives in the text; the wrap layer gives it no
    // line box (dropFinalBreakSpan), so the height stays 2.
    expect(node.text).toBe("  two  spaces\nsecond line\n");
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

describe("atomic inline box vertical-align", () => {
  const box = (align: string) =>
    `<span style="display: inline-block; width: 4px; height: 12px; vertical-align: ${align}"></span>`;

  it("drops the line's text to a bottom-aligned box's last row", () => {
    const node = buildTree(el(`<div>lo ${box("bottom")} fi</div>`), 16)!;
    layoutRoot(node, 20);
    expect(renderPlainText(node)).toBe(["", "", "lo   fi"].join("\n"));
  });

  it("keeps text on the first row for top (and off-grid values); middle warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const align of ["top", "middle", "baseline"]) {
        const node = buildTree(el(`<div>lo ${box(align)} fi</div>`), 16)!;
        layoutRoot(node, 20);
        expect(renderPlainText(node), align).toBe(["lo   fi", "", ""].join("\n"));
      }
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("text-align end", () => {
  it("offsets each line to the content box's right edge", () => {
    const node = buildTree(
      el(`<div style="width: 40px; text-align: end">hi there world</div>`),
      16,
    )!;
    layoutRoot(node, 10);
    expect(renderPlainText(node)).toBe(["  hi there", "     world"].join("\n"));
  });

  it("keeps overflowing nowrap lines at start", () => {
    const node = buildTree(
      el(
        `<div style="width: 40px"><div style="width: 16px; text-align: end; white-space: nowrap">too long</div></div>`,
      ),
      16,
    )!;
    layoutRoot(node, 10);
    expect(renderPlainText(node)).toBe("too long");
  });
});

describe("character ↔ DOM position map (specs/semantic-selection.md)", () => {
  const textNodes = (node: Element): Text[] => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const out: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
    return out;
  };

  it("maps plain text one-to-one", () => {
    const root = el("<div>hello</div>");
    const node = buildTree(root, 16)!;
    const [text] = textNodes(root);
    expect(node.charSource).toEqual([{ index: 0, length: 5, node: text, offset: 0 }]);
    expect(positionOf(node, 2)).toEqual({ node: text, offset: 2 });
    expect(charIndexAt(node, text!, 3)).toBe(3);
  });

  it("keeps the first source character of collapsed whitespace, across nodes", () => {
    const root = el("<div>  hello  <b> world </b>x</div>");
    const node = buildTree(root, 16)!;
    const [t1, t2, t3] = textNodes(root);
    expect(node.text).toBe("hello world x");
    expect(node.charSource).toEqual([
      { index: 0, length: 6, node: t1, offset: 2 },
      { index: 6, length: 6, node: t2, offset: 1 },
      { index: 12, length: 1, node: t3, offset: 0 },
    ]);
    // Points in the leading blank land on the first character; the
    // space kept between the words is the first node's.
    expect(charIndexAt(node, t1!, 0)).toBe(0);
    expect(charIndexAt(node, t1!, 1)).toBe(0);
    expect(positionOf(node, 5)).toEqual({ node: t1, offset: 7 });
    // The <b>'s own leading blank collapsed away: a point in it is the
    // next character.
    expect(charIndexAt(node, t2!, 0)).toBe(6);
    expect(positionOf(node, node.text.length)).toEqual({ node: t3, offset: 1 });
  });

  it("gives <br> no position and trims the spaces before it", () => {
    const root = el("<div>ab <br>cd</div>");
    const node = buildTree(root, 16)!;
    const [t1, t2] = textNodes(root);
    expect(node.text).toBe("ab\ncd");
    expect(node.charSource).toEqual([
      { index: 0, length: 2, node: t1, offset: 0 },
      { index: 3, length: 2, node: t2, offset: 0 },
    ]);
    expect(positionOf(node, 2)).toEqual({ node: t1, offset: 2 });
    expect(positionOf(node, 3)).toEqual({ node: t2, offset: 0 });
    // A point at the <br> itself (its parent, its child index) is the
    // end of the line before it.
    expect(charIndexAt(node, root, 1)).toBe(2);
  });

  it("skips padding markers and nested inline elements' boundaries", () => {
    const root = el('<div>a <span style="padding: 0 4px">b</span> c</div>');
    const node = buildTree(root, 16)!;
    const [t1, t2, t3] = textNodes(root);
    expect(node.text).toBe(`a ${INLINE_PAD}b${INLINE_PAD} c`);
    expect(node.charSource).toEqual([
      { index: 0, length: 2, node: t1, offset: 0 },
      { index: 3, length: 1, node: t2, offset: 0 },
      { index: 5, length: 2, node: t3, offset: 0 },
    ]);
    expect(charIndexAt(node, t2!, 0)).toBe(3);
    expect(positionOf(node, 4)).toEqual({ node: t2, offset: 1 });
  });

  it("resolves a point inside an atomic inline box to its marker", () => {
    const root = el('<div>ab <span style="display: inline-block">X</span> cd</div>');
    const node = buildTree(root, 16)!;
    const [, boxText] = textNodes(root);
    expect(node.text).toBe("ab ￼ cd");
    expect(charIndexAt(node, boxText!, 1)).toBe(3);
    expect(positionOf(node, 4)).toEqual({ node: textNodes(root)[2], offset: 0 });
  });

  it("maps preserved text, newlines included", () => {
    const root = el('<div style="white-space: pre">a\n b</div>');
    const node = buildTree(root, 16)!;
    const [text] = textNodes(root);
    expect(node.text).toBe("a\n b");
    expect(node.charSource).toEqual([{ index: 0, length: 4, node: text, offset: 0 }]);
    expect(positionOf(node, 1)).toEqual({ node: text, offset: 1 });
  });

  it("round-trips every mapped index", () => {
    const root = el(
      '<div>  one <b>two  </b> <i>three</i>four<br>five  <span style="padding-left: 4px">six</span></div>',
    );
    const node = buildTree(root, 16)!;
    for (const run of node.charSource!) {
      for (let k = 0; k <= run.length; k++) {
        const index = run.index + k;
        const position = positionOf(node, index)!;
        expect(charIndexAt(node, position.node, position.offset)).toBe(index);
      }
    }
  });
});

describe("atomic inline boxes in marker order", () => {
  it("sorts a box nested in an inline ancestor into its document position", () => {
    const root = el(
      '<p>a <b><span style="display: inline-block">NESTED</span></b> b <span style="display: inline-block">YY</span> c</p>',
    );
    const node = buildTree(root, 16)!;
    expect(node.text).toBe("a ￼ b ￼ c");
    expect(inlineBoxesOf(node).map((box) => box.text)).toEqual(["NESTED", "YY"]);
    layoutRoot(node, 40);
    expect(renderPlainText(node)).toBe("a NESTED b YY c");
  });
});
