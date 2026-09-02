import { describe, expect, it, vi } from "vitest";
import { onGlyphRegistryChange, registerBorderGlyphs } from "../src/glyphs.ts";
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
