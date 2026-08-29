import { describe, expect, it } from "vitest";
import { renderAscii } from "../src/ascii.ts";
import { collectBorderRuns } from "../src/borders.ts";
import type { BorderRun } from "../src/borders.ts";
import { layoutRoot } from "../src/layout.ts";
import { INLINE_PAD, wrapLines } from "../src/wrap.ts";
import { makeNode } from "./helpers.ts";
import type { LayoutNode } from "../src/types.ts";

/**
 * Golden-output tests: lay out a tree, render it as ASCII art, compare to
 * the expected drawing. These cover layout + border painting + text
 * placement end-to-end, deterministically, with no DOM or fonts involved.
 */

function ascii(root: LayoutNode, availableWidth: number): string {
  layoutRoot(root, availableWidth);
  return renderAscii(root);
}

describe("renderAscii golden outputs", () => {
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

    expect(ascii(root, 40)).toBe(
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
    expect(ascii(root, 12)).toBe(["┌──────────┐", "│ hello w… │", "└──────────┘"].join("\n"));
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

    expect(ascii(root, 8)).toBe(["┌──────┐", "│hello │", "└──────┘"].join("\n"));
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

    expect(ascii(root, 12)).toBe(
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

    expect(ascii(root, 10)).toBe(
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
    expect(ascii(root, 6)).toBe(["┌════┐", "│hi  │", "└╌╌╌╌┘"].join("\n"));
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
    expect(ascii(root, 8)).toBe(["┌──────★", "│ hi   │", "└──────┘"].join("\n"));
  });

  it("renders tracked text with gap cells and leading with gap rows", () => {
    const leaf = makeNode({ text: "ab cd", intrinsicWidth: 9, style: { lineGap: 1 } });
    leaf.advances = [2, 2, 1, 2, 2];
    const box = makeNode({ style: { maxWidth: 6 }, children: [leaf] });
    const root = makeNode({ children: [box] });

    expect(ascii(root, 6)).toBe(["a b", "", "c d"].join("\n"));
  });

  it("renders a flex column with gap", () => {
    const container = makeNode({
      style: { display: "flex", flexDirection: "column", gapY: 1 },
      children: [makeNode({ text: "one" }), makeNode({ text: "two" })],
    });
    const root = makeNode({ children: [container] });

    expect(ascii(root, 10)).toBe(["one", "", "two"].join("\n"));
  });

  it("renders hard line breaks", () => {
    const leaf = makeNode({ text: "a\nbb" });
    const root = makeNode({ children: [leaf] });

    expect(ascii(root, 5)).toBe(["a", "bb"].join("\n"));
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

  it("breaks after hyphens like the browser, except before digits", () => {
    expect(wrapLines("mx-auto", 6)).toEqual(["mx-", "auto"]);
    expect(wrapLines("mx-auto", 7)).toEqual(["mx-auto"]);
    // Hyphen segment fills the current line when it fits.
    expect(wrapLines("aa mx-auto", 6)).toEqual(["aa mx-", "auto"]);
    // No break between a hyphen and a following digit (UAX #14).
    expect(wrapLines("2026-08", 6)).toEqual(["2026-0", "8"]);
    // Consecutive hyphens break as one run.
    expect(wrapLines("well--known", 6)).toEqual(["well--", "known"]);
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
    expect(renderAscii(root)).toBe("a b");
  });
});
