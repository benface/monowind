import { describe, expect, it } from "vitest";
import { focusableRects } from "../src/focus.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderCellSegments, renderPlainText } from "../src/plain-text.ts";
import { hitChain } from "../src/pointer.ts";
import { serializeSelection } from "../src/selection.ts";
import { render } from "../src/render.ts";
import { readVisible } from "../src/style.ts";
import { buildTree } from "../src/tree.ts";
import type { CellStyle, LayoutNode } from "../src/types.ts";
import { parseColor } from "../src/color.ts";
import { registerLeafRenderer } from "../src/leaf.ts";
import { makeNode } from "./helpers.ts";

/** `visibility` (specs/visibility.md): a hidden box keeps its space and
 * paints none of its own ink, a visible descendant still paints, and
 * the hidden box takes no hit, focus, or copied text. */

function build(html: string, cols = 20): { host: HTMLElement; root: LayoutNode } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const root = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(root, cols);
  return { host, root };
}

const rows = (root: LayoutNode): string[] => renderPlainText(root).split("\n");

describe("the read", () => {
  it("takes hidden and collapse as hidden, anything else as visible", () => {
    const read = (visibility: string) => readVisible({ visibility } as CSSStyleDeclaration);
    expect(read("hidden")).toBe(false);
    expect(read("collapse")).toBe(false);
    expect(read("visible")).toBe(true);
    // A DOM without the property paints.
    expect(read("")).toBe(true);
  });
});

describe("the paint", () => {
  it("keeps a hidden block's rows blank, the blocks after it where they were", () => {
    const { root } = build(
      `<div><p>one</p><p style="visibility: hidden">two</p><p>three</p></div>`,
    );
    expect(rows(root)).toEqual(["one", "", "three"]);
  });

  it("paints a visible descendant of a hidden box, and inherits hidden otherwise", () => {
    const { root } = build(
      `<div style="visibility: hidden"><p>gone</p><p style="visibility: visible">back</p><p>gone too</p></div>`,
    );
    // The hidden box keeps its third row, blank.
    expect(rows(root)).toEqual(["", "back", ""]);
  });

  it("leaves a hidden inline element's cells blank in its line, their space kept", () => {
    const { root } = build(`<p>a <span style="visibility: hidden">secret</span> b</p>`);
    expect(rows(root)).toEqual(["a        b"]);
  });

  it("keeps a hidden inline element's text hidden where it splits around a block", () => {
    const { root } = build(
      `<div><span style="visibility: hidden">hid <div>blk</div> den</span><p>shown</p></div>`,
    );
    const art = renderPlainText(root);
    expect(art).not.toMatch(/hid|blk|den/);
    expect(art).toContain("shown");
  });

  it("paints a visible inline element inside a hidden paragraph", () => {
    const { root } = build(
      `<p style="visibility: hidden">gone <span style="visibility: visible">here</span> gone</p>`,
    );
    expect(rows(root)).toEqual(["     here"]);
  });

  it("gives a hidden text-clip box's fill to no glyph, a visible span's included", () => {
    const tinted = (visibility: string): boolean => {
      const { root } = build(
        `<p style="visibility: ${visibility}; background-color: rgb(255, 0, 0); background-clip: text; color: transparent">gone <span style="visibility: visible">here</span></p>`,
      );
      return renderCellSegments(root)[0]!.some((segment) =>
        [segment.color, ...(segment.colors ?? [])].some((color) => color?.includes("255")),
      );
    };
    expect(tinted("visible")).toBe(true);
    expect(tinted("hidden")).toBe(false);
  });

  it("leaves a hidden atomic inline box's cells blank, its space kept", () => {
    const { root } = build(
      `<p>a <span style="display: inline-block; visibility: hidden">box</span> b</p>`,
    );
    expect(rows(root)).toEqual(["a     b"]);
  });

  it("flags a hidden element for the stylesheet, which keeps its authored visibility", () => {
    const { root, host } = build(
      `<div><p data-test="gone" style="visibility: hidden">gone</p><p data-test="kept">kept</p></div>`,
    );
    render(root);
    expect(host.querySelector('[data-test="gone"]')!.hasAttribute("data-mw-invisible")).toBe(true);
    expect(host.querySelector('[data-test="kept"]')!.hasAttribute("data-mw-invisible")).toBe(false);
  });

  it("paints no scrollbar or border on a hidden scroll container", () => {
    const scroller = (visible: boolean) => {
      const box = makeNode({
        style: {
          overflow: { x: "visible", y: "scroll" },
          border: { top: 1, right: 1, bottom: 1, left: 1 },
          width: { kind: "cells", value: 10 },
          visible,
        },
        text: "aaa bbb ccc",
      });
      const root = makeNode({ children: [box] });
      layoutRoot(root, 12);
      return renderPlainText(root);
    };
    expect(scroller(true)).toMatch(/█/);
    expect(scroller(false)).not.toMatch(/[█░│─]/);
  });
});

describe("a hidden box's own ink, each piece", () => {
  const red = parseColor("rgb(255, 0, 0)")!;
  const blue = parseColor("rgb(0, 0, 255)")!;
  /** Whether a 6×3 box with `style` and `text` paints anything of its
   * own in a 12×6 host filled `under`: a glyph, or a fill other than
   * the host's. */
  const inked = (style: Partial<CellStyle>, text = "", under?: string): boolean => {
    const box = makeNode({
      style: { width: { kind: "cells", value: 6 }, height: { kind: "cells", value: 3 }, ...style },
      text,
      intrinsicWidth: text.length,
    });
    const root = makeNode({
      style: { height: { kind: "cells", value: 6 }, ...(under ? { backgroundColor: under } : {}) },
      children: [box],
    });
    layoutRoot(root, 12);
    return renderCellSegments(root)
      .flat()
      .some(
        (segment) =>
          segment.text.trim() !== "" ||
          segment.backgroundColor !== under ||
          (segment.backgrounds?.some((color) => color !== under) ?? false),
      );
  };
  const cases: [string, Partial<CellStyle>, string?, string?][] = [
    ["a fill", { backgroundColor: "red" }],
    ["a border", { border: { top: 1, right: 1, bottom: 1, left: 1 } }],
    // The host's fill shows through a hidden box's clear, as through no
    // box at all.
    ["a bg-clear wipe", { backgroundClear: true }, "", "red"],
    [
      "a gradient fill",
      {
        backgroundImage: [
          {
            kind: "linear",
            repeating: false,
            space: "srgb",
            hue: "shorter",
            stops: [
              { color: red, position: null },
              { color: blue, position: null },
            ],
            direction: { toX: 1, toY: 0 },
          },
        ],
      },
    ],
    [
      "an outer shadow",
      { boxShadow: [{ x: 1, y: 1, blur: 0, spread: 0, color: "red", inset: false }] },
    ],
    [
      "an inset shadow",
      { boxShadow: [{ x: 0, y: 0, blur: 0, spread: 1, color: "red", inset: true }] },
    ],
    [
      "a truncation ellipsis",
      { whiteSpace: "nowrap", overflow: { x: "clip", y: "clip" }, textOverflow: "ellipsis" },
      "a line too long for it",
    ],
  ];
  it.each(cases)("paints none of %s", (_, style, text, under) => {
    expect(inked({ ...style, visible: true }, text, under), "the visible control").toBe(true);
    expect(inked({ ...style, visible: false }, text, under)).toBe(false);
  });

  it("paints no collapsed table lines", () => {
    const table = (visibility: string) =>
      renderPlainText(
        build(
          `<table style="border-collapse: collapse; visibility: ${visibility}"><tr><td style="border: 1px solid">a</td></tr></table>`,
        ).root,
      );
    expect(table("visible")).toMatch(/[┌┐└┘│─]/);
    expect(table("hidden")).not.toMatch(/[┌┐└┘│─]/);
  });

  it("paints no renderer leaf's art", () => {
    registerLeafRenderer({
      tag: "test-hidden-art",
      render: () => ({
        lines: ["AB"],
        runs: [{ line: 0, start: 0, end: 2, paint: { color: "red" } }],
      }),
    });
    const art = (visibility: string) =>
      renderPlainText(
        build(`<div><test-hidden-art style="visibility: ${visibility}"></test-hidden-art></div>`)
          .root,
      );
    expect(art("visible")).toContain("AB");
    expect(art("hidden")).not.toContain("AB");
  });
});

describe("the hit", () => {
  it("passes through a hidden box to the one under it", () => {
    const { root, host } = build(
      `<div style="position: relative"><p data-test="under">under here</p><div data-test="over" style="position: absolute; top: 0; left: 0; width: 5rem; height: 0.25rem; visibility: hidden">over</div></div>`,
    );
    const under = host.querySelector('[data-test="under"]')!;
    const over = host.querySelector('[data-test="over"]')!;
    const chain = hitChain(root, 0, 0, null);
    expect(chain).toContain(under);
    expect(chain).not.toContain(over);
  });

  it("hits a visible inline element in a hidden paragraph, the paragraph in the chain", () => {
    const { root, host } = build(
      `<div><p data-test="p" style="visibility: hidden">gone <span style="visibility: visible">here</span></p></div>`,
    );
    expect(hitChain(root, 6, 0, null)).toContain(host.querySelector('[data-test="p"]'));
    // Its hidden text takes no hit.
    expect(hitChain(root, 1, 0, null)).not.toContain(host.querySelector('[data-test="p"]'));
  });

  it("hits a visible inline element in a hidden anonymous run", () => {
    const { root, host } = build(
      `<div><div data-test="box" style="visibility: hidden"><p>block</p>gone <span style="visibility: visible">here</span></div></div>`,
    );
    const box = host.querySelector('[data-test="box"]');
    expect(hitChain(root, 6, 1, null)).toContain(box);
    expect(hitChain(root, 1, 1, null)).not.toContain(box);
  });

  it("passes a press on a hidden atomic inline box to its line", () => {
    const { root, host } = build(
      `<div><p data-test="line">a <span data-test="box" style="display: inline-block; visibility: hidden">box</span> b</p></div>`,
    );
    const chain = hitChain(root, 3, 0, null);
    expect(chain).toContain(host.querySelector('[data-test="line"]'));
    expect(chain).not.toContain(host.querySelector('[data-test="box"]'));
  });

  it("hits a visible descendant through its hidden ancestor, which stays in the chain", () => {
    const { root, host } = build(
      `<div><div data-test="hidden" style="visibility: hidden"><p data-test="shown" style="visibility: visible">here</p></div></div>`,
    );
    const chain = hitChain(root, 0, 0, null);
    expect(chain).toContain(host.querySelector('[data-test="shown"]'));
    expect(chain).toContain(host.querySelector('[data-test="hidden"]'));
  });
});

describe("the focus", () => {
  it("skips a hidden control and keeps a visible one under a hidden box", () => {
    const { root, host } = build(
      `<div><button data-test="gone" style="visibility: hidden">gone</button><div style="visibility: hidden"><button data-test="kept" style="visibility: visible">kept</button></div></div>`,
    );
    const elements = focusableRects(root).map((entry) => entry.element);
    expect(elements).not.toContain(host.querySelector('[data-test="gone"]'));
    expect(elements).toContain(host.querySelector('[data-test="kept"]'));
  });

  it("keeps a visible link inside a hidden paragraph", () => {
    const { root, host } = build(
      `<p style="visibility: hidden">gone <a href="#" data-test="kept" style="visibility: visible">kept</a></p>`,
    );
    const elements = focusableRects(root).map((entry) => entry.element);
    expect(elements).toContain(host.querySelector('[data-test="kept"]'));
  });

  it("skips a hidden link in a line of text", () => {
    const { root, host } = build(
      `<p>a <a href="#" data-test="gone" style="visibility: hidden">gone</a> <a href="#" data-test="kept">kept</a></p>`,
    );
    const elements = focusableRects(root).map((entry) => entry.element);
    expect(elements).not.toContain(host.querySelector('[data-test="gone"]'));
    expect(elements).toContain(host.querySelector('[data-test="kept"]'));
  });
});

describe("the copy", () => {
  const copyAll = (html: string): string => {
    const { root, host } = build(html);
    const target = host.firstElementChild!;
    return serializeSelection(root, {
      startContainer: target,
      startOffset: 0,
      endContainer: target,
      endOffset: target.childNodes.length,
    });
  };

  it("drops a hidden block's own breaks, as the browsers' innerText does", () => {
    expect(copyAll(`<div>a<p style="visibility: hidden">x</p>b</div>`)).toBe("ab");
    expect(
      copyAll(
        `<div>a<div style="visibility: hidden">x<p style="visibility: visible">y</p></div>b</div>`,
      ),
    ).toBe("a\n\ny\n\nb");
  });

  it("gives an anonymous run no breaks of its own beside a hidden block", () => {
    expect(copyAll(`<div>text<div style="visibility: hidden">block</div>more</div>`)).toBe(
      "textmore",
    );
  });

  it("drops a hidden line break", () => {
    expect(
      copyAll(`<div><p>a</p><p style="visibility: hidden">x<br>y<br>z</p><p>b</p></div>`),
    ).toBe("a\n\nb");
    expect(copyAll(`<p>a<span style="visibility: hidden">x<br>y</span>b</p>`)).toBe("ab");
    // A visible line break before hidden text at the end stays.
    expect(
      copyAll(
        `<div><p>line<br><span style="visibility: hidden">secret</span></p><p>next</p></div>`,
      ),
    ).toBe("line\n\n\nnext");
  });

  it("gives a hidden or collapsed row no newline, a hidden cell no tab", () => {
    expect(
      copyAll(
        `<table><tr><td>r1</td></tr><tr style="visibility: collapse"><td>r2</td></tr><tr><td>r3</td></tr></table>`,
      ),
    ).toBe("r1\nr3");
    // innerText puts a visible cell's tab after it: the hidden cell's
    // visible text runs into the next.
    expect(
      copyAll(
        `<table><tr><td>A</td><td style="visibility: hidden"><span style="visibility: visible">b</span></td><td>C</td></tr></table>`,
      ),
    ).toBe("A\tbC");
  });

  it("leaves hidden text out, a visible descendant's in", () => {
    expect(copyAll(`<div><p>one</p><p style="visibility: hidden">two</p><p>three</p></div>`)).toBe(
      "one\n\nthree",
    );
    expect(
      copyAll(`<p>a <span style="visibility: hidden">secret</span> b <span>c</span></p>`),
    ).toBe("a  b c");
    expect(
      copyAll(
        `<div style="visibility: hidden"><p>gone</p><p style="visibility: visible">back</p></div>`,
      ),
    ).toBe("back");
  });
});
