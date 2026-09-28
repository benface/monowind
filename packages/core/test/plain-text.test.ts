import { describe, expect, expectTypeOf, it } from "vitest";
import { INITIAL_GLYPH } from "../src/types.ts";
import {
  applyCellPaint,
  charIndexAtCell,
  inlineElementRects,
  isBarePaint,
  PAINT_FIELDS,
  renderGridRows,
  renderPlainText,
  renderCellSegments,
  samePaint,
} from "../src/plain-text.ts";
import { collectBorderRuns } from "../src/borders.ts";
import type { BorderRun } from "../src/borders.ts";
import { parseColor } from "../src/color.ts";
import { layoutRoot } from "../src/layout.ts";
import { placePainted } from "../src/paint-origin.ts";
import { buildTree } from "../src/tree.ts";
import { clusterAdvances } from "../src/width.ts";
import { INLINE_PAD, wrapLines } from "../src/wrap.ts";
import { cells, layered, makeNode, scrollBox, UNDERLINE } from "./helpers.ts";
import type { CellPaint, CellSegment } from "../src/plain-text.ts";
import type { BackgroundClip, CellStyle, GlyphValues, LayoutNode } from "../src/types.ts";

/**
 * Golden-output tests: lay out a tree, render it as ASCII art, compare to
 * the expected drawing. These cover layout + border painting + text
 * placement end-to-end, deterministically, with no DOM or fonts involved.
 */

function plainText(root: LayoutNode, availableWidth: number): string {
  layoutRoot(root, availableWidth);
  return renderPlainText(root);
}

describe("the paint fields", () => {
  it("are CellPaint's, samePaint and isBarePaint reading each", () => {
    expectTypeOf<(typeof PAINT_FIELDS)[number]>().toEqualTypeOf<keyof CellPaint>();
    const values: Required<CellPaint> = {
      color: "rgb(0 0 0)",
      backgroundColor: "rgb(0 0 0)",
      opacity: 0.5,
      emojiOpacity: 0.5,
      gradient: "fill",
      backgrounds: ["rgb(0 0 0)"],
      colors: ["rgb(0 0 0)"],
      glyph: { "font-weight": "700" },
      decoration: UNDERLINE,
      selected: true,
    };
    const read = PAINT_FIELDS.filter((field) => {
      const paint = { [field]: values[field] };
      return !samePaint(paint, {}) && !isBarePaint(paint);
    });
    expect(read).toEqual([...PAINT_FIELDS]);
  });
});

describe("visible overflow", () => {
  it("paints past the host's in-flow rows, under what follows", () => {
    const tall = makeNode({ style: { height: { kind: "cells", value: 2 } }, text: "aa bb cc dd" });
    const next = makeNode({ text: "xy" });
    const root = makeNode({ children: [tall, next] });
    // Two in-flow rows for the host; four rows of ink on the grid, with
    // the sibling painting over the overflow (CSS paint order).
    expect(layoutRoot(root, 2).height).toBe(3);
    expect(renderPlainText(root).split("\n")).toEqual(["aa", "bb", "xy", "dd"]);
  });
});

describe("renderPlainText golden outputs", () => {
  it("renders the motivating example: bordered flex row, justify-between, items-center", () => {
    const container = makeNode({
      style: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: 5,
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      },
      children: [makeNode({ text: "left text" }), makeNode({ text: "right" })],
    });
    const root = makeNode({ children: [container] });

    expect(plainText(root, 40)).toBe(
      [
        `┌${"─".repeat(38)}┐`,
        `│${" ".repeat(38)}│`,
        `│ left text${" ".repeat(22)}right ${" ".repeat(0)}│`,
        `│${" ".repeat(38)}│`,
        `└${"─".repeat(38)}┘`,
      ].join("\n"),
    );
  });

  it("renders truncated nowrap text with an ellipsis in the last cell", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
        whiteSpace: "nowrap",
        overflow: { x: "hidden", y: "hidden" },
        textOverflow: "ellipsis",
      },
      text: "hello wonderful world",
    });
    const root = makeNode({ children: [box] });

    // Inner content width 8: "hello wonderful world" → "hello w…", one row.
    expect(plainText(root, 12)).toBe(["┌──────────┐", "│ hello w… │", "└──────────┘"].join("\n"));
  });

  it("shows a soft hyphen where its line breaks, and nothing where it does not", () => {
    const text = (width: number) => {
      const leaf = makeNode({ text: "hyphen\u00adation" });
      leaf.advances = clusterAdvances(leaf.text);
      return plainText(makeNode({ children: [leaf] }), width);
    };
    expect(text(7)).toBe(["hyphen-", "ation"].join("\n"));
    // Unbroken, it stays in the text unseen, as in the DOM.
    expect(text(20)).toBe("hyphen\u00ADation");
  });

  it("balances a short paragraph's lines, and keeps a pretty one's last from one word", () => {
    const wrapped = (textWrapStyle: CellStyle["textWrapStyle"]) =>
      plainText(
        makeNode({
          children: [makeNode({ style: { textWrapStyle }, text: "aaa bbb ccc ddd eee" })],
        }),
        16,
      );
    expect(wrapped("auto")).toBe(["aaa bbb ccc ddd", "eee"].join("\n"));
    // The narrowest width keeping two lines: 11 cells.
    expect(wrapped("balance")).toBe(["aaa bbb ccc", "ddd eee"].join("\n"));
    expect(wrapped("pretty")).toBe(["aaa bbb ccc", "ddd eee"].join("\n"));
    // No narrower than its longest word, which stays whole.
    const balanced = plainText(
      makeNode({
        children: [
          makeNode({ style: { textWrapStyle: "balance" }, text: "internationalization is hard" }),
        ],
      }),
      24,
    );
    expect(balanced).toBe(["internationalization", "is hard"].join("\n"));
  });

  it("justifies each line but a paragraph's last, each word at the nearest cell", () => {
    const justified = (text: string) =>
      plainText(makeNode({ children: [makeNode({ style: { textAlign: "justify" }, text })] }), 12);
    // A cell over three gaps: the words a third, two thirds and a whole
    // cell on, rounded; two cells: two thirds, four thirds and two.
    expect(justified("aa bb cc dd ee f gg hh ii")).toBe(
      ["aa bb  cc dd", "ee  f gg  hh", "ii"].join("\n"),
    );
    // A half rounds up: the first of two gaps takes the one cell.
    expect(justified("aaaa bb ccc dd")).toBe(["aaaa  bb ccc", "dd"].join("\n"));
    // A line before a hard break ends its paragraph.
    expect(justified("aa bb cc dd ee\nff gg")).toBe(["aa bb  cc dd", "ee", "ff gg"].join("\n"));
  });

  it("cuts a clamped leaf's lines at the clamp, the last ending in an ellipsis", () => {
    const clamped = (text: string) => {
      const box = makeNode({
        style: { lineClamp: 2, overflow: { x: "hidden", y: "hidden" } },
        text,
      });
      const root = makeNode({ children: [box, makeNode({ text: "after" })] });
      return plainText(root, 8);
    };
    // Three lines under the clamp of two: the second's end gives way to `…`.
    expect(clamped("aaaa bbbbbbb cc")).toBe(["aaaa", "bbbbbbb…", "after"].join("\n"));
    expect(clamped("aaaa bb cc dd ee ff")).toBe(["aaaa bb", "cc dd e…", "after"].join("\n"));
    // Two lines fit: nothing cut, no ellipsis.
    expect(clamped("aaaa bb")).toBe(["aaaa bb", "after"].join("\n"));
  });

  it("fills the cells a justified gap gains with its element's background", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div><p style="width: 48px; text-align: justify"><span style="background: red">aa bb cc dd</span> ee</p></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 20);
    const row = renderCellSegments(node)[0]!;
    const red = row.filter((segment) => segment.backgroundColor !== undefined);
    // One run of red from `aa` to `dd`, its gaps' extra cells included.
    expect(red.map((segment) => segment.text)).toEqual(["aa bb  cc dd"]);
  });

  it("places a clamped line as the text it keeps and its ellipsis", () => {
    const clamped = (text: string, style: Partial<CellStyle> = {}) => {
      const box = makeNode({
        style: { lineClamp: 1, overflow: { x: "hidden", y: "hidden" }, ...style },
        text,
      });
      return plainText(makeNode({ children: [box] }), 8);
    };
    expect(clamped("abc defghijkl", { textAlign: "end" })).toBe("    abc…");
    // Unspread, where its paragraph goes on.
    expect(clamped("aa bb cc dd ee", { textAlign: "justify" })).toBe("aa bb c…");
    // A soft hyphen it breaks at gives way to the ellipsis.
    expect(clamped("hyphena\u00adtion more")).toBe("hyphena…");
  });

  it("renders clipped nowrap text without an ellipsis when text-overflow is clip", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        whiteSpace: "nowrap",
        overflow: { x: "hidden", y: "hidden" },
      },
      text: "hello world",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 8)).toBe(["┌──────┐", "│hello │", "└──────┘"].join("\n"));
  });

  it("renders wrapped text inside a padded border", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      },
      text: "hello world",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 12)).toBe(
      ["┌──────────┐", "│ hello    │", "│ world    │", "└──────────┘"].join("\n"),
    );
  });

  it("renders a two-cell double border as concentric rings", () => {
    const box = makeNode({
      style: {
        border: { top: 2, right: 2, bottom: 2, left: 2 },
        borderStyle: { top: "double", right: "double", bottom: "double", left: "double" },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 10)).toBe(
      ["╔════════╗", "║╔══════╗║", "║║hi    ║║", "║╚══════╝║", "╚════════╝"].join("\n"),
    );
  });

  it("renders a 2px edge heavy, a corner between weights mixed", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderWeight: { top: 2, right: 1, bottom: 1, left: 1 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 6)).toBe(["┍━━━━┑", "│hi  │", "└────┘"].join("\n"));
  });

  it("draws cp437's heavy band double, its corners mixed", () => {
    const box = makeNode({
      style: {
        glyphSet: "cp437",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderWeight: { top: 2, right: 1, bottom: 1, left: 1 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 6)).toBe(["╒════╕", "│hi  │", "└────┘"].join("\n"));
  });

  it("joins a double edge to single sides with Unicode's mixed corners", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderStyle: { top: "double", right: "solid", bottom: "solid", left: "solid" },
        borderWeight: { top: 2, right: 1, bottom: 1, left: 1 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 6)).toBe(["╒════╕", "│hi  │", "└────┘"].join("\n"));
  });

  it("keeps a rounded corner's arc where its arms draw unlike lines", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderStyle: { top: "double", right: "solid", bottom: "solid", left: "solid" },
        borderRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 6)).toBe(["╭════╮", "│hi  │", "╰────╯"].join("\n"));
  });

  it("renders per-side border styles, their corners by each side's line", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderStyle: { top: "double", right: "solid", bottom: "dashed", left: "solid" },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    // Top edge double, bottom dashed, sides solid: a double side meets a
    // single one at a mixed corner, dashed and solid at a light one.
    expect(plainText(root, 6)).toBe(["╒════╕", "│hi  │", "└╌╌╌╌┘"].join("\n"));
  });

  it("emits per-side border colors on the runs", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderColor: { top: "cyan", right: "gray", bottom: "magenta", left: "gray" },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 6);
    const runs: BorderRun[] = [];
    collectBorderRuns(box.style, box.localRect, runs);
    const colorAt = (glyph: string) => runs.filter((r) => r.glyph === glyph).map((r) => r.color);
    expect(colorAt("─")).toEqual(["cyan", "magenta"]);
    expect(new Set(colorAt("│"))).toEqual(new Set(["gray"]));
    // Corner color follows the horizontal edge.
    expect(colorAt("┌")).toEqual(["cyan"]);
    expect(colorAt("└")).toEqual(["magenta"]);
  });

  it("renders an absolute badge overlapping its relative container's corner", () => {
    const badge = makeNode({
      text: "★",
      style: {
        position: "absolute",
        insets: { top: -1, right: -1, bottom: null, left: null },
      },
    });
    const box = makeNode({
      style: {
        position: "relative",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      },
      text: "",
      children: [makeNode({ text: "hi" }), badge],
    });
    const root = makeNode({ children: [box] });

    // Badge hangs one cell outside the top-right corner; the root grid clips
    // the part that exceeds it — here it lands exactly on the corner cell.
    expect(plainText(root, 8)).toBe(["┌──────★", "│ hi   │", "└──────┘"].join("\n"));
  });

  it("renders tracked text with gap cells and leading with gap rows", () => {
    const leaf = makeNode({ text: "ab cd", intrinsicWidth: 9, style: { lineGap: 1 } });
    leaf.advances = [2, 2, 1, 2, 2];
    const box = makeNode({ style: { maxWidth: 6 }, children: [leaf] });
    const root = makeNode({ children: [box] });

    expect(plainText(root, 6)).toBe(["a b", "", "c d"].join("\n"));
  });

  it("renders a flex column with gap", () => {
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", gapY: 1 },
      children: [makeNode({ text: "one" }), makeNode({ text: "two" })],
    });
    const root = makeNode({ children: [container] });

    expect(plainText(root, 10)).toBe(["one", "", "two"].join("\n"));
  });

  it("renders hard line breaks", () => {
    const leaf = makeNode({ text: "a\nbb" });
    const root = makeNode({ children: [leaf] });

    expect(plainText(root, 5)).toBe(["a", "bb"].join("\n"));
  });
});

describe("wrapLines", () => {
  it("returns line strings matching wrapLineCount semantics", () => {
    expect(wrapLines("hello world", 8)).toEqual(["hello", "world"]);
    expect(wrapLines("hello world", 11)).toEqual(["hello world"]);
    expect(wrapLines("aaaaaaaaaa", 4)).toEqual(["aaaa", "aaaa", "aa"]);
    expect(wrapLines("a\n\nb", 10)).toEqual(["a", "", "b"]);
    expect(wrapLines("", 10)).toEqual([]);
    expect(wrapLines("   ", 10)).toEqual([]);
  });

  it("breaks after hyphens like the browser, except word-initial runs", () => {
    expect(wrapLines("mx-auto", 6)).toEqual(["mx-", "auto"]);
    expect(wrapLines("mx-auto", 7)).toEqual(["mx-auto"]);
    // Hyphen segment fills the current line when it fits.
    expect(wrapLines("aa mx-auto", 6)).toEqual(["aa mx-", "auto"]);
    // Digits don't suppress the break (Chromium/WebKit; not full UAX #14).
    expect(wrapLines("2026-08", 6)).toEqual(["2026-", "08"]);
    // A word-initial hyphen run glues to what follows (UAX #14 LB20a).
    expect(wrapLines("-top-1", 5)).toEqual(["-top-", "1"]);
    expect(wrapLines("-5 plus", 4)).toEqual(["-5", "plus"]);
    // Consecutive hyphens break as one run.
    expect(wrapLines("well--known", 6)).toEqual(["well--", "known"]);
  });

  it("gives every leading <br> a line and all but the final trailing one", () => {
    // Probed, all engines: a final \n produces no last line box.
    expect(wrapLines("a\n", 5)).toEqual(["a"]);
    expect(wrapLines("a\n\n", 5)).toEqual(["a", ""]);
    expect(wrapLines("a\n\n\n", 5)).toEqual(["a", "", ""]);
    expect(wrapLines("\na", 5)).toEqual(["", "a"]);
    expect(wrapLines("\n", 5)).toEqual([""]);
    expect(wrapLines("\n\n", 5)).toEqual(["", ""]);
  });

  it("renders an NBSP-only text as one line (trim() would wrongly eat it)", () => {
    expect(wrapLines("\u00a0\u00a0", 10)).toEqual(["\u00a0\u00a0"]);
  });

  it("treats NBSP as a non-breaking, non-collapsible character", () => {
    // "10\u00a0km" is one unbreakable unit of 5 cells.
    expect(wrapLines("10\u00a0km fits", 6)).toEqual(["10\u00a0km", "fits"]);
    expect(wrapLines("a 10\u00a0km", 6)).toEqual(["a", "10\u00a0km"]);
  });
});

describe("background occludes decorations", () => {
  it("wipes ancestor decoration glyphs under a bg-colored child's border-box", () => {
    // Cyan-bordered wrapper; a red-bg badge positioned over the top-
    // border row: the badge's box fills with red spaces so the last-wins
    // per-cell rule wipes the border glyphs under it.
    const badge = makeNode({
      text: "badge",
      style: {
        position: "absolute",
        insets: { top: -1, right: null, bottom: null, left: 2 },
        backgroundColor: "red",
      },
    });
    const wrapper = makeNode({
      style: {
        position: "relative",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderColor: { top: "cyan", right: "cyan", bottom: "cyan", left: "cyan" },
        minHeight: 3,
      },
      text: "",
      children: [badge],
    });
    const root = makeNode({ children: [wrapper] });
    layoutRoot(root, 16);
    // Top border row: `badge` glyphs occupy cells 2..6 in place of
    // the `─` glyphs the ancestor painted first (the cells not covered
    // by the badge keep the cyan border).
    expect(renderPlainText(root).split("\n")[0]).toBe("┌──badge───────┐");
  });

  it("`bg-clear` wipes the same cells without a bg color", () => {
    const cutout = makeNode({
      // No text — an empty absolute box that just occludes decorations.
      text: "",
      intrinsicWidth: 3,
      intrinsicHeight: 1,
      style: {
        position: "absolute",
        insets: { top: -1, right: null, bottom: null, left: 4 },
        width: { kind: "cells", value: 3 },
        height: { kind: "cells", value: 1 },
        backgroundClear: true,
      },
    });
    const wrapper = makeNode({
      style: {
        position: "relative",
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderColor: { top: "cyan", right: "cyan", bottom: "cyan", left: "cyan" },
        minHeight: 3,
      },
      text: "",
      children: [cutout],
    });
    const root = makeNode({ children: [wrapper] });
    layoutRoot(root, 16);
    // The 3 cells under the cutout are plain spaces (no paint at all),
    // not the border's `─` glyphs.
    const topRow = renderCellSegments(root)[0]!;
    expect(topRow.map((s) => s.text).join("")).toBe("┌────   ───────┐");
    expect(topRow.find((s) => s.text === "   ")?.color).toBeUndefined();
  });
});

describe("grid paint order and dedup", () => {
  it("dedups same-cell overlap: junction tees replace border edges", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="display: flex; width: 28px; border: 1px solid; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 7);
    const art = renderPlainText(node);
    const count = (glyph: string) => (art.match(new RegExp(glyph, "g")) ?? []).length;
    expect(count("┬")).toBe(1);
    expect(count("┴")).toBe(1);
    // 5 interior top/bottom cells minus the tee cell each: no `─` cell
    // hides underneath a junction.
    expect(count("─")).toBe(8);
  });

  it("honors z-index on positioned elements: overlap row inverts to cyan", () => {
    // Without z-index the later (red) box would win the shared cells;
    // z-10 on the FIRST (relative) box flips the overlap row to cyan.
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 24px">
      <div style="border: 1px solid; border-color: cyan; z-index: 10; position: relative">a</div>
      <div style="border: 1px solid; border-color: red; margin-top: -4px">b</div>
    </div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 6);
    const colors = renderCellSegments(node)
      .flat()
      .map((seg) => seg.color);
    expect(colors.filter((c) => c === "cyan").length).toBeGreaterThan(
      colors.filter((c) => c === "red").length,
    );
  });

  it("positioned flex item (z auto) paints over later static siblings", () => {
    // The relative item in a flex column overlaps the static bg bar
    // below it; per Appendix E the positioned step paints AFTER flow
    // content, so the item's text wins over the bar's fill and text.
    const host = document.createElement("div");
    host.innerHTML = `<div style="display: flex; flex-direction: column; width: 48px">
      <div style="position: relative; top: 4px">TOP</div>
      <div style="background-color: red">bar text</div>
    </div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 3);
    const rows = renderCellSegments(node);
    const barRow = rows[1]!.map((s) => s.text).join("");
    expect(barRow.startsWith("TOP")).toBe(true);
  });

  it("negative z-index paints under static siblings", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="display: flex; flex-direction: column; width: 48px">
      <div style="position: relative; top: 4px; z-index: -1">TOP</div>
      <div style="background-color: red">bar text</div>
    </div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 3);
    const rows = renderCellSegments(node);
    expect(
      rows[1]!
        .map((s) => s.text)
        .join("")
        .startsWith("bar"),
    ).toBe(true);
  });

  it("bg-clear on a positioned overlap erases the background beneath", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="display: flex; flex-direction: column; width: 48px">
      <div style="position: relative; top: 4px; --mw-bg-clear: 1">TOP</div>
      <div style="background-color: red">bar text</div>
    </div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 3);
    const rows = renderCellSegments(node);
    // The cleared item's cells carry NO background; the bar keeps red
    // only where the item does not cover it.
    const covered = rows[1]!.find((s) => s.text.startsWith("TOP"));
    expect(covered?.backgroundColor).toBeUndefined();
  });

  it("non-positioned inline paints AFTER non-positioned block, regardless of DOM order (CSS Appendix E)", () => {
    // A red block at (0,0) and a cyan inline-atomic box at (2,0),
    // in that DOM order. CSS paints inline AFTER block, so the
    // overlapping cell belongs to cyan (not red).
    const block = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderColor: { top: "red", right: "red", bottom: "red", left: "red" },
      },
      intrinsicWidth: 4,
      intrinsicHeight: 2,
    });
    block.localRect = { x: 0, y: 0, width: 4, height: 2 };
    const inline = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderColor: { top: "cyan", right: "cyan", bottom: "cyan", left: "cyan" },
      },
      intrinsicWidth: 4,
      intrinsicHeight: 2,
    });
    inline.localRect = { x: 2, y: 0, width: 4, height: 2 };
    inline.inlineBox = { top: 0, right: 0, bottom: 0, left: 0 };
    const root = makeNode({ children: [block, inline] });
    root.localRect = { x: 0, y: 0, width: 6, height: 2 };
    placePainted(root);
    const rows = renderCellSegments(root);
    // Cell (2,0) is block's top-right ┐ AND inline's top-left ┌ —
    // inline paints last, so cyan ┌ wins.
    const flatRow0 = rows[0]!.flatMap((s) => Array.from(s.text, (ch) => ({ ch, color: s.color })));
    expect(flatRow0[2]).toEqual({ ch: "┌", color: "cyan" });
  });
});

describe("inline padding rendering", () => {
  it("renders pad markers as blank cells", () => {
    const leaf = makeNode({ text: `a${INLINE_PAD}b`, intrinsicWidth: 3 });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 3);
    expect(renderPlainText(root)).toBe("a b");
  });
});

describe("renderCellSegments", () => {
  it("splits rows into same-colored runs whose text joins back to the plain render", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 24px; border: 1px solid; border-color: cyan; color: red">hi</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 6);
    const rows = renderCellSegments(node);
    expect(rows.map((row) => row.map((s) => s.text).join("")).join("\n")).toBe(
      renderPlainText(node),
    );
    expect(rows[0]![0]).toEqual({ text: "┌────┐", color: "cyan" });
    expect(rows[1]!.map((s) => [s.text, s.color])).toEqual([
      ["│", "cyan"],
      ["hi", "red"],
      ["  ", undefined],
      ["│", "cyan"],
    ]);
  });
});

describe("glyph properties on the cells", () => {
  /** The glyph styles a root in `host`'s over a leaf in `own`'s paints. */
  const glyphs = (host: Partial<GlyphValues>, own: Partial<GlyphValues>) => {
    const root = makeNode({
      style: { glyph: { ...INITIAL_GLYPH, ...host } },
      children: [makeNode({ text: "ab", style: { glyph: { ...INITIAL_GLYPH, ...own } } })],
    });
    layoutRoot(root, 4);
    return renderCellSegments(root)[0]!.map((segment) => segment.glyph);
  };

  it("carries those unlike the host's, which the grid inherits", () => {
    const bold = { "font-weight": "700", "font-style": "italic" };
    expect(glyphs(bold, {})[0]).toEqual({ "font-weight": "400", "font-style": "normal" });
    expect(glyphs({}, bold)[0]).toEqual(bold);
    expect(glyphs(bold, bold)[0]).toBeUndefined();
  });

  it("shares one style between paints alike", () => {
    const [a] = glyphs({}, { "text-shadow": "red 0px 0px 2px" });
    const [b] = glyphs({}, { "text-shadow": "red 0px 0px 2px" });
    expect(a).toBe(b);
  });

  it("forgets styles past a bound, an animation's values being endless", () => {
    const [first] = glyphs({}, { "text-shadow": "red 0px 0px 2px" });
    for (let i = 0; i < 1000; i++) glyphs({}, { "text-shadow": `blue ${i}px 0px 2px` });
    expect(glyphs({}, { "text-shadow": "red 0px 0px 2px" })[0]).not.toBe(first);
  });
});

describe("inline fidelity in segments", () => {
  it("keeps underline through an inline run's inner spaces", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 60px"><span style="text-decoration-line: underline">click me</span></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 15);
    const rows = renderCellSegments(node);
    expect(rows[0]).toEqual([
      { text: "click me", decoration: expect.objectContaining({ line: "underline" }) },
      { text: "       " },
    ]);
  });

  it("finds no cells for an inline element in a leaf without text", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 80px"><span style="position: sticky; top: 0"></span></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 20);
    expect(inlineElementRects(node, 0, 0)).toEqual([]);
    expect(charIndexAtCell(node, 0, 0, 0, 0)).toBeNull();
  });

  it("adds the decoration lines a box's in-flow ancestors propagate to its own", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<div style="width: 200px; text-decoration-line: underline">` +
      `<p>hi <span style="text-decoration-line: line-through">there <i style="color: red">you</i></span></p>` +
      `<span style="text-decoration-line: overline">split<div>block</div></span>` +
      `<div style="position: absolute; top: 40px">out</div>` +
      `</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 50);
    const lines = (text: string) =>
      renderCellSegments(node)
        .flat()
        .find((segment) => segment.text.trim() === text)?.decoration?.line;
    expect(lines("hi")).toBe("underline");
    expect(lines("there")).toBe("underline line-through");
    expect(lines("you")).toBe("underline line-through");
    expect(lines("split")).toBe("underline overline");
    expect(lines("block")).toBe("underline overline");
    expect(lines("out")).toBeUndefined();
  });

  it("draws a decoration in its style, color and thickness, a propagated one in its box's", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<div style="width: 200px"><p style="color: red; text-decoration-line: underline; text-decoration-style: wavy; text-decoration-thickness: 2px">` +
      `a <span style="color: blue">b</span> <em style="text-decoration-line: overline; text-decoration-color: green">c</em></p></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 50);
    const decoration = (text: string) =>
      renderCellSegments(node)
        .flat()
        .find((segment) => segment.text.trim() === text)?.decoration;
    const red = getComputedStyle(host.querySelector("p")!).color;
    const wavy = { line: "underline", style: "wavy", color: red, thickness: "2px" };
    expect(decoration("a")).toEqual(wavy);
    expect(decoration("b")).toEqual(wavy);
    // Stacked, the lines draw as the innermost box draws its own.
    expect(decoration("c")).toEqual({
      line: "underline overline",
      style: "solid",
      color: "green",
      thickness: "auto",
    });
  });

  it("draws the lines of inline elements a block splits as the innermost draws its own", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<div style="width: 200px"><span style="text-decoration-line: underline; text-decoration-color: red">` +
      `<a style="text-decoration-line: line-through; text-decoration-color: blue"><p>x</p></a></span></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 50);
    const x = renderCellSegments(node)
      .flat()
      .find((segment) => segment.text.trim() === "x")?.decoration;
    expect(x).toMatchObject({ line: "underline line-through", color: "blue" });
  });

  it("maps inline descendants' color/weight and relative insets per character", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="height: 8px"><div style="width: 40px">ab <b style="color: red; font-weight: 700">cd</b> <span style="position: relative; top: 4px; color: blue">ef</span></div></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 10);
    const rows = renderCellSegments(node);
    // Row 0: leaf text bare, "cd" red + bold (spaces always unstyled),
    // then the bare tail; "ef" shifted down one row by `top: 4px`,
    // keeping its color.
    expect(rows[0]!.map((s) => [s.text, s.color, s.glyph?.["font-weight"]])).toEqual([
      ["ab ", undefined, undefined],
      ["cd", "red", "700"],
      ["     ", undefined, undefined],
    ]);
    expect(rows[1]!.map((s) => [s.text, s.color])).toEqual([
      ["      ", undefined],
      ["ef", "blue"],
      ["  ", undefined],
    ]);
  });
});

describe("text-align rendering", () => {
  it("centers each line at floor(leftover / 2) cells", () => {
    const leaf = makeNode({
      text: "abcd\nab\nabc",
      intrinsicWidth: 4,
      intrinsicHeight: 3,
      style: { textAlign: "center", whiteSpace: "nowrap", width: { kind: "cells", value: 7 } },
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 7);
    // Leftovers 3, 5, 4 → offsets 1, 2, 2 (floor keeps the left bias).
    expect(renderPlainText(root)).toBe(" abcd\n  ab\n  abc");
  });
});

describe("inline element background", () => {
  it("fills the run's cells, padding included (a focus-inverted link)", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 40px">a <a href="#" style="background-color: red; color: blue; padding-left: 4px; padding-right: 4px">go</a> b</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 10);
    const rows = renderCellSegments(node);
    // "a " bare, then the link: 1 pad cell + "go" + 1 pad cell all on
    // red bg, then " b" bare to the grid's edge.
    expect(rows[0]).toEqual([
      { text: "a " },
      { text: " ", backgroundColor: "red" },
      { text: "go", color: "blue", backgroundColor: "red" },
      { text: " ", backgroundColor: "red" },
      { text: " b  " },
    ]);
  });
});

describe("bg fill at a row's end", () => {
  it("keeps trailing painted-background spaces (borderless bg boxes)", () => {
    // A borderless bg-filled box is nothing but painted spaces — the
    // segment trim must not eat them or the fill vanishes entirely.
    const filled = makeNode({
      text: "",
      intrinsicWidth: 4,
      intrinsicHeight: 2,
      style: {
        width: { kind: "cells", value: 4 },
        height: { kind: "cells", value: 2 },
        backgroundColor: "red",
      },
    });
    const root = makeNode({ children: [filled] });
    layoutRoot(root, 4);
    const rows = renderCellSegments(root);
    expect(rows[0]).toEqual([{ text: "    ", backgroundColor: "red" }]);
    expect(rows[1]).toEqual([{ text: "    ", backgroundColor: "red" }]);
  });
});

describe("background-clip on a plain color", () => {
  /** A bordered, x-padded box's background per cell, clipped as named. */
  const backgrounds = (backgroundClip: BackgroundClip): (string | undefined)[][] => {
    const box = makeNode({
      style: {
        width: { kind: "cells", value: 6 },
        height: { kind: "cells", value: 3 },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
        backgroundColor: "red",
        backgroundClip,
      },
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 6);
    return renderCellSegments(root).map((row) =>
      row.flatMap((segment) => Array.from(segment.text, () => segment.backgroundColor)),
    );
  };
  const edge = Array.from({ length: 6 }, () => undefined);

  it("fills the padding box, the border's cells left as they were", () => {
    expect(backgrounds("padding-box")).toEqual([
      edge,
      [undefined, "red", "red", "red", "red", undefined],
      edge,
    ]);
  });

  it("fills the content box, the padding's cells left as they were", () => {
    expect(backgrounds("content-box")).toEqual([
      edge,
      [undefined, undefined, "red", "red", undefined, undefined],
      edge,
    ]);
  });
});

describe("form controls (native-rendered value)", () => {
  it("leaves the leaf empty so the browser paints the value on top of the grid", () => {
    // <input>/<textarea>/<select> handle their own caret, selection,
    // and IME natively — mirroring the value into the grid would
    // double-render and mask those. The grid still paints the
    // control's borders and background around the empty leaf.
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 40px; border: 1px solid"><input value="hello" style="width: 38px"></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 10);
    const art = renderPlainText(node);
    expect(art).not.toContain("hello");
    expect(art.split("\n")[0]).toMatch(/^┌─+┐$/);
  });

  const control = (markup: string): LayoutNode => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.appendChild(host);
    return buildTree(host.firstElementChild!, 16)!;
  };

  it("input intrinsic width comes from the size attribute", () => {
    expect(control(`<input size="7">`).intrinsicWidth).toBe(7);
    expect(control(`<input>`).intrinsicWidth).toBe(20);
  });

  it("select intrinsic width is the longest option label", () => {
    const node = control(
      `<select><option>ab</option><option>abcdef</option><option>abc</option></select>`,
    );
    expect(node.intrinsicWidth).toBe(6);
  });

  it("textarea intrinsic size: cols wide, max(rows, value lines) tall", () => {
    const node = control(`<textarea cols="12" rows="3">one\ntwo</textarea>`);
    expect(node.intrinsicWidth).toBe(12);
    expect(node.intrinsicHeight).toBe(3);
    const tall = control(`<textarea cols="12" rows="1">a\nb\nc\nd</textarea>`);
    expect(tall.intrinsicHeight).toBe(4);
  });

  it("textarea wraps its value against the captured content width", () => {
    const host = document.createElement("div");
    host.innerHTML = `<textarea rows="1">alpha beta gamma</textarea>`;
    document.body.appendChild(host);
    const textarea = host.firstElementChild as HTMLTextAreaElement;
    // "alpha beta gamma" at 6 cells wraps to 3 lines; a trailing \n
    // adds its (caret) line.
    const widths = new Map([[textarea, 6]]);
    expect(buildTree(textarea, 16, undefined, widths)!.intrinsicHeight).toBe(3);
    textarea.value = "alpha beta gamma\n";
    expect(buildTree(textarea, 16, undefined, widths)!.intrinsicHeight).toBe(4);
  });

  it("textarea leading: N lines occupy N + (N − 1) × gap rows", () => {
    const host = document.createElement("div");
    host.innerHTML = `<textarea rows="1" style="line-height: 32px">a\nb</textarea>`;
    document.body.appendChild(host);
    // 32px ÷ 16px font = 2 rows per line → 2 lines + 1 gap = 3 rows.
    expect(buildTree(host.firstElementChild!, 16)!.intrinsicHeight).toBe(3);
  });
});

/** A box of `width` × `height` cells at `left`, `top` of its positioned
 * parent, painting over what the parent painted there. */
const over = (
  left: number,
  top: number,
  width: number,
  height: number,
  style: Partial<LayoutNode["style"]> = {},
  text = "",
): LayoutNode =>
  makeNode({
    style: {
      position: "absolute",
      insets: { top, right: null, bottom: null, left },
      width: cells(width),
      height: cells(height),
      ...style,
    },
    text,
  });

/** Each cell's background on row `y`. */
const backgroundsOf = (root: LayoutNode, y: number): (string | undefined)[] =>
  renderCellSegments(root)[y]!.flatMap((segment) =>
    Array.from(segment.text, () => segment.backgroundColor),
  );

/** A filled box `height` rows tall. */
const filled = (
  backgroundColor: string,
  height: number,
  style: Partial<LayoutNode["style"]> = {},
  children: LayoutNode[] = [],
): LayoutNode =>
  makeNode({ style: { backgroundColor, height: cells(height), ...style }, children });

describe('stacking contexts (specs/positioning.md "Paint order")', () => {
  it("paints a z-10 menu over the next card, its card forming no context", () => {
    const card = filled("red", 2, { position: "relative" }, [
      over(0, 1, 3, 3, { zIndex: 10, backgroundColor: "lime" }),
    ]);
    const next = filled("blue", 2, { position: "relative" });
    const root = makeNode({ children: [card, next] });
    layoutRoot(root, 6);
    expect(backgroundsOf(root, 2)).toEqual(["lime", "lime", "lime", "blue", "blue", "blue"]);
  });

  it("paints a -z-1 child under its parent's fill where the parent forms no context", () => {
    for (const position of ["static", "relative"] as const) {
      const parent = filled("red", 2, { position }, [
        over(0, 1, 2, 2, { zIndex: -1, backgroundColor: "blue" }),
      ]);
      const root = makeNode({ style: { position: "relative" }, children: [parent] });
      layoutRoot(root, 3);
      expect(backgroundsOf(root, 1), position).toEqual(["red", "red", "red"]);
      expect(backgroundsOf(root, 2)[0], position).toBe("blue");
    }
    const context = filled("red", 2, { stacking: true }, [
      over(0, 1, 2, 2, { zIndex: -1, backgroundColor: "blue" }),
    ]);
    const root = makeNode({ children: [context] });
    layoutRoot(root, 3);
    expect(backgroundsOf(root, 1)).toEqual(["blue", "blue", "red"]);
  });

  it("paints a box that forms a context over an earlier positioned box", () => {
    const relative = filled("blue", 2, {
      position: "relative",
      margin: { top: 0, right: 0, bottom: -1, left: 0 },
    });
    const isolated = filled("lime", 2, { stacking: true });
    const root = makeNode({ children: [relative, isolated] });
    layoutRoot(root, 2);
    expect(backgroundsOf(root, 1)).toEqual(["lime", "lime"]);
  });

  it("paints a fixed box over a later in-flow block", () => {
    const fixed = over(0, 0, 2, 3, { position: "fixed", backgroundColor: "lime" });
    const root = makeNode({
      children: [makeNode({ style: { height: cells(1) }, children: [fixed] }), filled("blue", 2)],
    });
    layoutRoot(root, 3);
    expect(backgroundsOf(root, 1)).toEqual(["lime", "lime", "blue"]);
  });

  it("paints a stuck heading over a later section's box", () => {
    const heading = makeNode({
      style: {
        position: "sticky",
        insets: { top: 0, right: null, bottom: null, left: null },
        backgroundColor: "lime",
      },
      text: "H",
    });
    const sections = [
      makeNode({ style: { height: cells(4) }, children: [heading] }),
      makeNode({
        style: { margin: { top: -3, right: 0, bottom: 0, left: 0 } },
        children: [filled("blue", 3)],
      }),
    ];
    const scroller = makeNode({
      style: { height: cells(3), width: cells(4), overflow: { x: "visible", y: "auto" } },
      children: sections,
    });
    const root = makeNode({ children: [scroller] });
    layoutRoot(root, 4);
    scrollBox(root, scroller, 0, 1);
    expect(renderPlainText(root).split("\n")[0]).toMatch(/^H/);
    expect(backgroundsOf(root, 0)[0]).toBe("lime");
  });
});

describe('clips along the containing-block chain (specs/positioning.md "Paint order")', () => {
  /** A relative block 8 rows tall holding a 6×3 box styled `clipper`
   * that holds `inner` and `a`, an absolute box of the block's. */
  const escaping = (
    clipper: Partial<LayoutNode["style"]>,
    a: LayoutNode,
    inner: LayoutNode[] = [],
  ) =>
    makeNode({
      style: { position: "relative", height: cells(8) },
      children: [
        makeNode({
          style: { width: cells(6), height: cells(3), ...clipper },
          children: [...inner, a],
        }),
      ],
    });
  /** A lime 3×2 absolute box on row 4, past the clipper. */
  const lime = () => over(0, 4, 3, 2, { backgroundColor: "lime" });

  it("paints an absolute box past a static clipping box between it and its containing block", () => {
    const root = escaping({ overflow: { x: "hidden", y: "hidden" } }, lime());
    layoutRoot(root, 12);
    expect(backgroundsOf(root, 4).slice(0, 3)).toEqual(["lime", "lime", "lime"]);
    // A positioned clipping box is its containing block, and clips it.
    const clipped = escaping(
      { position: "relative", overflow: { x: "hidden", y: "hidden" } },
      lime(),
    );
    layoutRoot(clipped, 12);
    expect(backgroundsOf(clipped, 4)[0]).toBeUndefined();
  });

  it("holds an absolute box still through a static scroller's scroll", () => {
    const a = lime();
    const root = escaping({ overflow: { x: "visible", y: "auto" } }, a, [filled("blue", 10)]);
    layoutRoot(root, 12);
    scrollBox(root, root.children[0]!, 0, 2);
    expect(a.paintOrigin).toEqual({ x: 0, y: 4 });
    expect(backgroundsOf(root, 4).slice(0, 3)).toEqual(["lime", "lime", "lime"]);
  });

  it("clips a box at the clips of its own chain, two escapes deep", () => {
    // `b`'s containing block is `a`: the static clipper inside `a` clips
    // neither, and `a` clips nothing.
    const b = over(0, 3, 2, 1, { backgroundColor: "lime" });
    const inner = makeNode({
      style: { width: cells(3), height: cells(2), overflow: { x: "hidden", y: "hidden" } },
      children: [b],
    });
    const a = makeNode({
      style: {
        position: "absolute",
        insets: { top: 4, right: null, bottom: null, left: 0 },
        width: cells(3),
        height: cells(2),
      },
      children: [inner],
    });
    const root = escaping({ overflow: { x: "hidden", y: "hidden" } }, a);
    layoutRoot(root, 12);
    expect(backgroundsOf(root, 7).slice(0, 2)).toEqual(["lime", "lime"]);
  });

  it("ends the chain at a layer root, whose own clip a fixed box inside it takes", () => {
    // Inside a layer, an absolute box whose containing block is above it
    // skips the static clipper there (the transcript composites layers).
    const column = (position: "absolute" | "fixed") =>
      makeNode({
        style: {
          position,
          insets: { top: 1, right: null, bottom: null, left: 0 },
          width: cells(1),
        },
        text: "a b c d",
      });
    const clipper = makeNode({
      style: { height: cells(2), overflow: { x: "hidden", y: "hidden" } },
      children: [column("absolute")],
    });
    const root = makeNode({
      children: [makeNode({ style: { layer: layered() }, children: [clipper] })],
    });
    layoutRoot(root, 4);
    expect(renderPlainText(root).split("\n").slice(1, 5)).toEqual(["a", "b", "c", "d"]);
    // A fixed box's containing block is the host, and the layer's root
    // clips it as a transformed box clips its fixed descendants.
    const clipping = makeNode({
      style: { layer: layered(), height: cells(2), overflow: { x: "hidden", y: "hidden" } },
      children: [column("fixed")],
    });
    const host = makeNode({ style: { height: cells(6) }, children: [clipping] });
    layoutRoot(host, 4);
    expect(renderPlainText(host).split("\n").slice(0, 3)).toEqual(["", "a", ""]);
  });
});

describe('inline members (specs/positioning.md "Paint order")', () => {
  /** Rows of `html` laid out 10 cells wide. */
  const rowsOf = (html: string): string[] => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 40px">${html}</div>`;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 10);
    return renderPlainText(root).split("\n");
  };
  const shifted = (style: string, text = "XY") =>
    `<p>ab <span style="position: relative; top: 4px; ${style}">${text}</span></p>`;

  it("paints a relative span over the next paragraph's text", () => {
    expect(rowsOf(`${shifted("")}<p>zzzzzz</p>`)[1]).toBe("zzzXYz");
  });

  it("orders a span among the boxes by its z-index", () => {
    const block = `<div style="position: relative">zzzzzz</div>`;
    expect(rowsOf(`${shifted("z-index: 10")}${block}`)[1]).toBe("zzzXYz");
    expect(rowsOf(`${shifted("")}${block}`)[1]).toBe("zzzzzz");
  });

  it("paints a faded span over a later block's text", () => {
    const later = `<p style="margin-top: -4px">zzzzzz</p>`;
    expect(rowsOf(`<p>ab <span style="opacity: 0.5">XY</span></p>${later}`)[0]).toBe("zzzXYz");
  });

  it("paints a span nested in a member as a member of its own, after it", () => {
    const nested = `<p>ab <span style="position: relative">X<span style="position: relative; top: 4px">Y</span></span></p>`;
    expect(rowsOf(`${nested}<p>zzzzzz</p>`).slice(0, 2)).toEqual(["ab X", "zzzzYz"]);
  });

  it("moves an inline element's descendants with its shift", () => {
    const moved = `<p>ab <span style="position: relative; top: 4px">X<b>Y</b><span style="position: relative; left: 8px">Z</span></span></p>`;
    expect(rowsOf(`${moved}<p>zzzzzzzz</p>`).slice(0, 2)).toEqual(["ab", "zzzXYzzZ"]);
  });

  it("finds a z-auto member's glyph over the leaf's own at a cell", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>abc <span style="position: relative; left: -16px">XY</span></p>`;
    document.body.appendChild(host);
    const leaf = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(leaf, 10);
    expect(renderPlainText(leaf)).toBe("XYc");
    expect(leaf.text[charIndexAtCell(leaf, 0, 0, 0, 0)!]).toBe("X");
  });

  it("paints a negative member's glyphs under the leaf's own, painted after them", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>abc <span style="position: relative; z-index: -1; left: -16px">XY</span></p>`;
    document.body.appendChild(host);
    const leaf = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(leaf, 10);
    expect(renderPlainText(leaf)).toBe("abc");
    expect(leaf.text[charIndexAtCell(leaf, 0, 0, 0, 0)!]).toBe("a");
  });
});

describe('in-flow phases (specs/positioning.md "Paint order")', () => {
  it("paints a block's overflowing text over a later block's fill", () => {
    const text = makeNode({ style: { height: cells(1) }, text: "aa bb" });
    const root = makeNode({ children: [text, filled("blue", 2)] });
    layoutRoot(root, 2);
    expect(renderPlainText(root).split("\n")).toEqual(["aa", "bb", ""]);
    expect(backgroundsOf(root, 1)).toEqual(["blue", "blue"]);
  });

  it("paints a float over a later block from another parent", () => {
    const float = filled("lime", 3, { float: "left", width: cells(2) });
    const later = filled("blue", 2, { margin: { top: -2, right: 0, bottom: 0, left: 0 } });
    const root = makeNode({ children: [makeNode({ children: [float] }), later] });
    layoutRoot(root, 4);
    expect(backgroundsOf(root, 1)).toEqual(["lime", "lime", "blue", "blue"]);
  });

  it("paints a flex item whole, as an inline block, over a later block's fill", () => {
    const item = makeNode({
      style: { width: cells(2), height: cells(1) },
      children: [filled("lime", 3)],
    });
    const flex = makeNode({ style: { display: "flex", height: cells(1) }, children: [item] });
    const root = makeNode({ children: [flex, filled("blue", 2)] });
    layoutRoot(root, 4);
    expect(backgroundsOf(root, 1)).toEqual(["lime", "lime", "blue", "blue"]);
  });

  it("paints a later block's text over a float, and the float over its fill", () => {
    const float = filled("lime", 2, { float: "left", width: cells(2) });
    const later = makeNode({
      style: { backgroundColor: "blue", margin: { top: -2, right: 0, bottom: 0, left: 0 } },
      text: "xyzw",
    });
    const root = makeNode({ children: [makeNode({ children: [float] }), later] });
    layoutRoot(root, 4);
    expect(renderPlainText(root).split("\n")[0]).toBe("xyzw");
    expect(backgroundsOf(root, 0)).toEqual(["lime", "lime", "blue", "blue"]);
  });
});

describe("translucency (specs/cell-model.md)", () => {
  it("composites a translucent background over the one beneath", () => {
    const card = makeNode({
      style: { position: "relative", backgroundColor: "rgb(30 40 60)" },
      children: [
        makeNode({ text: "    " }),
        over(0, 0, 2, 1, { backgroundColor: "rgb(255 255 255 / 0.2)" }),
      ],
    });
    layoutRoot(card, 4);
    expect(renderCellSegments(card)[0]).toEqual([
      { text: "  ", backgroundColor: "rgb(75 83 99)" },
      { text: "  ", backgroundColor: "rgb(30 40 60)" },
    ]);
  });

  it("hides the glyph beneath a translucent background, a wide cluster's whole", () => {
    const root = makeNode({
      style: { position: "relative", backgroundColor: "rgb(200 0 0)" },
      children: [
        makeNode({ text: "ab界" }),
        over(0, 0, 1, 1, { backgroundColor: "rgb(0 0 0 / 0.5)" }),
        over(3, 0, 1, 1, { backgroundColor: "rgb(0 0 0 / 0.5)" }),
      ],
    });
    layoutRoot(root, 4);
    expect(renderPlainText(root)).toBe(" b");
    const dim = "rgb(100 0 0)";
    const red = "rgb(200 0 0)";
    const backgrounds = renderCellSegments(root)[0]!.flatMap((segment) =>
      Array.from(segment.text, () => segment.backgroundColor),
    );
    expect(backgrounds).toEqual([dim, red, red, dim]);
  });

  it("composites a translucent glyph color over its cell's background, opaque", () => {
    const leaf = makeNode({
      style: { backgroundColor: "rgb(0 0 200)", color: "rgb(255 255 255 / 0.4)" },
      text: "hi",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "hi", color: "rgb(102 102 222)", backgroundColor: "rgb(0 0 200)" },
    ]);
  });

  it("keeps a translucent color no opaque background lies under, for the browser to composite", () => {
    const glyph = makeNode({ style: { color: "rgb(255 255 255 / 0.4)" }, text: "hi" });
    const fill = makeNode({
      style: { backgroundColor: "rgb(0 0 0 / 0.5)", width: cells(2), height: cells(1) },
    });
    const both = makeNode({
      style: { backgroundColor: "rgb(0 0 0 / 0.5)", color: "rgb(255 255 255 / 0.4)" },
      text: "ab",
    });
    const root = makeNode({ children: [glyph, fill, both] });
    layoutRoot(root, 2);
    const ground = { r: 0, g: 0, b: 200 / 255, a: 1 };
    expect(renderCellSegments(root, { ground })).toEqual([
      [{ text: "hi", color: "rgb(255 255 255 / 0.4)" }],
      [{ text: "  ", backgroundColor: "rgb(0 0 0 / 0.5)" }],
      [{ text: "ab", color: "rgb(255 255 255 / 0.4)", backgroundColor: "rgb(0 0 0 / 0.5)" }],
    ]);
  });

  it("swaps a selected translucent cell's colors as they show over the ground", () => {
    const leaf = makeNode({
      style: { backgroundColor: "rgb(0 0 0 / 0.5)", color: "rgb(255 255 255 / 0.4)" },
      text: "ab",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    const ground = { r: 0, g: 0, b: 200 / 255, a: 1 };
    const selection = new Map([[leaf, { start: 0, end: 1 }]]);
    expect(renderCellSegments(root, { ground, selection })[0]![0]).toEqual({
      text: "a",
      color: "rgb(102 102 162)",
      backgroundColor: "rgb(0 0 100)",
      selected: true,
    });
  });

  it("swaps a selected faded cell's own colors at its span's opacity", () => {
    const leaf = makeNode({
      style: { opacity: 0.4, backgroundColor: "rgb(0 0 255)", color: "rgb(255 255 0)" },
      text: "ab",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    const selection = new Map([[leaf, { start: 0, end: 1 }]]);
    expect(renderCellSegments(root, { selection })[0]![0]).toEqual({
      text: "a",
      color: "rgb(255 255 0)",
      backgroundColor: "rgb(0 0 255)",
      opacity: 0.4,
      selected: true,
    });
    const span = document.createElement("span");
    applyCellPaint(renderCellSegments(root, { selection })[0]![0]!, span.style);
    expect([span.style.color, span.style.backgroundColor, span.style.opacity]).toEqual([
      "rgb(0 0 255)",
      "rgb(255 255 0)",
      "0.4",
    ]);
  });

  it("clips a translucent color outside sRGB to blend it, as browsers blend on an sRGB screen", () => {
    // Tailwind's bg-yellow-400/50 over white: the browser's blue is 127.
    const leaf = makeNode({
      style: { backgroundColor: "oklch(0.852 0.199 91.936 / 0.5)" },
      text: "hi",
    });
    const root = makeNode({ style: { backgroundColor: "rgb(255 255 255)" }, children: [leaf] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "hi", backgroundColor: "rgb(254 227 128)" },
    ]);
  });

  it("tells the fit a glyph's color translucent where no opaque background lies under it", () => {
    const stem = (backgroundColor?: string) =>
      makeNode({ style: { backgroundColor, color: "rgb(0 0 0 / 0.5)" }, text: "│" });
    const faded = makeNode({ style: { opacity: 0.5, color: "rgb(0 0 0)" }, text: "│" });
    const root = makeNode({
      children: [stem("rgb(255 255 255)"), stem(), stem("rgb(0 0 0 / 0.5)"), faded],
    });
    layoutRoot(root, 1);
    const translucent: boolean[] = [];
    renderCellSegments(root, {
      boxed: (_cluster, _cells, _paint, _resampled, isTranslucent) => {
        translucent.push(isTranslucent);
        return false;
      },
    });
    expect(translucent).toEqual([false, true, true, true]);
  });

  it("keeps an opaque color's own string, a form the engine never rewrites", () => {
    const leaf = makeNode({
      style: { backgroundColor: "oklch(0.3 0.1 250)", color: "oklch(0.9 0.05 100)" },
      text: "ok",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "ok", color: "oklch(0.9 0.05 100)", backgroundColor: "oklch(0.3 0.1 250)" },
    ]);
  });
});

describe("opacity (specs/cell-model.md)", () => {
  /** Each cell of a row, as `[glyph, color, background, opacity]`. */
  const cellsOf = (row: CellSegment[]) =>
    row.flatMap((segment) =>
      Array.from(segment.text, (glyph) => [
        glyph,
        segment.color,
        segment.backgroundColor,
        segment.opacity,
      ]),
    );

  it("blends a faded box as one group: its label over its own fill, over an opaque background beneath", () => {
    const button = makeNode({
      style: {
        opacity: 0.4,
        backgroundColor: "rgb(0 0 255)",
        color: "rgb(255 255 0)",
        width: cells(3),
      },
      text: "ok",
    });
    const root = makeNode({ style: { backgroundColor: "rgb(255 255 255)" }, children: [button] });
    layoutRoot(root, 3);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "ok", color: "rgb(255 255 153)", backgroundColor: "rgb(153 153 255)" },
      { text: " ", backgroundColor: "rgb(153 153 255)" },
    ]);
  });

  it("fades a group with nothing beneath as its span's opacity, in its own colors", () => {
    const button = makeNode({
      style: {
        opacity: 0.4,
        backgroundColor: "rgb(0 0 255)",
        color: "rgb(255 255 0)",
        width: cells(3),
      },
      text: "ok",
    });
    const root = makeNode({ children: [button] });
    layoutRoot(root, 3);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "ok", color: "rgb(255 255 0)", backgroundColor: "rgb(0 0 255)", opacity: 0.4 },
      { text: " ", backgroundColor: "rgb(0 0 255)", opacity: 0.4 },
    ]);
  });

  it("composites a group over a translucent background as one color at the alpha the two reach", () => {
    const button = makeNode({
      style: {
        opacity: 0.4,
        backgroundColor: "rgb(0 0 255)",
        color: "rgb(255 255 0)",
        width: cells(3),
      },
      text: "ok",
    });
    const veil = makeNode({ style: { backgroundColor: "rgb(0 0 0 / 0.5)" }, children: [button] });
    const root = makeNode({ children: [veil] });
    layoutRoot(root, 3);
    // Blue at 0.4 over black at 0.5 reaches 0.7: 0.4 / 0.7 of blue, the
    // label likewise, both at 0.7 as the span's opacity.
    const [label, fill] = renderCellSegments(root)[0]!;
    expect(label).toEqual({
      text: "ok",
      color: "rgb(146 146 0)",
      backgroundColor: "rgb(0 0 146)",
      opacity: expect.closeTo(0.7, 9),
    });
    expect(fill).toEqual({ text: " ", backgroundColor: "rgb(0 0 146 / 0.7)" });
  });

  it("keeps a group's authored translucent color over nothing, inside its span's opacity", () => {
    const leaf = makeNode({ style: { opacity: 0.5, color: "rgb(255 255 255 / 0.4)" }, text: "hi" });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "hi", color: "rgb(255 255 255 / 0.4)", opacity: 0.5 },
    ]);
  });

  it("flattens a faded cell a later paint lands on, the later glyph unfaded", () => {
    const faded = makeNode({
      style: { opacity: 0.4, backgroundColor: "rgb(0 0 255)", width: cells(2), height: cells(1) },
    });
    const root = makeNode({
      style: { position: "relative", width: cells(2) },
      children: [faded, over(0, 0, 1, 1, { color: "rgb(0 0 0)" }, "x")],
    });
    layoutRoot(root, 2);
    expect(cellsOf(renderCellSegments(root)[0]!)).toEqual([
      ["x", "rgb(0 0 0)", "rgb(0 0 255 / 0.4)", undefined],
      [" ", undefined, "rgb(0 0 255)", 0.4],
    ]);
  });

  it("nests groups innermost first, a translucent color in one translucent within it", () => {
    const outer = makeNode({
      style: { opacity: 0.4, backgroundColor: "rgb(255 0 0)", width: cells(1) },
      children: [
        makeNode({ style: { opacity: 0.4, backgroundColor: "rgb(0 0 255)", height: cells(1) } }),
        makeNode({ style: { backgroundColor: "rgb(0 0 0 / 0.5)", height: cells(1) } }),
        makeNode({ style: { height: cells(1) } }),
      ],
    });
    const root = makeNode({ children: [outer] });
    layoutRoot(root, 1);
    expect(
      renderCellSegments(root).map((row) => [row[0]!.backgroundColor, row[0]!.opacity]),
    ).toEqual([
      ["rgb(153 0 102)", 0.4],
      ["rgb(128 0 0)", 0.4],
      ["rgb(255 0 0)", 0.4],
    ]);
  });

  it("carries a group's glyph over its own fill through the groups around it", () => {
    const outer = () =>
      makeNode({
        style: { opacity: 0.5 },
        children: [
          makeNode({
            style: {
              opacity: 0.5,
              backgroundColor: "rgb(0 0 255)",
              color: "rgb(255 255 0 / 0.5)",
              width: cells(2),
            },
            text: "ok",
          }),
        ],
      });
    const onRed = makeNode({ style: { backgroundColor: "rgb(255 0 0)" }, children: [outer()] });
    const bare = makeNode({ children: [outer()] });
    layoutRoot(onRed, 2);
    expect(renderCellSegments(onRed)[0]).toEqual([
      { text: "ok", color: "rgb(223 32 32)", backgroundColor: "rgb(191 0 64)" },
    ]);
    // With nothing beneath, the groups' opacities multiply on the span.
    layoutRoot(bare, 2);
    expect(renderCellSegments(bare)[0]).toEqual([
      { text: "ok", color: "rgb(128 128 128)", backgroundColor: "rgb(0 0 255)", opacity: 0.25 },
    ]);
  });

  it("clips a group's colors outside sRGB to blend them", () => {
    const box = makeNode({
      style: {
        opacity: 0.5,
        backgroundColor: "oklch(0.7 0.3 30)",
        color: "oklch(0.9 0.3 140)",
        width: cells(2),
      },
      text: "ok",
    });
    const root = makeNode({ style: { backgroundColor: "rgb(0 0 200)" }, children: [box] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "ok", color: "rgb(37 128 100)", backgroundColor: "rgb(128 0 100)" },
    ]);
  });

  it("blends opacity 0 into the colors beneath, its glyphs kept", () => {
    const ghost = makeNode({ style: { opacity: 0, color: "rgb(255 0 0)" }, text: "go" });
    const root = makeNode({ style: { backgroundColor: "rgb(0 0 200)" }, children: [ghost] });
    layoutRoot(root, 2);
    expect(renderPlainText(root)).toBe("go");
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "go", color: "rgb(0 0 200)", backgroundColor: "rgb(0 0 200)" },
    ]);
  });

  it("fades a fixed descendant with its group, past the clip it escapes", () => {
    const fixed = makeNode({
      style: {
        position: "fixed",
        insets: { top: 1, right: null, bottom: null, left: 0 },
        color: "rgb(0 0 0)",
      },
      text: "fx",
    });
    const faded = makeNode({
      style: {
        opacity: 0.4,
        width: cells(2),
        height: cells(1),
        overflow: { x: "hidden", y: "hidden" },
      },
      children: [fixed],
    });
    const root = makeNode({ style: { minHeight: 2 }, children: [faded] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[1]).toEqual([
      { text: "fx", color: "rgb(0 0 0)", opacity: 0.4 },
    ]);
  });

  it("wipes bg-clear through its group, the group's paint over it", () => {
    const cleared = makeNode({
      style: { opacity: 0.4, backgroundClear: true, color: "rgb(0 0 0)", width: cells(2) },
      text: "x",
    });
    const root = makeNode({
      style: { backgroundColor: "rgb(0 0 200)", width: cells(4) },
      children: [cleared],
    });
    layoutRoot(root, 4);
    expect(cellsOf(renderCellSegments(root)[0]!)).toEqual([
      ["x", "rgb(0 0 0)", undefined, 0.4],
      [" ", undefined, undefined, undefined],
      [" ", undefined, "rgb(0 0 200)", undefined],
      [" ", undefined, "rgb(0 0 200)", undefined],
    ]);
  });

  it("covers a layer closed inside a group with the group's ink walked after it alone", () => {
    const layer = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 0 },
        width: cells(4),
        layer: layered(),
      },
      text: "cd",
    });
    const after = over(2, 0, 2, 1, { backgroundColor: "rgb(0 0 0)" });
    const group = makeNode({
      style: { opacity: 0.5, position: "relative", width: cells(4) },
      children: [makeNode({ text: "ab" }), layer, after],
    });
    const root = makeNode({ children: [group] });
    layoutRoot(root, 4);
    const painted = renderGridRows(root).layers[0]!.layer;
    expect([...painted.holes]).toEqual([2, 3]);
    expect(painted.alpha).toBe(0.5);
    expect(renderPlainText(root)).toBe("cd");
  });

  it("fades a color emoji over its group's fill with nothing beneath by the span's opacity", () => {
    const leaf = makeNode({
      style: {
        opacity: 0.4,
        backgroundColor: "rgb(0 0 255)",
        color: "rgb(0 0 0)",
        width: cells(2),
      },
      text: "\u{1F600}",
      intrinsicWidth: 2,
    });
    leaf.advances = [2, 0];
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]).toEqual([
      { text: "\u{1F600}", color: "rgb(0 0 0)", backgroundColor: "rgb(0 0 255)", opacity: 0.4 },
    ]);
  });

  it("draws a color emoji at its color's alpha times its groups' opacity, over any background", () => {
    const emoji = (style: Partial<LayoutNode["style"]>) => {
      const leaf = makeNode({ style, text: "\u{1F600}", intrinsicWidth: 2 });
      leaf.advances = [2, 0];
      return leaf;
    };
    const white = "rgb(255 255 255)";
    const half = "rgb(0 0 0 / 0.5)";
    const root = makeNode({
      style: { width: cells(2) },
      children: [
        emoji({ backgroundColor: white, color: half }),
        emoji({ color: half }),
        emoji({ backgroundColor: white, color: half, opacity: 0.4 }),
        makeNode({
          style: { backgroundColor: white },
          children: [emoji({ color: half, opacity: 0.4 })],
        }),
      ],
    });
    layoutRoot(root, 2);
    const alphas = renderCellSegments(root).map((row) => {
      const segment = row.find(({ text }) => text === "\u{1F600}")!;
      return parseColor(segment.color!)!.a * (segment.opacity ?? 1) * (segment.emojiOpacity ?? 1);
    });
    expect(alphas).toEqual([0.5, 0.5, 0.2, 0.2]);
  });

  it("swaps a selected blended color emoji's color at its opacity, as its neighbors' blend", () => {
    const leaf = makeNode({
      style: { opacity: 0.4, color: "rgb(0 0 0)" },
      text: "a\u{1F600}",
      intrinsicWidth: 3,
    });
    leaf.advances = [1, 2, 0];
    const root = makeNode({ style: { backgroundColor: "rgb(255 255 255)" }, children: [leaf] });
    layoutRoot(root, 3);
    const selection = new Map([[leaf, { start: 0, end: 3 }]]);
    const swapped = renderCellSegments(root, { selection })[0]!.map((segment) => [
      segment.text,
      segment.color,
      segment.emojiOpacity,
    ]);
    expect(swapped).toEqual([
      ["a", "rgb(153 153 153)", undefined],
      ["\u{1F600}", "rgb(153 153 153)", 0.4],
    ]);
  });

  it("draws a color emoji in a layer at its groups' opacity alone, over a translucent fill", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<div style="color: rgb(0 0 0)"><p style="translate: 8px 0; background-color: rgba(255, 0, 0, 0.5)">a <span style="opacity: 0.4">\u{1F600}</span></p><div style="translate: 8px 0; background-color: rgba(255, 0, 0, 0.5)"><p style="opacity: 0.4">\u{1F600}</p></div></div>';
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 6);
    host.remove();
    const alphas = renderGridRows(root).layers.map(({ segments }) => {
      const emoji = segments.flat().find((segment) => segment.text.includes("\u{1F600}"))!;
      return parseColor(emoji.color!)!.a * (emoji.emojiOpacity ?? 1);
    });
    expect(alphas).toEqual([0.4, 0.4]);
  });

  it("leaves the cells beneath an opacity-0 box as they were, its glyphs in their colors", () => {
    const GREEN_500 = "oklch(0.723 0.219 149.579)";
    const ghost = () =>
      makeNode({
        style: {
          opacity: 0,
          backgroundColor: "rgb(255 255 255)",
          color: "rgb(255 0 0)",
          width: cells(2),
        },
        text: "go",
      });
    const green = makeNode({
      style: { backgroundColor: GREEN_500, width: cells(4) },
      children: [ghost()],
    });
    layoutRoot(green, 4);
    expect(renderCellSegments(green)[0]).toEqual([
      { text: "go", color: GREEN_500, backgroundColor: GREEN_500 },
      { text: "  ", backgroundColor: GREEN_500 },
    ]);
    // With nothing beneath, the group is its span's opacity, zero.
    const bare = makeNode({ style: { width: cells(4) }, children: [ghost()] });
    layoutRoot(bare, 4);
    expect(renderCellSegments(bare)[0]).toEqual([
      { text: "go", color: "rgb(255 0 0)", backgroundColor: "rgb(255 255 255)", opacity: 0 },
      { text: "  " },
    ]);
  });

  it("leaves no background under a glyph over an opacity-0 box's fill with nothing beneath", () => {
    const ghost = makeNode({
      style: { opacity: 0, backgroundColor: "rgb(255 255 255)", width: cells(2) },
      text: "go",
    });
    const root = makeNode({
      style: { position: "relative", width: cells(2) },
      children: [ghost, over(0, 0, 1, 1, {}, "x")],
    });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]![0]).toEqual({ text: "x" });
  });

  it("blanks a faded color emoji under a translucent fill", () => {
    const leaf = makeNode({ style: { opacity: 0.4 }, text: "\u{1F600}", intrinsicWidth: 2 });
    leaf.advances = [2, 0];
    const root = makeNode({
      style: { position: "relative", width: cells(2) },
      children: [leaf, over(1, 0, 1, 1, { backgroundColor: "rgb(0 0 0 / 0.5)" })],
    });
    layoutRoot(root, 2);
    expect(renderPlainText(root)).toBe("");
  });

  it("leaves a faded color emoji's cell a later glyph blanks at its group's color", () => {
    const leaf = makeNode({
      style: { opacity: 0.4, color: "rgb(0 0 0)", textDecoration: UNDERLINE },
      text: "\u{1F600}",
      intrinsicWidth: 2,
    });
    leaf.advances = [2, 0];
    const root = makeNode({
      style: { position: "relative", width: cells(2) },
      children: [leaf, over(1, 0, 1, 1, {}, "x")],
    });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]![0]).toEqual({
      text: " ",
      color: "rgb(0 0 0)",
      decoration: UNDERLINE,
      opacity: 0.4,
    });
  });

  it("blends the cell a later glyph blanks of a faded color emoji over a blended cell", () => {
    const leaf = makeNode({
      style: { opacity: 0.4, color: "rgb(0 0 0)", textDecoration: UNDERLINE },
      text: "\u{1F600}",
      intrinsicWidth: 2,
    });
    leaf.advances = [2, 0];
    const root = makeNode({
      style: { position: "relative", backgroundColor: "rgb(255 255 255)", width: cells(2) },
      children: [leaf, over(1, 0, 1, 1, {}, "x")],
    });
    layoutRoot(root, 2);
    expect(renderCellSegments(root)[0]![0]).toEqual({
      text: " ",
      color: "rgb(153 153 153)",
      backgroundColor: "rgb(255 255 255)",
      decoration: UNDERLINE,
    });
  });

  it("fades a lab() color in its group", () => {
    const leaf = makeNode({ style: { opacity: 0.5, color: "lab(0 0 0)" }, text: "k" });
    const white = makeNode({ style: { backgroundColor: "rgb(255 255 255)" }, children: [leaf] });
    layoutRoot(white, 1);
    expect(renderCellSegments(white)[0]).toEqual([
      { text: "k", color: "rgb(128 128 128)", backgroundColor: "rgb(255 255 255)" },
    ]);
  });

  it("blends a color the parser leaves alone through the caller's read", () => {
    const leaf = makeNode({ style: { opacity: 0.4, color: "var(--mw-ansi-red)" }, text: "r" });
    const root = makeNode({ style: { backgroundColor: "rgb(255 255 255)" }, children: [leaf] });
    layoutRoot(root, 1);
    const readColor = (value: string) =>
      value === "var(--mw-ansi-red)" ? { r: 1, g: 0, b: 0, a: 1 } : null;
    expect(renderCellSegments(root, { readColor })[0]).toEqual([
      { text: "r", color: "rgb(255 153 153)", backgroundColor: "rgb(255 255 255)" },
    ]);
  });

  /** A paragraph's segment holding `text`, from HTML. */
  const segmentsOf = (html: string, width = 20) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, width);
    host.remove();
    const segments = renderCellSegments(node).flat();
    return (text: string) => segments.find((segment) => segment.text.includes(text));
  };

  it("blends an inline element as a group over its block's cells", () => {
    const segmentOf = segmentsOf(
      '<div><p style="color: rgb(255 255 255); background: rgb(0 0 200)">xx <span style="opacity: 0.4">yy</span> <span style="opacity: 0.4; background: rgb(255 0 0)">zz</span></p></div>',
    );
    expect(segmentOf("yy")).toMatchObject({
      color: "rgb(102 102 222)",
      backgroundColor: "rgb(0 0 200)",
    });
    expect(segmentOf("zz")).toMatchObject({
      color: "rgb(102 102 222)",
      backgroundColor: "rgb(102 0 120)",
    });
  });

  it("nests inline groups, each ancestor's background beneath what it holds", () => {
    const segmentOf = segmentsOf(
      '<div><p style="color: rgb(255 255 255); background: rgb(0 0 200)">a <span style="opacity: 0.6; background: rgb(255 0 0)">b <em style="opacity: 0.4">c</em></span></p></div>',
    );
    expect(segmentOf("b")).toMatchObject({
      color: "rgb(153 153 233)",
      backgroundColor: "rgb(153 0 80)",
    });
    expect(segmentOf("c")).toMatchObject({
      color: "rgb(153 61 141)",
      backgroundColor: "rgb(153 0 80)",
    });
  });

  it("composites a faded inline element over a translucent ancestor's background as one color", () => {
    const segmentOf = segmentsOf(
      '<div><p><span style="background: rgba(0, 0, 0, 0.5)">a <em style="opacity: 0.4; background: rgb(0 0 255); color: rgb(255 255 0)">b</em></span></p></div>',
    );
    expect(segmentOf("b")).toMatchObject({
      color: "rgb(146 146 0)",
      backgroundColor: "rgb(0 0 146)",
      opacity: expect.closeTo(0.7, 9),
    });
  });

  it("fades a color emoji in a faded inline element over its ancestor's fill by its alpha alone", () => {
    const segmentOf = segmentsOf(
      '<div><p style="background: rgb(255 255 255)"><span style="background: rgb(0 0 255)">a <em style="opacity: 0.4">\u{1F600}</em></span></p></div>',
    );
    const emoji = segmentOf("\u{1F600}")!;
    expect([emoji.backgroundColor, emoji.color, emoji.emojiOpacity, emoji.opacity]).toEqual([
      "rgb(0 0 255)",
      "rgb(0 0 0)",
      0.4,
      undefined,
    ]);
  });

  it("paints an outer inline element's background under an inner one's characters", () => {
    const segmentOf = segmentsOf(
      '<div><p><span style="background: rgb(255 255 0)">a <b>b</b></span></p></div>',
    );
    expect(segmentOf("b")?.backgroundColor).toBe("rgb(255 255 0)");
  });

  it("fades what a faded inline element holds: an atomic box, an out-of-flow box, a split block", () => {
    const segmentOf = segmentsOf(
      '<div style="position: relative; color: rgb(0 0 0)"><p>a <span style="opacity: 0.4">b <span style="display: inline-block">box</span><span style="position: absolute; right: 0; bottom: 0">abs</span></span></p><div>c <span style="opacity: 0.4">d<div>block</div>e</span></div></div>',
      30,
    );
    for (const text of ["b", "box", "abs", "d", "block", "e"]) {
      expect([segmentOf(text)?.color, segmentOf(text)?.opacity], text).toEqual(["rgb(0 0 0)", 0.4]);
    }
  });
});

describe("charIndexAtCell (specs/semantic-selection.md)", () => {
  it("maps a cell back to the character the paint put there", () => {
    const leaf = makeNode({
      style: { width: { kind: "cells", value: 5 } },
      text: "hello world",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 5);
    expect(renderPlainText(root)).toBe("hello\nworld");
    expect(charIndexAtCell(leaf, 0, 0, 1, 1)).toBe(7);
    expect(charIndexAtCell(leaf, 0, 0, 4, 0)).toBe(4);
  });

  it("honors alignment, indent, and padding, and reports blanks as null", () => {
    const leaf = makeNode({
      style: {
        width: { kind: "cells", value: 10 },
        textAlign: "center",
        textIndent: 2,
        padding: { top: 0, right: 0, bottom: 0, left: 1 },
        border: { top: 1, right: 0, bottom: 0, left: 0 },
      },
      text: "ab",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 10);
    const row = renderPlainText(root).split("\n")[1]!;
    const col = row.indexOf("a");
    expect(charIndexAtCell(leaf, 0, 0, col, 1)).toBe(0);
    expect(charIndexAtCell(leaf, 0, 0, col + 1, 1)).toBe(1);
    expect(charIndexAtCell(leaf, 0, 0, 0, 1)).toBeNull();
    expect(charIndexAtCell(leaf, 0, 0, col, 0)).toBeNull();
  });

  it("covers every cell of a tracked character and skips the ellipsis", () => {
    const tracked = makeNode({
      style: { width: { kind: "cells", value: 6 }, tracking: 1 },
      text: "ab",
    });
    tracked.advances = [2, 2];
    const root = makeNode({ children: [tracked] });
    layoutRoot(root, 6);
    expect(charIndexAtCell(tracked, 0, 0, 1, 0)).toBe(0);
    expect(charIndexAtCell(tracked, 0, 0, 2, 0)).toBe(1);
    const clipped = makeNode({
      style: {
        width: { kind: "cells", value: 4 },
        whiteSpace: "nowrap",
        overflow: { x: "hidden", y: "visible" },
        textOverflow: "ellipsis",
      },
      text: "abcdefgh",
    });
    const clippedRoot = makeNode({ children: [clipped] });
    layoutRoot(clippedRoot, 4);
    expect(renderPlainText(clippedRoot)).toBe("abc…");
    expect(charIndexAtCell(clipped, 0, 0, 2, 0)).toBe(2);
    expect(charIndexAtCell(clipped, 0, 0, 3, 0)).toBeNull();
  });

  it("applies the leaf's own scroll offset, as the paint does", () => {
    const leaf = makeNode({
      style: {
        width: { kind: "cells", value: 4 },
        whiteSpace: "nowrap",
        overflow: { x: "scroll", y: "visible" },
        scrollbarWidth: "none",
      },
      text: "abcdefgh",
    });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 4);
    scrollBox(root, leaf, 2, 0);
    expect(renderPlainText(root).split("\n")[0]).toBe("cdef");
    expect(charIndexAtCell(leaf, 0, 0, 0, 0)).toBe(2);
  });
});

describe("charIndexAtCell on a multicol leaf", () => {
  it("follows the stored fragmentation, column by column", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="column-count: 2; column-gap: 4px; width: 36px">aaa bbb ccc ddd</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 60);
    expect(renderPlainText(node)).toBe(["aaa  ccc", "bbb  ddd"].join("\n"));
    expect(charIndexAtCell(node, 0, 0, 5, 0)).toBe(8);
    expect(charIndexAtCell(node, 0, 0, 0, 1)).toBe(4);
    expect(charIndexAtCell(node, 0, 0, 3, 0)).toBeNull();
  });
});

describe("later ink owns its cell's text paint", () => {
  it("resets the text fields of the glyph beneath, and keeps the fill's background", () => {
    const styled = makeNode({
      text: "abc",
      style: {
        color: "red",
        glyph: { ...INITIAL_GLYPH, "font-style": "italic", "font-weight": "700" },
        textDecoration: UNDERLINE,
        opacity: 0.5,
      },
    });
    const plain = makeNode({
      text: "xy",
      style: { position: "absolute", insets: { top: 0, right: null, bottom: null, left: 0 } },
    });
    const root = makeNode({
      style: { position: "relative", backgroundColor: "blue" },
      children: [styled, plain],
    });
    layoutRoot(root, 10);
    const [first] = renderGridRows(root).segments[0]!;
    expect(first).toEqual({ text: "xy", backgroundColor: "blue" });
  });
});
