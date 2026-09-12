import { describe, expect, it, vi } from "vitest";
import { glyphSetFor, onGlyphRegistryChange, registerBorderGlyphs } from "../src/glyphs.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { makeNode } from "./helpers.ts";
import type { CellStyle } from "../src/types.ts";

/** Border glyph sets (specs/theming.md): styles resolve through the
 * owner's set, per-glyph fallback to the defaults. */

const box = (glyphSet: string | null, style: CellStyle["borderStyle"]["top"] = "solid") => {
  const root = makeNode({
    children: [
      makeNode({
        style: {
          glyphSet,
          border: { top: 1, right: 1, bottom: 1, left: 1 },
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
