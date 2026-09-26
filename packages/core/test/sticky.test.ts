import { describe, expect, it } from "vitest";
import { focusableRects } from "../src/focus.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderGridRows, renderPlainText } from "../src/plain-text.ts";
import { charIndexAtCell } from "../src/plain-text.ts";
import { hitStack } from "../src/pointer.ts";
import { buildTree } from "../src/tree.ts";
import { stickyShiftAxis } from "../src/sticky.ts";
import type { CellLength, LayoutNode, OverflowAxis } from "../src/types.ts";
import { makeNode, scrollBox } from "./helpers.ts";

/** Sticky positioning (specs/sticky.md): the paint-time shift a scroll
 * offset gives a sticky box, in cells, and the walks that add it. */

describe("stickyShiftAxis (css-position-3 §3.4)", () => {
  const view = { start: 0, end: 5 };
  const room = { start: -100, end: 100 };

  it("keeps the start edge at the start inset, the end edge at the end inset", () => {
    expect(stickyShiftAxis({ start: -3, end: -2 }, room, view, 0, null)).toBe(3);
    expect(stickyShiftAxis({ start: -3, end: -2 }, room, view, 1, null)).toBe(4);
    expect(stickyShiftAxis({ start: 2, end: 3 }, room, view, 0, null)).toBe(0);
    expect(stickyShiftAxis({ start: 8, end: 9 }, room, view, null, 0)).toBe(-4);
    expect(stickyShiftAxis({ start: 8, end: 9 }, room, view, null, 1)).toBe(-5);
  });

  it("lets the start inset win when both bind (a box taller than the view)", () => {
    expect(stickyShiftAxis({ start: 0, end: 7 }, room, view, 0, 0)).toBe(0);
    expect(stickyShiftAxis({ start: -1, end: 6 }, room, view, 0, 0)).toBe(1);
    expect(stickyShiftAxis({ start: 3, end: 10 }, room, view, 0, 0)).toBe(-3);
  });

  it("keeps the box inside its block, and moves it nowhere toward a side it already crosses", () => {
    expect(stickyShiftAxis({ start: -5, end: -4 }, { start: -10, end: -3 }, view, 0, null)).toBe(1);
    expect(stickyShiftAxis({ start: -5, end: -4 }, { start: -10, end: -5 }, view, 0, null)).toBe(0);
    expect(stickyShiftAxis({ start: 8, end: 9 }, { start: 6, end: 30 }, view, null, 0)).toBe(-2);
    expect(stickyShiftAxis({ start: 8, end: 9 }, { start: 9, end: 30 }, view, null, 0)).toBe(0);
  });

  it("shifts nothing without an inset on the axis", () => {
    expect(stickyShiftAxis({ start: -3, end: -2 }, room, view, null, null)).toBe(0);
  });
});

/** A 20-cell, 4-row scroller (its auto gutter takes a column). */
const scroller = (
  children: LayoutNode[],
  overflow: { x: OverflowAxis; y: OverflowAxis } = { x: "visible", y: "auto" },
) =>
  makeNode({
    style: {
      overflow,
      width: { kind: "cells", value: 20 },
      height: { kind: "cells", value: 4 },
    },
    children,
  });
const spacer = (rows: number) => makeNode({ style: { height: { kind: "cells", value: rows } } });
const sticky = (
  text: string,
  insets: Partial<Record<"top" | "right" | "bottom" | "left", CellLength>>,
  extra: Parameters<typeof makeNode>[0] = {},
) =>
  makeNode({
    text,
    ...extra,
    style: {
      position: "sticky",
      insets: { top: null, right: null, bottom: null, left: null, ...insets },
      ...extra.style,
    },
  });
const rowsAt = (root: LayoutNode, box: LayoutNode, y: number, x = 0): string[] => {
  scrollBox(root, box, x, y);
  return renderPlainText(root).split("\n");
};

describe("sticky boxes in a scroller", () => {
  it("pins a section heading at the top, pushes it out at the section's end, hands over", () => {
    const first = sticky("H1", { top: 0 });
    const second = sticky("H2", { top: 0 });
    const box = scroller([
      makeNode({ children: [first, spacer(3)] }),
      makeNode({ children: [second, spacer(3)] }),
    ]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 0)[0]!.startsWith("H1")).toBe(true);
    expect(first.stickyShift).toBeUndefined();
    expect(rowsAt(root, box, 1)[0]!.startsWith("H1")).toBe(true);
    expect(first.stickyShift).toEqual({ x: 0, y: 1 });
    // The section's last row still holds it.
    expect(rowsAt(root, box, 3)[0]!.startsWith("H1")).toBe(true);
    // Past it: the block's end caps the shift and the next heading is
    // at the top of its own accord.
    expect(rowsAt(root, box, 4)[0]!.startsWith("H2")).toBe(true);
    expect(first.stickyShift).toEqual({ x: 0, y: 3 });
    expect(second.stickyShift).toBeUndefined();
    expect(rowsAt(root, box, 5)[0]!.startsWith("H2")).toBe(true);
    expect(second.stickyShift).toEqual({ x: 0, y: 1 });
  });

  it("paints a stuck heading in its own text style over the italic it covers", () => {
    const heading = sticky("Title", { top: 0 }, { style: { backgroundClear: true } });
    const italic = makeNode({ text: "polite", style: { fontStyle: "italic" } });
    const box = scroller([makeNode({ children: [heading, spacer(1), italic, spacer(3)] })]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 2)[0]!.startsWith("Title")).toBe(true);
    const { text, ...paint } = renderGridRows(root).segments[0]![0]!;
    expect(text.startsWith("Title")).toBe(true);
    expect(paint).toEqual({});
  });

  it("keeps a heading placed directly in the scroller for the whole scroll", () => {
    const heading = sticky("H", { top: 0 });
    const box = scroller([heading, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 6)[0]!.startsWith("H")).toBe(true);
    expect(heading.stickyShift).toEqual({ x: 0, y: 6 });
  });

  it("holds a footer at the bottom until its own row scrolls into view", () => {
    const footer = sticky("F", { bottom: 0 });
    const box = scroller([spacer(10), footer]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 0)[3]!.startsWith("F")).toBe(true);
    expect(footer.stickyShift).toEqual({ x: 0, y: -7 });
    expect(rowsAt(root, box, 7)[3]!.startsWith("F")).toBe(true);
    expect(footer.stickyShift).toBeUndefined();
  });

  it("pins a column at the left of an x-scroller", () => {
    const column = sticky("abc", { left: 0 }, { style: { width: { kind: "cells", value: 3 } } });
    const wide = makeNode({
      style: { width: { kind: "cells", value: 30 } },
      children: [column, spacer(1)],
    });
    const box = scroller([wide], { x: "auto", y: "visible" });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 0, 5)[0]!.startsWith("abc")).toBe(true);
    expect(column.stickyShift).toEqual({ x: 5, y: 0 });
  });

  it("nests: a heading sticks inside its sticky section", () => {
    const heading = sticky("H", { top: 1 });
    const section = sticky("", { top: 0 }, { children: [heading, spacer(3)] });
    const box = scroller([section, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    const rows = rowsAt(root, box, 2);
    expect(section.stickyShift).toEqual({ x: 0, y: 2 });
    expect(heading.stickyShift).toEqual({ x: 0, y: 1 });
    expect(rows[0]!.slice(0, 19).trim()).toBe("");
    expect(rows[1]!.startsWith("H")).toBe(true);
  });

  it("resolves a percent inset against the scrollport", () => {
    const heading = sticky("H", { top: { percent: 50 } });
    const box = scroller([heading, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 5)[2]!.startsWith("H")).toBe(true);
  });

  it("resolves a calc inset: the scrollport's height less two rows holds a box above the bottom", () => {
    const teaser = sticky("H", { top: { percent: 100, cells: -2 } });
    const box = scroller([teaser, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    expect(rowsAt(root, box, 0)[2]!.startsWith("H")).toBe(true);
    expect(rowsAt(root, box, 3)[2]!.startsWith("H")).toBe(true);
  });

  it("shifts nothing with every inset auto, or without a scrolling ancestor", () => {
    const idle = sticky("H", {});
    const box = scroller([idle, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    rowsAt(root, box, 5);
    expect(idle.stickyShift).toBeUndefined();
    const loose = sticky("H", { top: 0 });
    const plain = makeNode({ children: [makeNode({ children: [loose, spacer(10)] })] });
    layoutRoot(plain, 20);
    expect(loose.stickyShift).toBeUndefined();
  });

  it("sticks in a fixed box to a scroller inside it alone, the one it escapes left out", () => {
    const fixedAt = (x: number, extra: Parameters<typeof makeNode>[0]) =>
      makeNode({
        ...extra,
        style: {
          position: "fixed",
          insets: { top: 0, right: null, bottom: null, left: x },
          width: { kind: "cells", value: 5 },
          ...extra.style,
        },
      });
    const still = sticky("S", { top: 0 });
    const scrolled = sticky("T", { top: 0 });
    const inner = scroller([scrolled, spacer(10)]);
    const box = scroller([
      spacer(10),
      fixedAt(0, { children: [still, spacer(3)] }),
      fixedAt(10, { style: { width: { kind: "cells", value: 20 } }, children: [inner] }),
    ]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 40);
    inner.scroll = { x: 0, y: 2 };
    const rows = rowsAt(root, box, 3);
    expect(still.stickyShift).toBeUndefined();
    expect(rows[0]!.slice(0, 5)).toBe("S    ");
    expect(scrolled.stickyShift).toEqual({ x: 0, y: 2 });
    expect(rows[0]!.slice(10, 11)).toBe("T");
  });

  it("is where the paint put it for hit-testing and focus", () => {
    const button = document.createElement("button");
    const heading = sticky("H", { top: 0 }, { source: button });
    const box = scroller([heading, spacer(10)]);
    const root = makeNode({ children: [box] });
    layoutRoot(root, 20);
    rowsAt(root, box, 6);
    expect(hitStack(root, 0, 0, null).at(-1)).toBe(heading);
    expect(heading.paintOrigin.y).toBe(0);
    expect(focusableRects(root).find((f) => f.element === button)!.rect.y).toBe(0);
  });
});

describe("sticky inline elements", () => {
  it("shifts a sticky span's glyphs over the line they land on, and hit-tests them there", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<div><div style="overflow-y: auto; width: 80px; height: 8px">` +
      `<p>aaaa <span style="position: sticky; top: 0px">bb</span> cc dd ee ff gg hh ii jj</p>` +
      `</div></div>`;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 20);
    const [box] = root.children;
    const leaf = box!.children[0]!;
    const entry = leaf.inlineElements!.find((e) => e.sticky !== undefined)!;
    expect(entry.insets).toBeNull();
    expect(entry.sticky).toEqual({ top: 0, right: null, bottom: null, left: null });
    expect(rowsAt(root, box!, 0)[0]!.startsWith("aaaa bb cc")).toBe(true);
    expect(entry.stickyShift).toBeUndefined();
    // Scrolled a row: its line is gone, its glyphs stay on the top row
    // over the second line's.
    const rows = rowsAt(root, box!, 1);
    expect(entry.stickyShift).toEqual({ x: 0, y: 1 });
    expect(rows[0]!.slice(0, 11)).toBe("gg hhbbi jj");
    expect(leaf.text[charIndexAtCell(leaf, 0, -1, 5, 0)!]).toBe("b");
  });

  it("sticks a span to the leaf that scrolls it", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<div><p style="overflow-y: auto; width: 80px; height: 8px">` +
      `aaaa <span style="position: sticky; top: 0px">bb</span> cc dd ee ff gg hh ii jj</p></div>`;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 20);
    const leaf = root.children[0]!;
    const entry = leaf.inlineElements!.find((e) => e.sticky !== undefined)!;
    const rows = rowsAt(root, leaf, 1);
    expect(entry.stickyShift).toEqual({ x: 0, y: 1 });
    expect(rows[0]!.slice(0, 11)).toBe("gg hhbbi jj");
  });
});

const TABLE_CELL = "border: 1px solid";
const cell = (tag: string, text: string, extra = "") =>
  `<${tag} style="${TABLE_CELL}; ${extra}">${text}</${tag}>`;

describe("sticky table parts", () => {
  const build = (html: string, cols: number) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, cols);
    return { root, box: root.children[0]! };
  };

  it("keeps a stuck thead's lines with it, meeting the body's column lines below", () => {
    const rows = Array.from({ length: 4 }, () => `<tr>${cell("td", "a")}${cell("td", "b")}</tr>`);
    const { root, box } = build(
      `<div><div style="overflow-y: auto; width: 80px; height: 20px">` +
        `<table style="border-collapse: collapse">` +
        `<thead style="position: sticky; top: 0px"><tr>${cell("th", "h")}${cell("th", "i")}</tr></thead>` +
        `<tbody>${rows.join("")}</tbody></table></div></div>`,
      20,
    );
    const first5 = (y: number) =>
      rowsAt(root, box, y)
        .slice(0, 5)
        .map((row) => row.slice(0, 5));
    // At rest: the lattice as a static table paints it.
    expect(first5(0)).toEqual(["┌─┬─┐", "│h│i│", "├─┼─┤", "│a│b│", "├─┼─┤"]);
    // Stuck: the header over the body, its bottom line joined to the
    // column lines running on below it.
    expect(first5(3)).toEqual(["┌─┬─┐", "│h│i│", "├─┼─┤", "├─┼─┤", "│a│b│"]);
    expect(first5(4)).toEqual(["┌─┬─┐", "│h│i│", "├─┼─┤", "│a│b│", "├─┼─┤"]);
    // Kept until the table's end.
    expect(first5(6)).toEqual(["┌─┬─┐", "│h│i│", "├─┼─┤", "│a│b│", "└─┴─┘"]);
  });

  it("paints a stuck thead's lines as the table's ink, whatever the thead's visibility", () => {
    const table = (tableStyle: string, headStyle: string) => {
      const rows = Array.from({ length: 4 }, () => `<tr>${cell("td", "a")}${cell("td", "b")}</tr>`);
      const { root, box } = build(
        `<div><div style="overflow-y: auto; width: 80px; height: 20px">` +
          `<table style="border-collapse: collapse; ${tableStyle}">` +
          `<thead style="position: sticky; top: 0px; ${headStyle}"><tr>${cell("th", "h")}${cell("th", "i")}</tr></thead>` +
          `<tbody>${rows.join("")}</tbody></table></div></div>`,
        20,
      );
      return rowsAt(root, box, 3)
        .slice(0, 3)
        .map((row) => row.slice(0, 5));
    };
    // A hidden thead's cells go blank, the table's lines over them stay.
    expect(table("", "visibility: hidden")).toEqual(["┌─┬─┐", "│ │ │", "├─┼─┤"]);
    // A hidden table's lines go, a visible thead's text stays.
    const hiddenTable = table("visibility: hidden", "visibility: visible").join("\n");
    expect(hiddenTable).not.toMatch(/[┌┬┐│├┼┤]/);
    expect(hiddenTable).toContain("h");
  });

  it("keeps a stuck first column's lines with it", () => {
    const row = (tag: string) =>
      `<tr>${cell(tag, "aa", "position: sticky; left: 0px")}${cell(tag, "bb")}${cell(tag, "cc")}</tr>`;
    const { root, box } = build(
      `<div><div style="overflow-x: auto; width: 28px; height: 20px">` +
        `<table style="border-collapse: collapse"><tbody>${row("td")}${row("td")}</tbody></table>` +
        `</div></div>`,
      7,
    );
    // The column, lines included, slides over the second one; its right
    // line lands on the second column's own, and the top line joins.
    const rows = rowsAt(root, box, 0, 3);
    expect(rows[0]!.slice(0, 6)).toBe("┌──┬──");
    expect(rows[1]!.slice(0, 6)).toBe("│aa│cc");
  });

  it("keeps the line shared by two stuck cells of a column", () => {
    const row = (name: string) =>
      `<tr>${cell("th", name, "position: sticky; left: 0px")}${cell("td", "bb")}${cell("td", "cc")}</tr>`;
    const { root, box } = build(
      `<div><div style="overflow-x: auto; width: 28px; height: 40px">` +
        `<table style="border-collapse: collapse"><tbody>${row("aa")}${row("dd")}</tbody></table>` +
        `</div></div>`,
      7,
    );
    const rows = rowsAt(root, box, 0, 1);
    expect(rows.slice(0, 5).map((r) => r.slice(0, 5))).toEqual([
      "┌──┬─",
      "│aa│b",
      "├──┼─",
      "│dd│b",
      "└──┴─",
    ]);
  });

  it("joins a stuck header's bottom line to a stuck column's lines, both scrolled", () => {
    const body = ["aa", "dd", "ee"]
      .map(
        (name) => `<tr>${cell("th", name, "position: sticky; left: 0px")}${cell("td", "bb")}</tr>`,
      )
      .join("");
    const { root, box } = build(
      `<div><div style="overflow: auto; width: 28px; height: 28px">` +
        `<table style="border-collapse: collapse">` +
        `<thead style="position: sticky; top: 0px"><tr>` +
        `${cell("th", "hh", "position: sticky; left: 0px")}${cell("th", "ii")}</tr></thead>` +
        `<tbody>${body}</tbody></table></div></div>`,
      7,
    );
    // The stuck column's line meets the stuck header's bottom line and
    // runs on into the body's next line, both scrolled a cell.
    const rows = rowsAt(root, box, 1, 1);
    expect(rows.slice(0, 6).map((r) => r.slice(0, 4))).toEqual([
      "┌──┬",
      "│hh│",
      "├──┼",
      "├──┼",
      "│dd│",
      "├──┼",
    ]);
  });

  it("adds a sticky cell's shift to its sticky group's", () => {
    const body = Array.from(
      { length: 3 },
      () => `<tr>${cell("td", "cc")}${cell("td", "dd")}</tr>`,
    ).join("");
    const { root, box } = build(
      `<div><div style="overflow: auto; width: 28px; height: 20px">` +
        `<table style="border-collapse: collapse">` +
        `<thead style="position: sticky; top: 0px"><tr>` +
        `${cell("th", "aa", "position: sticky; left: 0px")}${cell("th", "bb")}</tr></thead>` +
        `<tbody>${body}</tbody></table></div></div>`,
      7,
    );
    const thead = box.children[0]!.children[0]!;
    const th = thead.children[0]!.children[0]!;
    const rows = rowsAt(root, box, 3, 3);
    expect(thead.stickyShift).toEqual({ x: 0, y: 3 });
    expect(th.stickyShift).toEqual({ x: 3, y: 0 });
    expect(rows[1]!.slice(0, 4)).toBe("│aa│");
  });
});
