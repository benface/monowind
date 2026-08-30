import { describe, expect, it } from "vitest";
import { renderPlainText, renderPlainTextSegments } from "../src/plain-text.ts";
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
        overflow: "clip",
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
        overflow: "clip",
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

describe("inline padding rendering", () => {
  it("renders pad markers as blank cells", () => {
    const leaf = makeNode({ text: `a${INLINE_PAD}b`, intrinsicWidth: 3 });
    const root = makeNode({ children: [leaf] });
    layoutRoot(root, 3);
    expect(renderPlainText(root)).toBe("a b");
  });
});

describe("renderPlainTextSegments", () => {
  it("splits rows into same-colored runs whose text joins back to the plain render", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="width: 24px; border: 1px solid; border-color: cyan; color: red">hi</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 6);
    const rows = renderPlainTextSegments(node);
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
    const rows = renderPlainTextSegments(node);
    expect(rows[0]).toEqual([{ text: "click me", textDecorationLine: "underline" }]);
  });

  it("maps inline descendants' color/weight and relative insets per character", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="height: 8px"><div style="width: 40px">ab <b style="color: red; font-weight: 700">cd</b> <span style="position: relative; top: 4px; color: blue">ef</span></div></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 10);
    const rows = renderPlainTextSegments(node);
    // Row 0: leaf text bare, "cd" red + bold (spaces always unstyled);
    // "ef" shifted down one row by `top: 4px`, keeping its color.
    expect(rows[0]!.map((s) => [s.text, s.color, s.fontWeight])).toEqual([
      ["ab ", undefined, undefined],
      ["cd", "red", "700"],
    ]);
    expect(rows[1]!.map((s) => [s.text, s.color])).toEqual([
      ["      ", undefined],
      ["ef", "blue"],
    ]);
  });
});
