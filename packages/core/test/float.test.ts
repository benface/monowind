import { describe, expect, it, vi } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { buildTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

/** Floats (specs/float.md): exclusions a block container's leaves wrap
 * around, containers step aside from, and `clear` moves below — laid
 * out and painted in 4px cells (16px root, 0.25rem = 1 cell). */

function build(html: string, cols = 40): { host: HTMLElement; root: LayoutNode } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const root = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(root, cols);
  return { host, root };
}

const rows = (root: LayoutNode): string[] => renderPlainText(root).split("\n");
const rect = (node: LayoutNode) => node.localRect;
const bands = (leaf: LayoutNode) => leaf.lineBands!.map(({ row, x, width }) => [row, x, width]);

const WORDS =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen";

describe("float placement", () => {
  it("floats a box to the left edge, shrink-to-fit, and the leaf beside it wraps around", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 24px; height: 12px; margin-right: 4px">F</div>
        <p>${WORDS}</p>
      </div>`,
    );
    const [float, p] = root.children;
    expect(rect(float!)).toEqual({ x: 0, y: 0, width: 6, height: 3 });
    expect(rect(p!)).toEqual({ x: 0, y: 0, width: 40, height: 4 });
    // Three lines beside the float's margin box, the fourth full width.
    expect(bands(p!)).toEqual([
      [0, 7, 33],
      [1, 7, 33],
      [2, 7, 33],
      [3, 0, 40],
    ]);
    expect(rows(root)).toEqual([
      "F      one two three four five six seven",
      "       eight nine ten eleven twelve",
      "       thirteen fourteen fifteen sixteen",
      "seventeen eighteen",
    ]);
    // The container contains its float.
    expect(rect(root).height).toBe(4);
  });

  it("floats to the right edge, the lines ending before it", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: right; width: 24px; height: 8px; margin-left: 4px">R</div>
        <p>${WORDS}</p>
      </div>`,
    );
    const [float, p] = root.children;
    expect(rect(float!)).toEqual({ x: 34, y: 0, width: 6, height: 2 });
    expect(bands(p!).slice(0, 3)).toEqual([
      [0, 0, 33],
      [1, 0, 33],
      [2, 0, 40],
    ]);
    expect(rows(root)[0]).toBe("one two three four five six seven R");
  });

  it("sizes a float explicitly, and grows the container to the taller of cursor and floats", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 40px; height: 40px"></div>
        <p>short</p>
      </div>`,
    );
    expect(rect(root.children[0]!)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(rect(root)).toMatchObject({ height: 10 });
  });

  it("puts a second float beside the first when it fits, below it when not", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 24px; height: 8px"></div>
        <div style="float: left; width: 16px; height: 12px"></div>
        <div style="float: left; width: 120px; height: 4px"></div>
        <div style="float: left; width: 140px; height: 4px"></div>
      </div>`,
    );
    expect(root.children.map(rect)).toEqual([
      { x: 0, y: 0, width: 6, height: 2 },
      { x: 6, y: 0, width: 4, height: 3 },
      // 30 wide: 30 cells remain beside both; 35 fits only below the second.
      { x: 10, y: 0, width: 30, height: 1 },
      { x: 0, y: 3, width: 35, height: 1 },
    ]);
    expect(rect(root).height).toBe(4);
  });

  it("starts a float at the cursor of its DOM slot, never above an earlier float", () => {
    const { root } = build(
      `<div style="width: 160px">
        <p>alpha</p>
        <div style="float: right; width: 8px; height: 4px"></div>
        <div style="float: left; width: 8px; height: 4px; margin-top: 4px"></div>
        <p>beta</p>
      </div>`,
    );
    const [, right, left, beta] = root.children;
    expect(rect(right!)).toMatchObject({ x: 38, y: 1 });
    // Its top margin is its own: the margin box starts at the cursor.
    expect(rect(left!)).toMatchObject({ x: 0, y: 2 });
    expect(rect(beta!)).toMatchObject({ y: 1 });
    // Its margin box is the exclusion: the top-margin row shortens beta.
    expect(bands(beta!)).toEqual([[0, 2, 36]]);
  });
});

describe("lines beside floats", () => {
  it("opens a line at the first row with a free cell: a full-width float shifts it down", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 160px; height: 8px"></div>
        <p>a b</p>
      </div>`,
    );
    const p = root.children[1]!;
    expect(rect(p)).toEqual({ x: 0, y: 0, width: 40, height: 3 });
    expect(bands(p)).toEqual([[2, 0, 40]]);
    expect(rows(root)).toEqual(["", "", "a b"]);
  });

  it("counts a taller line's rows when opening the next one", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 24px; height: 16px; margin-right: 4px"></div>
        <p>aa <span style="display: inline-block; width: 4px; height: 8px"></span> bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx yy zz</p>
      </div>`,
    );
    const p = root.children[1]!;
    // The box makes line 0 two rows tall; line 1 opens on row 2.
    expect(bands(p)).toEqual([
      [0, 7, 33],
      [2, 7, 33],
      [3, 7, 33],
    ]);
    expect(rect(p).height).toBe(4);
  });

  it("opens every line when the text ends on a box wider than its band", () => {
    const { root } = build(
      `<div style="width: 40px">
        <div style="float: left; width: 32px; height: 16px"></div>
        <p>ab <span style="display: inline-block; width: 20px">xyz</span></p>
      </div>`,
    );
    const p = root.children[1]!;
    expect(bands(p)).toEqual([
      [0, 8, 2],
      [1, 8, 2],
    ]);
    expect(rect(p).height).toBe(2);
  });

  it("aligns a line within its band; a truncating leaf is a root and steps aside", () => {
    const { root } = build(
      `<div style="width: 80px">
        <div style="float: left; width: 28px; height: 8px"></div>
        <p style="text-align: right">ab</p>
        <p style="width: 52px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">abcdefghijklmnopqrstuvwxyz</p>
      </div>`,
    );
    expect(rows(root)).toEqual(["                  ab", "       abcdefghijkl…"]);
  });

  it("keeps an unbreakable line on its row, overflowing the band as browsers do", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 8px"></div>
        <p style="white-space: nowrap">short<br>a line of thirty-four characters!!</p>
      </div>`,
    );
    const p = root.children[1]!;
    expect(bands(p)).toEqual([
      [0, 7, 33],
      [1, 7, 33],
    ]);
    expect(rows(root)[1]!.indexOf("a line")).toBe(7);
  });

  it("centers a leaf with auto margins in the container, its lines still shortened", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 48px; height: 8px"></div>
        <p style="width: 80px; margin: 0 auto">${WORDS}</p>
      </div>`,
    );
    const p = root.children[1]!;
    // Centered in the 40 cells, not in the band; the float reaches two
    // cells into it on its rows.
    expect(rect(p!)).toMatchObject({ x: 10, y: 0, width: 20 });
    expect(bands(p!).slice(0, 3)).toEqual([
      [0, 2, 18],
      [1, 2, 18],
      [2, 0, 20],
    ]);
    expect(rows(root)[0]!.indexOf("one")).toBe(12);
  });

  it("wraps a leaf's own text run inside a bordered leaf, which passes under the float", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 8px; height: 12px">F</div>
        <p style="border: 1px solid">abc</p>
      </div>`,
    );
    const p = root.children[1]!;
    expect(rect(p)).toEqual({ x: 0, y: 0, width: 40, height: 3 });
    // The band clipped to the leaf's content box, in its own cells.
    expect(bands(p)).toEqual([[0, 1, 37]]);
    // The float paints after the block it sits over (CSS Appendix E).
    const [top, middle] = rows(root);
    expect(top!.startsWith("F")).toBe(true);
    expect(top!.endsWith("┐")).toBe(true);
    expect(middle).toBe("│ abc" + " ".repeat(34) + "│");
  });

  it("re-wraps around the float inside a paragraph, the text an anonymous run", () => {
    const { root } = build(
      `<div style="width: 160px">
        <p><span style="float: left; width: 8px; height: 8px">A</span>${WORDS}</p>
      </div>`,
    );
    const p = root.children[0]!;
    const [float, run] = p.children;
    expect(float!.style.float).toBe("left");
    expect(run!.anonymous).toBe(true);
    expect(bands(run!).slice(0, 3)).toEqual([
      [0, 2, 38],
      [1, 2, 38],
      [2, 0, 40],
    ]);
    expect(rows(root)[0]).toBe("A one two three four five six seven");
  });
});

describe("roots beside floats", () => {
  it("places a container beside the float when its margin box fits the band, an auto width taking the band, below when not", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 12px"></div>
        <div style="width: 80px"><p>x</p></div>
        <div><p>y</p></div>
        <div style="width: 160px"><p>z</p></div>
      </div>`,
    );
    const [, beside, shrunk, below] = root.children;
    expect(rect(beside!)).toEqual({ x: 7, y: 0, width: 20, height: 1 });
    expect(rect(shrunk!)).toEqual({ x: 7, y: 1, width: 33, height: 1 });
    expect(rect(below!)).toEqual({ x: 0, y: 3, width: 40, height: 1 });
    // Native margins: the ones beside measured from the band's edge.
    expect(beside!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(shrunk!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(below!.flow).toEqual({ top: 1, right: 0, bottom: 0, left: 0 });
    expect(rect(root).height).toBe(4);
  });

  it("steps a leaf CSS makes a root aside too: a scroll container, a flex box of text", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 8px"></div>
        <p style="overflow: auto">x</p>
        <div style="display: flex">y</div>
      </div>`,
    );
    expect(rect(root.children[1]!)).toMatchObject({ x: 7, y: 0, width: 33 });
    expect(rect(root.children[2]!)).toMatchObject({ x: 7, y: 1, width: 33 });
  });

  it("places a root at its own top beside the first float when an earlier float sits lower", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 8px"></div>
        <div style="float: left; width: 140px; height: 4px"></div>
        <div style="width: 40px"><p>c</p></div>
      </div>`,
    );
    // The second float, too wide for the band, dropped below the first.
    expect(rect(root.children[1]!)).toMatchObject({ x: 0, y: 2 });
    expect(rect(root.children[2]!)).toEqual({ x: 7, y: 0, width: 10, height: 1 });
  });

  it("narrows a root again when a float lower down narrows the band over its height", () => {
    const pairs = Array.from({ length: 48 }, (_, i) =>
      String.fromCharCode(97 + (i % 26)).repeat(2),
    );
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 16px"></div>
        <div style="float: left; width: 136px; height: 8px"></div>
        <div><p>${pairs.join(" ")}</p></div>
      </div>`,
    );
    // 33 cells wide the text runs five rows into the lower float's
    // rows; the 6 cells past it hold the pairs two per line.
    expect(rect(root.children[2]!)).toEqual({ x: 34, y: 0, width: 6, height: 24 });
  });

  it("honors a top margin before stepping aside, and auto margins within the band", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 12px"></div>
        <div style="width: 40px; margin-top: 4px"><p>x</p></div>
        <div style="width: 40px; margin: 0 auto"><p>y</p></div>
      </div>`,
    );
    const [, first, centered] = root.children;
    expect(rect(first!)).toMatchObject({ x: 7, y: 1 });
    // Centered in the 33 cells beside the float: floor((33 - 10) / 2).
    expect(rect(centered!)).toMatchObject({ x: 7 + 11, y: 2 });
    expect(centered!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 11 });
  });
});

describe("native flow", () => {
  it("gives a float the top margin that puts it at its row after a sibling's bottom margin", () => {
    const { root } = build(
      `<div style="width: 160px">
        <p style="margin-bottom: 4px">a</p>
        <div style="float: left; width: 28px; height: 4px; margin-left: 4px"></div>
        <p>b</p>
      </div>`,
    );
    const [a, float, b] = root.children;
    // The float sits past the paragraph's bottom margin, as browsers
    // place one; natively the paragraph carries that margin, the float
    // its own, and the next paragraph's collapses with it.
    expect(rect(float!)).toMatchObject({ x: 1, y: 2 });
    expect(a!.flow?.bottom).toBe(1);
    expect(float!.flow).toEqual({ top: 0, right: 0, bottom: 0, left: 1 });
    expect(b!.flow?.top).toBe(1);
  });

  it("lets the float absorb what a run after it leaves of the margin the child before carries", () => {
    const { root } = build(
      `<div style="width: 160px">
        <p style="margin-bottom: 4px">a</p>
        <div style="float: left; width: 28px; height: 4px"></div>
        text
      </div>`,
    );
    const [a, float, run] = root.children;
    expect(rect(float!).y).toBe(2);
    expect(rect(run!).y).toBe(2);
    expect(a!.flow?.bottom).toBe(1);
    expect(float!.flow?.top).toBe(0);
  });

  it("lets the float absorb a negative pending margin, the child before carrying none", () => {
    const { root } = build(
      `<div style="width: 160px">
        <p style="margin-bottom: -4px">a</p>
        <div style="float: left; width: 28px; height: 4px"></div>
        <p>b</p>
      </div>`,
    );
    const [a, float, b] = root.children;
    expect(rect(float!).y).toBe(0);
    expect(rect(b!).y).toBe(0);
    expect(a!.flow?.bottom).toBe(0);
    expect(float!.flow?.top).toBe(-1);
    expect(b!.flow?.top).toBe(-1);
  });
});

describe("clear", () => {
  it("moves a block below the named floats, and a float below earlier ones", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 12px"></div>
        <div style="float: right; width: 28px; height: 4px"></div>
        <p style="clear: right">a</p>
        <p style="clear: left">b</p>
        <div style="float: left; clear: both; width: 28px; height: 4px"></div>
        <p>c</p>
      </div>`,
    );
    const [, , a, b, cleared, c] = root.children;
    expect(rect(a!).y).toBe(1);
    expect(rect(b!).y).toBe(3);
    expect(rect(cleared!)).toMatchObject({ x: 0, y: 4 });
    expect(bands(c!)).toEqual([[0, 7, 33]]);
    expect(rect(c!).y).toBe(4);
  });

  it("leaves a block whose hypothetical top is already below the floats where it was", () => {
    const { root } = build(
      `<div style="width: 160px">
        <div style="float: left; width: 28px; height: 4px"></div>
        <p style="margin-top: 8px; clear: left">a</p>
      </div>`,
    );
    expect(rect(root.children[1]!).y).toBe(2);
  });
});

describe("where float does not apply", () => {
  it("ignores float on flex items", () => {
    const { root } = build(
      `<div style="display: flex; width: 80px">
        <div style="float: left">a</div>
        <div>b</div>
      </div>`,
    );
    expect(root.children.map((child) => rect(child).x)).toEqual([0, 1]);
  });

  it("floats inside a multicol container's child, and ignores one directly in it", () => {
    const { root } = build(
      `<div style="column-count: 2; width: 160px">
        <p><span style="float: left; width: 8px">F</span>abc def</p>
        <p>ghi</p>
      </div>`,
    );
    const p = root.children[0]!;
    expect(bands(p.children[1]!)).toEqual([[0, 2, 16]]);
    expect(rows(root)[0]!.startsWith("F abc def")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const direct = build(
        `<div style="column-count: 2; width: 160px">
          <p style="float: left">F</p>
          <p>x</p>
        </div>`,
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(direct.root.children.map((child) => rect(child).y)).toEqual([0, 0]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("intrinsic widths", () => {
  it("sums a float with the text beside it for max-content, takes the widest for min", () => {
    const { root } = build(
      `<div class="w-max">
        <div style="float: left; width: 12px">F</div>
        <p>abcd ef</p>
      </div>`,
    );
    expect(rect(root).width).toBe(3 + 7);
    // A cleared child starts a new line: its width counts on its own.
    const cleared = build(
      `<div class="w-max">
        <div style="float: left; width: 12px">F</div>
        <p>abcd ef</p>
        <p style="clear: both">abcdefghi</p>
      </div>`,
    );
    expect(rect(cleared.root).width).toBe(10);
    const min = build(
      `<div class="w-min">
        <div style="float: left; width: 12px">F</div>
        <p>abcd ef</p>
      </div>`,
    );
    expect(rect(min.root).width).toBe(4);
  });
});
