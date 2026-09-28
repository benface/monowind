import { describe, expect, it, vi } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { charIndexAt, positionOf } from "../src/selection.ts";
import { buildRoot, buildTree } from "../src/tree.ts";
import { INLINE_PAD, WBR_MARKER } from "../src/wrap.ts";
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

  it("treats an element with a block child as a container, its own text a run", () => {
    const node = buildTree(el("<div>orphan text<div>child</div></div>"), 16)!;
    expect(node.text).toBe("");
    expect(node.children.map((child) => child.text)).toEqual(["orphan text", "child"]);
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
    layoutRoot(node, 20);
    expect(node.inlineElements?.length).toBe(1);
    expect(node.inlineElements![0]!.insets).toEqual({
      top: 1, // 4px = 1 cell at 16px root font size
      right: null,
      bottom: null,
      left: null,
    });
  });

  it("reads a stylesheet's inset on a relative inline element, lacking Typed OM", () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = ".raised { position: relative; top: -8px }";
    try {
      const node = buildTree(el('<div>a <span class="raised">up</span> b</div>'), 16)!;
      layoutRoot(node, 20);
      expect(node.inlineElements![0]!.insets).toMatchObject({ top: -2 });
    } finally {
      sheet.remove();
    }
  });

  it("records inline elements without insets as not positioned", () => {
    const node = buildTree(el('<div><span style="position: relative">plain</span></div>'), 16)!;
    layoutRoot(node, 20);
    const noInsets = (e: { insets: PerSide<number | null> | null }) =>
      e.insets === null || Object.values(e.insets).every((v) => v === null);
    expect(node.inlineElements?.every(noInsets)).toBe(true);
  });

  it("resolves an inline element's percent insets against its leaf's content box", () => {
    const insets = (height: string) => {
      const node = buildTree(
        el(
          `<div style="${height}"><span style="position: relative; left: 50%">a</span> <i style="position: relative; top: 50%">b</i></div>`,
        ),
        16,
      )!;
      layoutRoot(node, 20);
      return node.inlineElements!.map((entry) => entry.insets);
    };
    // Half the leaf's 20 cells across; half its 10 rows down, where definite.
    expect(insets("height: 40px")).toMatchObject([{ left: 10 }, { top: 5 }]);
    expect(insets("")).toMatchObject([{ left: 10 }, { top: 0 }]);
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
    // An in-flow block child makes the element a container; the text
    // around it forms anonymous runs (specs/cell-model.md).
    expect(node.children.map((child) => child.text)).toEqual(["before", "own line", "after"]);
    expect(node.children.map((child) => child.anonymous)).toEqual([true, undefined, true]);
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
    expect(atomic.children[0]!.inlineBox).toBeDefined();
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

  it("splits an inline element around a block inside it, as CSS does", () => {
    // CSS 2.1 block-in-inline: the inline box breaks into anonymous
    // blocks each side of it, and all three render.
    const node = buildTree(
      el('<div>a <span>b <span style="display: block">own line</span> d</span> c</div>'),
      16,
    )!;
    expect(node.children.map((child) => child.text)).toEqual(["a b", "own line", "d c"]);
    expect(node.children[0]!.anonymous).toBe(true);
    expect(node.children[2]!.anonymous).toBe(true);
    // The block is its own node, the element itself, not an anonymous
    // run over it.
    expect(node.children[1]!.anonymous).toBeFalsy();
  });

  it("splits through more than one inline, and leaves an atomic box its blocks", () => {
    const deep = buildTree(el("<div>a <span><em>b <p>own line</p></em></span> c</div>"), 16)!;
    expect(deep.children.map((child) => child.text)).toEqual(["a b", "own line", "c"]);
    // An inline-block is its own formatting context: the block inside
    // it stays inside it, and the box still rides the run.
    const atomic = buildTree(
      el('<div>a <span style="display: inline-block"><p>inside</p></span> c</div>'),
      16,
    )!;
    expect(atomic.text).toBe("a \uFFFC c");
    expect(atomic.children[0]!.inlineBox).toBeDefined();
  });

  it("collects a NESTED atomic inline box as a marker too", () => {
    const node = buildTree(
      el('<div>a <span>b <span style="display: inline-block">chip</span></span> c</div>'),
      16,
    )!;
    expect(node.text).toBe("a b \uFFFC c");
    expect(node.children[0]!.inlineBox).toBeDefined();
  });

  it("counts a w-fit atomic inline box at its max-content in the run's width", () => {
    const node = buildTree(
      el(
        '<div>ab <span style="display: inline-block; width: fit-content">Save changes</span></div>',
      ),
      16,
    )!;
    expect(node.intrinsicWidth).toBe(15);
  });

  it("counts an atomic inline box's margins in the run's width", () => {
    const node = buildTree(
      el('<div>ab <span style="display: inline-block; margin: 0 8px 0 4px">chip</span> c</div>'),
      16,
    )!;
    // "ab " 3, the margin box 1 + 4 + 2, " c" 2.
    expect(node.intrinsicWidth).toBe(12);
  });

  it("indents a mixed container's first run alone", () => {
    const node = buildTree(el('<div style="text-indent: 8px">first<p>block</p>second</div>'), 16)!;
    // The block inherits the indent for its own first line.
    expect(node.children.map((child) => [child.text, child.style.textIndent])).toEqual([
      ["first", 2],
      ["block", 2],
      ["second", 0],
    ]);
  });

  it("indents the first run past a leading float, the first formatted line", () => {
    const node = buildTree(
      el('<div style="text-indent: 8px"><div style="float: left">f</div>first<p>block</p></div>'),
      16,
    )!;
    expect(node.children.map((child) => [child.text, child.style.textIndent])).toEqual([
      ["f", 2],
      ["first", 2],
      ["block", 2],
    ]);
  });

  it("counts a fixed indent in a leaf's intrinsic widths, a negative one narrowing", () => {
    const width = (style: string) => {
      const node = buildTree(el(`<div><div style="${style}">ab cdefgh</div></div>`), 16)!;
      layoutRoot(node, 40);
      return node.children[0]!.localRect.width;
    };
    expect(width("width: max-content; text-indent: 48px")).toBe(21);
    expect(width("width: min-content; text-indent: 48px")).toBe(14);
    expect(width("width: max-content; text-indent: -4px")).toBe(8);
  });

  it("builds a grid holding only text over one anonymous run, its item", () => {
    const node = buildTree(el('<div style="display: grid">some text</div>'), 16)!;
    expect(node.text).toBe("");
    expect(node.children.map((child) => [child.anonymous, child.text])).toEqual([
      [true, "some text"],
    ]);
  });

  it("splits through `contents`, a float, and keeps an out-of-flow child of the split", () => {
    // `contents` folds its children into the run exactly as `inline`
    // does, so a block under it splits the same way.
    const contents = buildTree(
      el('<div>a <span style="display: contents">b <p>own line</p></span> c</div>'),
      16,
    )!;
    expect(contents.children.map((child) => child.text)).toEqual(["a b", "own line", "c"]);
    // A float is block-level whatever its display (specs/float.md), so
    // it splits the inline around it too.
    const floated = buildTree(
      el('<div>a <span>b <span style="float: left">side</span></span> c</div>'),
      16,
    )!;
    expect(floated.children.map((child) => child.text)).toEqual(["a b", "side", "c"]);
    // The out-of-flow element the inline was carrying is still built,
    // now as the container's own positioned child.
    const positioned = buildTree(
      el('<div>a <span>b <i style="position: absolute">out</i><p>own line</p></span></div>'),
      16,
    )!;
    expect(positioned.children.map((child) => child.text)).toEqual(["a b", "own line"]);
    expect(positioned.children[0]!.children.map((child) => child.source.tagName)).toEqual(["I"]);
  });

  it("lays out text beside block children as anonymous runs", () => {
    const mixed = buildTree(el("<div>orphan <div>child</div></div>"), 16)!;
    expect(mixed.children.map((child) => child.text)).toEqual(["orphan", "child"]);
    expect(mixed.children[0]!.anonymous).toBe(true);
    expect(mixed.children[0]!.source).toBe(mixed.source);
    // Whitespace between block children forms no run; an out-of-flow
    // element there is the container's own positioned child.
    const clean = buildTree(
      el(
        '<div>\n  <div>a</div>\n  <span style="position: absolute">abs</span>\n  <div>b</div>\n</div>',
      ),
      16,
    )!;
    expect(clean.children.map((child) => child.text)).toEqual(["a", "abs", "b"]);
    expect(clean.children.some((child) => child.anonymous)).toBe(false);
    // A run carries its inline elements, atomic boxes, and out-of-flow
    // elements like any leaf.
    const rich = buildTree(
      el(
        '<div>foo <a href="#">link</a> <i style="position: absolute">abs</i><div>bar</div>' +
          '<span style="display: inline-block">chip</span> baz</div>',
      ),
      16,
    )!;
    const [first, , last] = rich.children;
    expect(first!.text).toBe("foo link");
    expect(first!.inlineElements).toHaveLength(1);
    expect(first!.children[0]!.style.position).toBe("absolute");
    expect(last!.text).toBe("\uFFFC baz");
    expect(last!.children[0]!.inlineBox).toBeDefined();
    // A flex container's runs are its anonymous items.
    const flex = buildTree(el('<div style="display: flex">foo<div>bar</div>baz</div>'), 16)!;
    expect(flex.children.map((child) => child.anonymous)).toEqual([true, undefined, true]);
  });

  it("takes a floated inline out of its run, the text around it a run (specs/float.md)", () => {
    const node = buildTree(el('<div>before <span style="float: left">A</span> after</div>'), 16)!;
    expect(node.text).toBe("");
    expect(node.children.map((child) => child.text)).toEqual(["before", "A", "after"]);
    expect(node.children.map((child) => child.style.float)).toEqual(["none", "left", "none"]);
    expect(node.children.map((child) => child.anonymous)).toEqual([true, undefined, true]);
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

  it("keeps an inline element's style on its text where it splits around a block", () => {
    const node = buildTree(el('<div><span style="color: red">a <div>b</div> c</span></div>'), 16)!;
    const runs = node.children.filter((child) => child.anonymous);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.inlineElements?.[0]?.color).toBe("red");
      expect(run.charInline?.every((index) => index === 0)).toBe(true);
    }
  });

  it("warns once on an inline element's border, which draws nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bordered = el('<div>a <span style="border: 1px solid">b</span> c</div>');
      buildTree(bordered, 16);
      buildTree(bordered, 16);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain("border on an inline element");
      warn.mockClear();
      buildTree(el('<div>a <span style="border: 0 solid">b</span> c</div>'), 16);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

  it("keeps spaces and newlines under pre-wrap and break-spaces, its lines wrapping", () => {
    const lines = { "pre-wrap": ["a", "b", "", "c"], "break-spaces": ["a ", " b", "  ", "c"] };
    for (const [whiteSpace, expected] of Object.entries(lines)) {
      const node = buildTree(el(`<div style="white-space: ${whiteSpace}">a  b\n  c</div>`), 16)!;
      expect(node.style.whiteSpace).toBe(whiteSpace);
      expect(node.text).toBe("a  b\n  c");
      layoutRoot(node, 2);
      expect(node.lines!.spans.map(({ start, end }) => node.text.slice(start, end))).toEqual(
        expected,
      );
    }
  });

  it("breaks at newlines under pre-line, its spaces collapsing and its lines wrapping", () => {
    const node = buildTree(
      el('<div style="white-space: pre-line">a  \n  b  c\nd <span>e\nf</span></div>'),
      16,
    )!;
    expect(node.style.whiteSpace).toBe("pre-line");
    expect(node.text).toBe("a\nb c\nd e\nf");
    layoutRoot(node, 2);
    expect(node.lines!.spans.map(({ start, end }) => node.text.slice(start, end))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });
});

describe("a textarea's rows", () => {
  it("wraps its value as pre-wrap, its spaces kept", () => {
    const textarea = el(
      '<textarea style="field-sizing: content"></textarea>',
    ) as HTMLTextAreaElement;
    textarea.value = "          x";
    const node = buildTree(textarea, 16, undefined, new Map([[textarea, 5]]))!;
    // The spaces hang past the line's end, the `x` on the next.
    expect(node.intrinsicHeight).toBe(2);
  });
});

describe("<wbr>", () => {
  it("keeps a <wbr> as a break opportunity standing for no text", () => {
    const node = buildTree(el("<p>super<wbr>califragilistic</p>"), 16)!;
    expect(node.text).toBe(`super${WBR_MARKER}califragilistic`);
    layoutRoot(node, 16);
    expect(node.lines!.spans.map(({ start, end }) => node.text.slice(start, end))).toEqual([
      `super${WBR_MARKER}`,
      "califragilistic",
    ]);
  });

  it("draws nothing for one", () => {
    const node = buildTree(el("<p>super<wbr>long</p>"), 16)!;
    layoutRoot(node, 20);
    expect(renderPlainText(node)).toBe("superlong");
  });

  it("collapses the spaces around one, and trims them before a break", () => {
    expect(buildTree(el("<p>a <wbr> b</p>"), 16)!.text).toBe(`a ${WBR_MARKER}b`);
    expect(buildTree(el("<p>a <wbr><br>b</p>"), 16)!.text).toBe(`a${WBR_MARKER}\nb`);
  });
});

describe("text-transform", () => {
  const text = (html: string) => buildTree(el(html), 16)!.text;

  it("draws the text in the case it puts it in", () => {
    expect(text('<p style="text-transform: uppercase">hello <b>world</b></p>')).toBe("HELLO WORLD");
    expect(text('<p style="text-transform: lowercase">HeLLo</p>')).toBe("hello");
    expect(text('<p>a <span style="text-transform: uppercase">b</span> c</p>')).toBe("a B c");
    expect(text('<p style="text-transform: uppercase; white-space: pre">a\tb</p>')).toBe(
      "A       B",
    );
  });

  it("capitalizes each word's first letter, a word running across elements", () => {
    const capitalized = (html: string) => text(`<p style="text-transform: capitalize">${html}</p>`);
    expect(capitalized("hello-world don't (stop) foo_bar 3pm a·b e.g.")).toBe(
      "Hello-World Don't (Stop) Foo_bar 3pm A·b E.G.",
    );
    expect(capitalized("hel<b>lo</b> x<i>y</i>")).toBe("Hello Xy");
    expect(capitalized("ABC dEF ǆemal ßa")).toBe("ABC DEF ǅemal Ssa");
    expect(text('<p>hel<span style="text-transform: capitalize">lo wo</span>rld</p>')).toBe(
      "hello World",
    );
  });

  it("maps each text node as a whole, in its content language", () => {
    expect(text('<p lang="tr" style="text-transform: uppercase">istanbul</p>')).toBe("İSTANBUL");
    expect(text('<p lang="en_US" style="text-transform: uppercase">i</p>')).toBe("I");
    expect(text('<p style="text-transform: lowercase">ΟΔΟΣ ΣΑΣ</p>')).toBe("οδος σας");
    expect(text('<p style="text-transform: lowercase">ΟΔΟ<span>Σ</span></p>')).toBe("οδοσ");
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

  it("keeps text on the first row for top and the off-grid baseline, the middle row for middle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const align of ["top", "baseline"]) {
        const node = buildTree(el(`<div>lo ${box(align)} fi</div>`), 16)!;
        layoutRoot(node, 20);
        expect(renderPlainText(node), align).toBe(["lo   fi", "", ""].join("\n"));
      }
      const node = buildTree(el(`<div>lo ${box("middle")} fi</div>`), 16)!;
      layoutRoot(node, 20);
      expect(renderPlainText(node)).toBe(["", "lo   fi", ""].join("\n"));
      expect(warn).not.toHaveBeenCalled();
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

  it("maps a lengthened cluster's characters to it, a point there before the first", () => {
    const root = el('<div style="text-transform: uppercase">straße</div>');
    const node = buildTree(root, 16)!;
    const [text] = textNodes(root);
    expect(node.text).toBe("STRASSE");
    expect(node.intrinsicWidth).toBe(7);
    expect(node.charSource).toEqual([
      { index: 0, length: 5, node: text, offset: 0 },
      { index: 5, length: 2, node: text, offset: 4 },
    ]);
    expect(charIndexAt(node, text!, 4)).toBe(4);
    expect(charIndexAt(node, text!, 5)).toBe(6);
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

describe("the host's own text", () => {
  it("takes pointer events whatever the host reads", () => {
    // As the host's top-level elements read them (element.ts): a value
    // on the host, or one a lock above it hands down (a modal's, on the
    // body), is the page's.
    const host = el('<div style="pointer-events: none">foo<div>bar</div></div>');
    expect(getComputedStyle(host).pointerEvents).toBe("none");
    expect(buildRoot(host, 16).style.pointerEvents).toBe(true);
  });
});
