import { describe, expect, it, vi } from "vitest";
import {
  glyphSetFor,
  onGlyphRegistryChange,
  registerBorderGlyphs,
  weightBand,
} from "../src/glyphs.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { buildTree } from "../src/tree.ts";
import { makeNode } from "./helpers.ts";
import type { CellStyle } from "../src/types.ts";

/** Border glyph sets (specs/theming.md): styles resolve through the
 * owner's set, per-glyph fallback to the defaults. */

const box = (
  glyphSet: string | null,
  style: CellStyle["borderStyle"]["top"] = "solid",
  weight = 1,
) => {
  const root = makeNode({
    children: [
      makeNode({
        style: {
          glyphSet,
          border: { top: 1, right: 1, bottom: 1, left: 1 },
          borderWeight: { top: weight, right: weight, bottom: weight, left: weight },
          borderStyle: { top: style, right: style, bottom: style, left: style },
        },
        text: "x",
        intrinsicWidth: 1,
      }),
    ],
  });
  layoutRoot(root, 5);
  return renderPlainText(root);
};

/** A bordered box from markup: the style reader picks the cells (root
 * font size 16 → 1 cell = 4px). */
const domBox = (css: string): string => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="${css}">x</div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 7);
  return renderPlainText(node);
};

/** A bordered box's four corner glyphs, outer ring then inner. */
const corners = (
  overrides: Partial<CellStyle>,
  rings = 1,
): { outer: string[]; inner: string[] } => {
  const root = makeNode({
    children: [
      makeNode({
        style: {
          border: { top: rings, right: rings, bottom: rings, left: rings },
          ...overrides,
        },
        text: "x",
        intrinsicWidth: 1,
      }),
    ],
  });
  layoutRoot(root, 7);
  const rows = renderPlainText(root).split("\n");
  const last = rows.length - 1;
  const width = rows[0]!.length;
  const at = (row: number, col: number) => rows[row]![col]!;
  return {
    outer: [at(0, 0), at(0, width - 1), at(last, 0), at(last, width - 1)],
    inner: [at(1, 1), at(1, width - 2), at(last - 1, 1), at(last - 1, width - 2)],
  };
};
const radius = (tl: number, tr = tl, bl = tl, br = tl) => ({ tl, tr, bl, br });

describe("border radius corners", () => {
  it("rounds a light-line box's corners to arcs, per corner, from half a cell", () => {
    expect(corners({ borderRadius: radius(1) }).outer).toEqual(["╭", "╮", "╰", "╯"]);
    expect(corners({ borderRadius: radius(2, 2, 0, 0) }).outer).toEqual(["╭", "╮", "└", "┘"]);
    expect(corners({ borderRadius: radius(0.5) }).outer).toEqual(["╭", "╮", "╰", "╯"]);
    expect(corners({ borderRadius: radius(0.25) }).outer).toEqual(["┌", "┐", "└", "┘"]);
    expect(corners({ borderRadius: radius(Infinity) }).outer).toEqual(["╭", "╮", "╰", "╯"]);
    const dashed = { top: "dashed", right: "dashed", bottom: "dashed", left: "dashed" } as const;
    expect(corners({ borderRadius: radius(1), borderStyle: dashed }).outer).toEqual([
      "╭",
      "╮",
      "╰",
      "╯",
    ]);
  });

  it("keeps double square, and a set's own corners at any radius", () => {
    const double = { top: "double", right: "double", bottom: "double", left: "double" } as const;
    expect(corners({ borderRadius: radius(3), borderStyle: double }).outer).toEqual([
      "╔",
      "╗",
      "╚",
      "╝",
    ]);
    expect(corners({ borderRadius: radius(3), glyphSet: "ascii" }).outer).toEqual([
      "+",
      "+",
      "+",
      "+",
    ]);
    expect(corners({ borderRadius: radius(3), glyphSet: "cp437" }).outer).toEqual([
      "┌",
      "┐",
      "└",
      "┘",
    ]);
    expect(corners({ borderRadius: radius(3), glyphSet: "single" }).outer).toEqual([
      "┌",
      "┐",
      "└",
      "┘",
    ]);
    expect(corners({ borderRadius: radius(0), glyphSet: "rounded" }).outer).toEqual([
      "╭",
      "╮",
      "╰",
      "╯",
    ]);
  });

  it("gives a ring inside a cell less of radius", () => {
    expect(corners({ borderRadius: radius(2) }, 2).inner).toEqual(["╭", "╮", "╰", "╯"]);
    expect(corners({ borderRadius: radius(1) }, 2).inner).toEqual(["┌", "┐", "└", "┘"]);
    expect(corners({ borderRadius: radius(1) }, 2).outer).toEqual(["╭", "╮", "╰", "╯"]);
  });

  it("draws a set's registration nearest the radius, ties to the larger, per corner", () => {
    registerBorderGlyphs("test-corners", {
      solid: { rounded: [{ radius: 3, tl: "◜", tr: "◝", bl: "◟" }] },
    });
    const glyphSet = "test-corners";
    expect(corners({ borderRadius: radius(3), glyphSet }).outer).toEqual(["◜", "◝", "◟", "┘"]);
    expect(corners({ borderRadius: radius(2), glyphSet }).outer).toEqual(["◜", "◝", "◟", "┘"]);
    expect(corners({ borderRadius: radius(1), glyphSet }).outer).toEqual(["┌", "┐", "└", "┘"]);
    expect(corners({ borderRadius: radius(Infinity), glyphSet }).outer).toEqual([
      "◜",
      "◝",
      "◟",
      "┘",
    ]);
  });
});

describe("border weight bands", () => {
  it("draws the defaults heavy from 2px, one cell, double unchanged", () => {
    expect(box(null, "solid", 2)).toMatch(/^┏━+┓\n┃x +┃\n┗━+┛$/);
    expect(box(null, "dashed", 2)).toMatch(/^┏╍+┓\n╏x +╏/);
    expect(box(null, "dotted", 2)).toMatch(/^┏┉+┓\n┋x +┋/);
    expect(box(null, "double", 2)).toMatch(/^╔═+╗\n║x +║/);
    expect(box(null, "solid", 5)).toMatch(/^┏━+┓/);
  });

  it("picks the band nearest the width, ties to the wider", () => {
    expect(box(null, "solid", 1.4)).toMatch(/^┌─+┐/);
    expect(box(null, "solid", 1.5)).toMatch(/^┏━+┓/);
    registerBorderGlyphs("test-bands", {
      solid: { weights: [{ width: 3, cells: 2, h: "#" }] },
    });
    const set = glyphSetFor("test-bands");
    expect(weightBand("solid", 1.9, set)).toMatchObject({ cells: 1, band: null });
    expect(weightBand("solid", 2, set)).toMatchObject({ cells: 2, band: { width: 3 } });
    expect(weightBand("solid", 3, set).roles).toMatchObject({ h: "#", v: "│", tl: "┌" });
  });

  it("a set registering a style's table registers its weights; untouched styles keep the defaults", () => {
    registerBorderGlyphs("test-no-heavy", { solid: { h: "=" } });
    expect(box("test-no-heavy", "solid", 2)).toMatch(/^┌=+┐/);
    expect(box("test-no-heavy", "dashed", 2)).toMatch(/^┏╍+┓/);
  });

  it("single, ascii, rounded, and blocks draw a 2px border as two rings; cp437 as double", () => {
    for (const name of ["single", "ascii", "rounded", "blocks"])
      expect(weightBand("solid", 2, glyphSetFor(name)).cells, name).toBe(2);
    expect(weightBand("solid", 2, glyphSetFor("cp437"))).toMatchObject({
      cells: 1,
      roles: { h: "═", v: "║", tl: "╔", cross: "╬" },
    });
    expect(weightBand("double", 2, glyphSetFor("cp437"))).toMatchObject({
      cells: 1,
      band: null,
    });
  });

  it("the style reader allocates the band's cells: 2px is one heavy cell, two rings under ascii", () => {
    expect(domBox("border: 2px solid")).toBe(["┏━━━━━┓", "┃x    ┃", "┗━━━━━┛"].join("\n"));
    expect(domBox("border: 2px solid; --mw-border-glyphs: ascii")).toBe(
      ["+-----+", "|+---+|", "||x  ||", "|+---+|", "+-----+"].join("\n"),
    );
    expect(domBox("border: 2px solid; --mw-border-glyphs: cp437")).toBe(
      ["╔═════╗", "║x    ║", "╚═════╝"].join("\n"),
    );
    expect(domBox("border: 1px solid")).toBe(["┌─────┐", "│x    │", "└─────┘"].join("\n"));
  });

  it("keeps heavy corners square under a radius; a rings band keeps the arcs, a cell less inside", () => {
    const weight2 = { top: 2, right: 2, bottom: 2, left: 2 };
    expect(corners({ borderRadius: radius(1), borderWeight: weight2 }).outer).toEqual([
      "┏",
      "┓",
      "┗",
      "┛",
    ]);
    registerBorderGlyphs("test-rings", { solid: { weights: [{ width: 2, cells: 2 }] } });
    const rings = corners(
      { borderRadius: radius(1), borderWeight: weight2, glyphSet: "test-rings" },
      2,
    );
    expect(rings.outer).toEqual(["╭", "╮", "╰", "╯"]);
    expect(rings.inner).toEqual(["┌", "┐", "└", "┘"]);
    registerBorderGlyphs("test-lines", { solid: { weights: [{ width: 2, h: "=", v: "║" }] } });
    const lines = corners({
      borderRadius: radius(1),
      borderWeight: weight2,
      glyphSet: "test-lines",
    });
    expect(lines.outer).toEqual(["╭", "╮", "╰", "╯"]);
  });

  it("reads a hidden edge as no border, and keeps a thinner edge's cells under a ring", () => {
    expect(domBox("border: 2px solid; border-top-style: hidden")).toBe(
      ["┃x    ┃", "┗━━━━━┛"].join("\n"),
    );
    expect(domBox("border: 1px solid; border-top-width: 2px; --mw-border-glyphs: ascii")).toBe(
      ["+-----+", "|-----|", "|x    |", "+-----+"].join("\n"),
    );
  });

  it("freezes a registered set", () => {
    registerBorderGlyphs("test-frozen", { solid: { h: "=", weights: [{ width: 2, cells: 2 }] } });
    const table = glyphSetFor("test-frozen")!.solid!;
    expect(() => {
      table.h = "~";
    }).toThrow();
    expect(() => {
      table.weights![0]!.cells = 3;
    }).toThrow();
  });
});

describe("border glyph sets", () => {
  it("defaults stay untouched with no set", () => {
    expect(box(null)).toMatch(/^┌─+┐/);
  });

  it("rounded remaps solid corners only (per-glyph fallback)", () => {
    const art = box("rounded");
    expect(art).toMatch(/^╭─+╮/);
    expect(art).toMatch(/╰─+╯$/);
    // Dashed corners are not overridden by the rounded set.
    expect(box("rounded", "dashed")).toMatch(/^┌╌+┐/);
  });

  it("ascii renders everything 7-bit; double keeps emphasis", () => {
    expect(box("ascii")).toMatch(/^\+-+\+/);
    expect(box("ascii", "double")).toMatch(/^\+=+\+/);
  });

  it("single downgrades double, dashed, and dotted to light lines", () => {
    expect(box("single", "double")).toMatch(/^┌─+┐/);
    expect(box("single", "dashed")).toMatch(/^┌─+┐/);
    expect(box("single", "dotted")).toMatch(/^┌─+┐/);
  });

  it("cp437 keeps double but downgrades dashed and dotted", () => {
    expect(box("cp437", "double")).toMatch(/^╔═+╗/);
    expect(box("cp437", "dashed")).toMatch(/^┌─+┐/);
    expect(box("cp437", "dotted")).toMatch(/^┌─+┐/);
  });

  it("blocks maps styles to shade density", () => {
    expect(box("blocks")).toMatch(/^█+/);
    expect(box("blocks", "double")).toMatch(/^█+/);
    expect(box("blocks", "dashed")).toMatch(/^▒+/);
    expect(box("blocks", "dotted")).toMatch(/^░+/);
  });

  it("unknown names resolve to the defaults", () => {
    expect(box("no-such-set")).toMatch(/^┌─+┐/);
  });

  it("notifies registry listeners so hosts can relayout post-hoc sets", () => {
    const listener = vi.fn();
    const unsubscribe = onGlyphRegistryChange(listener);
    registerBorderGlyphs("test-notify", { solid: { h: "n" } });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    registerBorderGlyphs("test-notify-2", { solid: { h: "n" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-registration last-wins with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerBorderGlyphs("test-dupe", { solid: { h: "a" } });
    registerBorderGlyphs("test-dupe", { solid: { h: "b" } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("last registration wins"));
    expect(box("test-dupe")).toMatch(/^┌b+┐/);
    warn.mockRestore();
  });
});

describe("QR module roles (specs/qr-code.md)", () => {
  it("no built-in set names one: every code draws with the default blocks", () => {
    for (const name of ["default", "rounded", "ascii", "single", "cp437", "blocks"]) {
      const solid = glyphSetFor(name)?.solid;
      expect([solid?.qrFull, solid?.qrUpper, solid?.qrLower], name).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }
  });
});
