import { describe, expect, it } from "vitest";
import { charIndexAtCell, renderPlainText, renderCellSegments } from "../src/plain-text.ts";
import { collectBorderRuns } from "../src/borders.ts";
import type { BorderRun } from "../src/borders.ts";
import { layoutRoot } from "../src/layout.ts";
import { buildTree } from "../src/tree.ts";
import { INLINE_PAD, wrapLines } from "../src/wrap.ts";
import { makeNode } from "./helpers.ts";
import type { LayoutNode } from "../src/types.ts";

/**
 * Golden-output tests: lay out a tree, render it as ASCII art, compare to
 * the expected drawing. These cover layout + border painting + text
 * placement end-to-end, deterministically, with no DOM or fonts involved.
 */

function plainText(root: LayoutNode, availableWidth: number): string {
  layoutRoot(root, availableWidth);
  return renderPlainText(root);
}

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
        overflow: { x: "clip", y: "clip" },
        textOverflow: "ellipsis",
      },
      text: "hello wonderful world",
    });
    const root = makeNode({ children: [box] });

    // Inner content width 8: "hello wonderful world" → "hello w…", one row.
    expect(plainText(root, 12)).toBe(["┌──────────┐", "│ hello w… │", "└──────────┘"].join("\n"));
  });

  it("renders clipped nowrap text without an ellipsis when text-overflow is clip", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        whiteSpace: "nowrap",
        overflow: { x: "clip", y: "clip" },
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

  it("renders a border-2 double border as concentric rings", () => {
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

  it("renders per-side border styles with light corners at style boundaries", () => {
    const box = makeNode({
      style: {
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        borderStyle: { top: "double", right: "solid", bottom: "dashed", left: "solid" },
      },
      text: "hi",
    });
    const root = makeNode({ children: [box] });

    // Top edge double, bottom dashed, sides solid; mixed-style corners fall
    // back to the light set (no mixed junction glyphs in Unicode).
    expect(plainText(root, 6)).toBe(["┌════┐", "│hi  │", "└╌╌╌╌┘"].join("\n"));
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
    inline.inlineBox = true;
    const root = makeNode({ children: [block, inline] });
    root.localRect = { x: 0, y: 0, width: 6, height: 2 };
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

describe("inline fidelity in segments", () => {
  it("keeps underline through an inline run's inner spaces", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 60px"><span style="text-decoration-line: underline">click me</span></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 15);
    const rows = renderCellSegments(node);
    expect(rows[0]).toEqual([
      { text: "click me", textDecorationLine: "underline" },
      { text: "       " },
    ]);
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
    expect(rows[0]!.map((s) => [s.text, s.color, s.fontWeight])).toEqual([
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

describe("opacity", () => {
  it("bakes the ancestor product onto every paint; 0 keeps its glyphs", () => {
    const half = makeNode({
      style: { opacity: 0.5, color: "red" },
      children: [
        makeNode({ style: { opacity: 0.5, color: "blue" }, text: "in", intrinsicWidth: 2 }),
      ],
    });
    const ghost = makeNode({ style: { opacity: 0 }, text: "go", intrinsicWidth: 2 });
    const root = makeNode({ children: [half, ghost] });
    layoutRoot(root, 2);
    const rows = renderCellSegments(root);
    // Nested opacity multiplies (0.5 × 0.5 = 0.25) — CSS nests, it
    // doesn't inherit.
    expect(rows[0]![0]).toMatchObject({ text: "in", color: "blue", opacity: "0.25" });
    // opacity: 0 still paints its glyphs (transparent spans stay
    // selectable in grid mode), never drops them.
    expect(rows[1]![0]).toMatchObject({ text: "go", opacity: "0" });
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
        overflow: { x: "clip", y: "visible" },
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
    leaf.scroll = { x: 2, y: 0 };
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
