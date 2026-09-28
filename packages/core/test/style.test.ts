import { describe, expect, it, vi } from "vitest";
import { readCellStyle, readGlyph } from "../src/style.ts";
import type { CellMetrics } from "../src/types.ts";

/**
 * Fallback-path tests for the computed-style reader. happy-dom has NO
 * Typed OM (`computedStyleMap` is undefined), so every read here goes down
 * the same code paths a pre-157 Firefox does — the class-scan and
 * inline-style fallbacks. This keeps those branches tested deterministically
 * even once every real browser ships Typed OM.
 */

function read(attrs: { class?: string; style?: string }, metrics?: CellMetrics) {
  const el = document.createElement("div");
  if (attrs.class) el.setAttribute("class", attrs.class);
  if (attrs.style) el.setAttribute("style", attrs.style);
  document.body.appendChild(el);
  return readCellStyle(el, 16, metrics);
}

it("has no Typed OM in this environment (the point of this suite)", () => {
  expect(
    (document.createElement("div") as { computedStyleMap?: unknown }).computedStyleMap,
  ).toBeUndefined();
});

describe("viewport-relative sizing", () => {
  it("converts viewport utilities via the measured cell size, not the spacing scale", () => {
    // Physical intent: h-screen fills the real viewport. innerHeight ÷
    // cell height (not ÷ 0.25rem).
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    const rows = Math.floor(window.innerHeight / 18);
    const cols = Math.floor(window.innerWidth / 9);
    expect(read({ class: "h-screen" }, metrics).height).toEqual({ kind: "cells", value: rows });
    expect(read({ class: "h-dvh" }, metrics).height).toEqual({ kind: "cells", value: rows });
    expect(read({ class: "w-screen" }, metrics).width).toEqual({ kind: "cells", value: cols });
    expect(read({ class: "min-h-svh" }, metrics).minHeight).toBe(rows);
    expect(read({ class: "max-h-lvh" }, metrics).maxHeight).toBe(rows);
    // Arbitrary viewport values.
    expect(read({ class: "h-[50vh]" }, metrics).height).toEqual({
      kind: "cells",
      value: Math.floor(window.innerHeight / 2 / 18),
    });
    expect(read({ class: "min-h-[95dvh]" }, metrics).minHeight).toBe(
      Math.floor((0.95 * window.innerHeight) / 18),
    );
  });

  it("catches viewport units in inline styles (kept verbatim by the style attribute)", () => {
    // vh here because happy-dom's CSS parser drops dvh/svh from inline
    // styles; real browsers keep every viewport unit verbatim.
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    expect(read({ style: "height: 100vh" }, metrics).height).toEqual({
      kind: "cells",
      value: Math.floor(window.innerHeight / 18),
    });
    expect(read({ style: "min-height: 50vh" }, metrics).minHeight).toBe(
      Math.floor(window.innerHeight / 2 / 18),
    );
  });

  it("trusts an authored viewport string from Typed OM without an active-check", () => {
    // Stub computedStyleMap (happy-dom has none) as an engine that
    // returns the AUTHORED viewport unit — the string is proof, and
    // must not be misparsed as px by the active-check.
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    const el = document.createElement("div");
    document.body.appendChild(el);
    const values = new Map([
      ["min-height", "100dvh"],
      ["height", "50vh"],
    ]);
    (el as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) => values.get(property) ?? null,
    });
    const style = readCellStyle(el, 16, metrics);
    expect(style.minHeight).toBe(Math.floor(window.innerHeight / 18));
    expect(style.height).toEqual({
      kind: "cells",
      value: Math.floor(window.innerHeight / 2 / 18),
    });
  });

  it("yields to a resolved keyword from Typed OM: md:h-auto overrides h-screen", () => {
    // At md, Typed OM reads the overriding height as auto, not as px.
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    const el = document.createElement("div");
    el.className = "h-screen md:h-auto";
    document.body.appendChild(el);
    (el as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) => (property === "height" ? "auto" : null),
    });
    expect(readCellStyle(el, 16, metrics).height).toBeUndefined();
  });
});

describe("sizing fallbacks", () => {
  it("reads inline width/height in px, %, and auto", () => {
    expect(read({ style: "width: 80px" }).width).toEqual({ kind: "cells", value: 20 });
    expect(read({ style: "width: 50%" }).width).toEqual({ kind: "percent", value: 50 });
    expect(read({ style: "width: auto" }).width).toBeUndefined();
    expect(read({ style: "height: 12px" }).height).toEqual({ kind: "cells", value: 3 });
  });

  it("detects intrinsic keyword utilities via class scan, variants included", () => {
    expect(read({ class: "w-min" }).width).toEqual({ kind: "min-content" });
    expect(read({ class: "md:w-max" }).width).toEqual({ kind: "max-content" });
    expect(read({ class: "hover:w-fit" }).width).toEqual({ kind: "fit-content" });
    expect(read({ class: "h-min" }).height).toEqual({ kind: "min-content" });
  });

  it("treats an element without sizing utilities or inline size as auto", () => {
    expect(read({ class: "border px-2 text-red-500" }).width).toBeUndefined();
  });

  it("reads inline intrinsic keywords too", () => {
    expect(read({ style: "width: fit-content" }).width).toEqual({ kind: "fit-content" });
  });

  it("reads an inline size in any unit as its computed value has it", () => {
    // rem on the root font size, em on the element's, in at 96px.
    expect(read({ style: "height: 0.25rem" }).height).toEqual({ kind: "cells", value: 1 });
    expect(read({ style: "width: 2.5rem" }).width).toEqual({ kind: "cells", value: 10 });
    expect(read({ style: "height: 2em" }).height).toEqual({ kind: "cells", value: 8 });
    expect(read({ style: "width: 1in" }).width).toEqual({ kind: "cells", value: 24 });
    expect(read({ style: "height: calc(1em + 4px)" }).height).toEqual({ kind: "cells", value: 5 });
    // A percentage beside a length has no size of its own, as with Typed OM.
    expect(read({ style: "width: calc(50% + 1rem)" }).width).toBeUndefined();
  });

  it("takes the used px for a unit whose basis is the font's glyphs", () => {
    // `.used` stands in for the px a real pre-157 Firefox resolves `ch` to.
    const sheet = document.createElement("style");
    sheet.textContent = ".used { height: 48px !important }";
    document.head.appendChild(sheet);
    try {
      expect(read({ class: "used", style: "height: 3ch" }).height).toEqual({
        kind: "cells",
        value: 12,
      });
    } finally {
      sheet.remove();
    }
  });

  it("detects percent utilities via class scan (used px would mislead)", () => {
    expect(read({ class: "w-1/2" }).width).toEqual({ kind: "percent", value: 50 });
    expect(read({ class: "md:w-2/3" }).width).toEqual({ kind: "percent", value: (100 * 2) / 3 });
    expect(read({ class: "w-full" }).width).toEqual({ kind: "percent", value: 100 });
    expect(read({ class: "w-[33%]" }).width).toEqual({ kind: "percent", value: 33 });
    expect(read({ class: "h-1/4" }).height).toEqual({ kind: "percent", value: 25 });
    // Not percents: w-fit already matched, w-4 is the used-px path.
    expect(read({ class: "w-fit" }).width).toEqual({ kind: "fit-content" });
  });

  it("reads size-* on both axes, every form", () => {
    const square = read({ class: "size-5 bg-red-500" });
    expect(square.width).toEqual({ kind: "cells", value: 5 });
    expect(square.height).toEqual({ kind: "cells", value: 5 });
    expect(read({ class: "md:size-full" }).height).toEqual({ kind: "percent", value: 100 });
    expect(read({ class: "size-1/2" }).width).toEqual({ kind: "percent", value: 50 });
    expect(read({ class: "size-fit" }).height).toEqual({ kind: "fit-content" });
    expect(read({ class: "size-[40%]" }).width).toEqual({ kind: "percent", value: 40 });
    // A viewport size lands on the physical path like `h-dvh`.
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    expect(read({ class: "size-dvh" }, metrics).height).toEqual({
      kind: "cells",
      value: Math.floor(window.innerHeight / 18),
    });
  });
});

describe("margin fallbacks", () => {
  it("detects auto margins via class scan (the used-value trap workaround)", () => {
    const m = read({ class: "mx-auto" }).margin;
    expect(m.left).toBeNull();
    expect(m.right).toBeNull();
    expect(m.top).toBe(0);
  });

  it("matches logical and variant-prefixed auto utilities", () => {
    expect(read({ class: "md:ms-auto" }).margin.left).toBeNull();
    expect(read({ class: "me-auto" }).margin.right).toBeNull();
    expect(read({ class: "[&_p]:my-auto" }).margin.top).toBeNull();
  });

  it("reads numeric and negative inline margins on the cell scale", () => {
    const m = read({ style: "margin-left: 8px; margin-top: -4px" }).margin;
    expect(m.left).toBe(2);
    expect(m.top).toBe(-1);
  });
});

describe("inset fallbacks", () => {
  it("keeps all sides auto without inset utilities or inline insets", () => {
    expect(read({ class: "absolute" }).insets).toEqual({
      top: null,
      right: null,
      bottom: null,
      left: null,
    });
  });

  it("reads inline insets, negative and percent included", () => {
    const insets = read({ style: "position: relative; top: 4px; left: -8px; bottom: 50%" }).insets;
    expect(insets.top).toBe(1);
    expect(insets.left).toBe(-2);
    expect(insets.bottom).toEqual({ percent: 50 });
    expect(insets.right).toBeNull();
  });

  it("reads inline insets in any unit as their computed px", () => {
    const insets = read({
      style: "position: absolute; top: 0.5rem; left: -1em; bottom: 10vh; right: 1in",
    }).insets;
    expect(insets.top).toBe(2);
    expect(insets.left).toBe(-4);
    // A viewport length on the spacing scale, as Typed OM's px reads.
    expect(insets.bottom).toBe(Math.round((0.1 * window.innerHeight) / 4));
    expect(insets.right).toBe(24);
  });
});

describe("grid typography", () => {
  it("reads tracking as extra cells over the root's letter-spacing", () => {
    const metrics = { width: 8, height: 16, letterSpacing: 0.4 };
    // (1.2 − 0.4) / 0.4 = 2 extra cells; without the root baseline, 3.
    expect(read({ style: "letter-spacing: 1.2px" }, metrics).tracking).toBe(2);
    expect(read({ style: "letter-spacing: 1.2px" }).tracking).toBe(3);
    // Inheriting the root's own letter-spacing adds nothing.
    expect(read({ style: "letter-spacing: 0.4px" }, metrics).tracking).toBe(0);
  });

  it("reads leading as gap rows over the font size (unitless ratios keep CSS meaning)", () => {
    // Line-height is normalized against font-size, not cell-height —
    // so an authored `leading-loose` (2em) stays 2 rows per line
    // (1 gap) regardless of the cell height the root ends up with
    // under `line-height: normal`.
    // 48px ÷ default 16px font-size = 3 rows per line, 2 gaps.
    expect(read({ style: "line-height: 48px" }).lineGap).toBe(2);
    // Same line-height at a larger font: 48 ÷ 24 = 2 rows per line, 1 gap.
    expect(read({ style: "font-size: 24px; line-height: 48px" }).lineGap).toBe(1);
  });

  it("shares glyph sets read alike, forgetting them past a bound", () => {
    const shadowed = (shadow: string) =>
      readGlyph({
        getPropertyValue: (property: string) => (property === "text-shadow" ? shadow : ""),
      } as CSSStyleDeclaration);
    const first = shadowed("red 0px 0px 2px");
    expect(shadowed("red 0px 0px 2px")).toBe(first);
    // An animation's values are endless.
    for (let i = 0; i < 1000; i++) shadowed(`blue ${i}px 0px 2px`);
    expect(shadowed("red 0px 0px 2px")).not.toBe(first);
  });
});

describe("aspect ratio (specs/cell-model.md)", () => {
  const ratio = (value: string, metrics?: CellMetrics) =>
    read({ style: `aspect-ratio: ${value}` }, metrics).aspectRatio;

  it("reads columns per row through the measured cell", () => {
    expect(ratio("16 / 9", { width: 8, height: 16, letterSpacing: 0 })).toBeCloseTo(32 / 9);
    expect(ratio("1 / 1", { width: 16, height: 16, letterSpacing: 0 })).toBe(1);
    expect(ratio("auto 4 / 3", { width: 10, height: 20, letterSpacing: 0 })).toBeCloseTo(8 / 3);
    expect(ratio("2")).toBe(4);
  });

  it("leaves a table's cells and rows without one", () => {
    const table = document.createElement("table");
    table.innerHTML = '<tr style="aspect-ratio: 2"><td style="aspect-ratio: 2">x</td></tr>';
    table.style.aspectRatio = "2";
    document.body.appendChild(table);
    const [row, cell] = [table.querySelector("tr")!, table.querySelector("td")!];
    expect(readCellStyle(table, 16).aspectRatio).toBe(4);
    expect(readCellStyle(row, 16).aspectRatio).toBeNull();
    expect(readCellStyle(cell, 16).aspectRatio).toBeNull();
  });

  it("takes the 1:2 cell without metrics, and none for auto or a zero term", () => {
    expect(ratio("1 / 1")).toBe(2);
    expect(ratio("auto")).toBeNull();
    expect(ratio("0 / 1")).toBeNull();
    expect(read({}).aspectRatio).toBeNull();
  });
});

describe("plain computed reads (shared with the Typed OM path)", () => {
  it("maps position values, defaulting to static", () => {
    expect(read({ style: "position: sticky" }).position).toBe("sticky");
    expect(read({}).position).toBe("static");
  });

  it("reads min/max limits with percent kept symbolic", () => {
    const style = read({ style: "min-width: 16px; max-width: 100%" });
    expect(style.minWidth).toBe(4);
    expect(style.maxWidth).toEqual({ percent: 100 });
    expect(style.maxHeight).toBeUndefined();
  });

  it("keeps flex-basis percentages symbolic (flex-1 reads as 0%)", () => {
    expect(read({ style: "flex-basis: 0%" }).flexBasis).toEqual({ kind: "percent", value: 0 });
    expect(read({ style: "flex-basis: auto" }).flexBasis).toBeUndefined();
    expect(read({ style: "flex-basis: content" }).flexBasis).toEqual({ kind: "max-content" });
    expect(read({ style: "flex-basis: 24px" }).flexBasis).toEqual({ kind: "cells", value: 6 });
  });

  it("reads percent gaps symbolically and normal as 0", () => {
    const style = read({ style: "column-gap: 50%; row-gap: 8px" });
    expect(style.gapX).toEqual({ percent: 50 });
    expect(style.gapY).toBe(2);
  });

  it("maps white-space and text-overflow", () => {
    const style = read({ style: "white-space: nowrap; text-overflow: ellipsis" });
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("honors center, blocks justify — via computed text-align and the align attribute", () => {
    // Computed detection is echo-safe: the forced-start rule is
    // measuring-gated, so the read sees the authored value.
    expect(read({ style: "text-align: center" }).textAlign).toBe("center");
    expect(read({ style: "text-align: center" }).textAlignBlocked).toBe(false);
    expect(read({ style: "text-align: justify" }).textAlignBlocked).toBe(true);
    expect(read({ style: "text-align: end" }).textAlign).toBe("end");
    const el = document.createElement("td");
    el.setAttribute("align", "CENTER");
    document.body.appendChild(el);
    expect(readCellStyle(el, 16).textAlign).toBe("center");
  });

  it("warns once per element on authored font sizes, colors excluded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const cls of [
        "text-lg",
        "md:text-2xl",
        "text-xl/8",
        "text-[17px]",
        "text-[length:var(--s)]",
      ]) {
        warn.mockClear();
        read({ class: cls });
        expect(warn, cls).toHaveBeenCalledOnce();
      }
      warn.mockClear();
      read({ style: "font-size: 20px" });
      expect(warn).toHaveBeenCalledOnce();

      warn.mockClear();
      const el = document.createElement("div");
      el.setAttribute("class", "text-lg");
      document.body.appendChild(el);
      readCellStyle(el, 16);
      readCellStyle(el, 16);
      expect(warn).toHaveBeenCalledOnce();

      warn.mockClear();
      for (const cls of [
        "text-red-500",
        "text-center",
        "text-[#fab]",
        "text-balance",
        "text-xl-legacy",
      ]) {
        read({ class: cls });
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("calc() spacing lengths", () => {
  it("keeps a percentage symbolic beside cells: an inset short of the scrollport", () => {
    expect(read({ style: "position: sticky; top: calc(100% - 1rem)" }).insets.top).toEqual({
      percent: 100,
      cells: -4,
    });
    expect(read({ style: "position: relative; left: calc(50% + 8px)" }).insets.left).toEqual({
      percent: 50,
      cells: 2,
    });
    expect(read({ style: "position: relative; top: calc(2rem - 4px)" }).insets.top).toBe(7);
    expect(read({ style: "position: relative; top: calc(100% + 0px)" }).insets.top).toEqual({
      percent: 100,
    });
    expect(read({ style: "margin-top: calc(50% + 1rem)" }).margin.top).toEqual({
      percent: 50,
      cells: 4,
    });
  });

  it("reads a percentage inset utility from the class list, the used px having resolved it", () => {
    expect(read({ class: "sticky top-[calc(100%-(--spacing(2)))]" }).insets.top).toEqual({
      percent: 100,
      cells: -2,
    });
    expect(read({ class: "absolute inset-y-[calc(50%_+_1rem)]" }).insets.bottom).toEqual({
      percent: 50,
      cells: 4,
    });
    expect(read({ class: "relative top-1/2" }).insets.top).toEqual({ percent: 50 });
    expect(read({ class: "relative -left-1/4" }).insets.left).toEqual({ percent: -25 });
    expect(read({ class: "absolute inset-x-full" }).insets.right).toEqual({ percent: 100 });
    expect(read({ class: "absolute top-[10%]" }).insets.top).toEqual({ percent: 10 });
    // The canonical negative keeps its sign inside the brackets.
    expect(read({ class: "absolute top-[-50%]" }).insets.top).toEqual({ percent: -50 });
    // Logical sides, horizontal and left-to-right.
    expect(read({ class: "absolute inset-s-[10%]" }).insets.left).toEqual({ percent: 10 });
    expect(read({ class: "absolute -inset-e-1/2" }).insets.right).toEqual({ percent: -50 });
    expect(read({ class: "absolute inset-bs-full" }).insets.top).toEqual({ percent: 100 });
    expect(read({ class: "absolute inset-be-[25%]" }).insets.bottom).toEqual({ percent: 25 });
  });

  it("reads an axis inset utility on its own axis alone", () => {
    // Without the Typed OM a positioned box's `auto` sides read as USED
    // distances, so a side counts only where a utility authors it —
    // `.used` stands in for those, as a real pre-157 Firefox reports
    // them. An `inset-y` utility must leave the x axis alone, or the
    // box stretches between a real left and a used right.
    const sheet = document.createElement("style");
    sheet.textContent = ".used { right: 480px; bottom: 240px }";
    document.head.appendChild(sheet);
    expect(read({ class: "absolute inset-y-0 left-0 used" }).insets.right).toBeNull();
    expect(read({ class: "absolute inset-x-0 top-0 used" }).insets.bottom).toBeNull();
    // A logical side utility authors its own side alone.
    expect(read({ class: "absolute inset-s-0 top-0 used" }).insets.right).toBeNull();
    expect(read({ class: "absolute inset-s-0 top-0 used" }).insets.bottom).toBeNull();
    expect(read({ class: "absolute inset-bs-0 left-0 used" }).insets.bottom).toBeNull();
    expect(read({ class: "absolute inset-bs-0 left-0 used" }).insets.right).toBeNull();
    // `inset` itself authors every side.
    expect(read({ class: "absolute inset-0 used" }).insets.right).not.toBeNull();
    expect(read({ class: "absolute inset-0 used" }).insets.bottom).not.toBeNull();
    sheet.remove();
  });
});

describe("mixed-unit calc()", () => {
  const metrics = { width: 9, height: 18, letterSpacing: 0 };
  const rows = Math.floor(window.innerHeight / 18);

  it("evaluates each term by its own unit: viewport rows minus spacing cells", () => {
    // 100vh → the rows that fit (floor, like h-screen); --spacing(2) → 2
    // cells; the single computed px could not tell the two apart.
    expect(read({ class: "max-h-[calc(100vh-(--spacing(2)))]" }, metrics).maxHeight).toBe(rows - 2);
    expect(read({ class: "max-h-[calc(100vh_-_--spacing(2))]" }, metrics).maxHeight).toBe(rows - 2);
    expect(read({ class: "min-h-[calc(50vh+2rem)]" }, metrics).minHeight).toBe(
      Math.floor(window.innerHeight / 2 / 18) + 8,
    );
  });

  it("reads inline calc() and sizes, with rem and px on the spacing scale", () => {
    // 2rem = 8 cells, 4px = 1 cell at a 16px root; 3 * 0.5rem = 6 cells.
    expect(read({ style: "max-height: calc(2rem + 4px)" }, metrics).maxHeight).toBe(9);
    expect(read({ class: "h-[calc(3*0.5rem)]" }, metrics).height).toEqual({
      kind: "cells",
      value: 6,
    });
    expect(read({ class: "w-[calc((100vw-2rem)/2)]" }, metrics).width).toEqual({
      kind: "cells",
      value: Math.round((Math.floor(window.innerWidth / 9) - 8) / 2),
    });
  });

  it("leaves terms it does not model to the computed value", () => {
    // A percentage needs a layout basis: no per-term answer, so the
    // (here absent) computed value decides.
    expect(read({ class: "max-h-[calc(100%-2rem)]" }, metrics).maxHeight).toBeUndefined();
  });

  it("yields to a resolved keyword: an inactive variant leaves max-height at none", () => {
    // The stylesheet stands in for the browser below `md`: the utility
    // did not apply, so the computed `none` (not the class) is the truth
    // — for a calc and for a viewport utility alike.
    const sheet = document.createElement("style");
    sheet.textContent = ".below-md { max-height: none; }";
    document.head.appendChild(sheet);
    try {
      expect(
        read({ class: "below-md md:max-h-[calc(100vh-2rem)]" }, metrics).maxHeight,
      ).toBeUndefined();
      expect(read({ class: "below-md md:max-h-screen" }, metrics).maxHeight).toBeUndefined();
    } finally {
      sheet.remove();
    }
  });

  it("yields to an inline viewport length, which wins by cascade", () => {
    // Typed OM resolves the inline 90vh to px: near enough the class's
    // calc to pass its active-check, which must not come first.
    const el = document.createElement("div");
    el.className = "max-h-[calc(100vh-2rem)]";
    el.style.maxHeight = "90vh";
    document.body.appendChild(el);
    (el as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) =>
        property === "max-height" ? `${0.9 * window.innerHeight}px` : null,
    });
    expect(readCellStyle(el, 16, metrics).maxHeight).toBe(
      Math.floor((0.9 * window.innerHeight) / 18),
    );
  });
});

describe("float and clear (specs/float.md)", () => {
  it("reads the sides, and none on an out-of-flow box", () => {
    expect(read({ style: "float: left" }).float).toBe("left");
    expect(read({ style: "float: right; clear: both" })).toMatchObject({
      float: "right",
      clear: "both",
    });
    expect(read({}).float).toBe("none");
    // CSS computes `float: none` on an out-of-flow box.
    expect(read({ style: "float: left; position: absolute" }).float).toBe("none");
    expect(read({ style: "float: left; position: fixed" }).float).toBe("none");
    // Its `clear` stays readable; layout ignores it off the block flow.
    expect(read({ style: "clear: left; position: absolute" }).clear).toBe("left");
  });
});

describe('stacking context triggers (specs/positioning.md "Paint order")', () => {
  it("reads each property that forms one, a layer effect's identity included", () => {
    for (const trigger of [
      "isolation: isolate",
      "mix-blend-mode: multiply",
      "perspective: 100px",
      "transform-style: preserve-3d",
      "clip-path: inset(0px)",
      "mask-image: linear-gradient(black, black)",
      "contain: paint",
      "contain: layout",
      "contain: strict",
      "contain: content",
      "will-change: transform",
      "will-change: top, opacity",
      "transform: matrix(1, 0, 0, 1, 0, 0)",
      "scale: 1",
      "translate: 0px",
      "filter: blur(0px)",
      "backdrop-filter: blur(0px)",
    ]) {
      expect(read({ style: trigger }).stacking, trigger).toBe(true);
    }
  });

  it("forms none on the properties that leave the box in its parent's context", () => {
    for (const style of [
      "",
      "container-type: inline-size",
      "container-type: size",
      "will-change: top",
      "contain: size",
      "isolation: auto",
      "mix-blend-mode: normal",
      "z-index: 5",
      "opacity: 0.5",
    ]) {
      expect(read({ style }).stacking, style).toBe(false);
    }
  });
});

describe("alignment keywords", () => {
  it("reads an overflow position beside the keyword", () => {
    // justify-center-safe, items-end-safe, justify-items-end-safe
    expect(read({ style: "justify-content: safe center" })).toMatchObject({
      justifyContent: "center",
      justifyContentSafe: true,
    });
    expect(read({ style: "align-items: safe flex-end" })).toMatchObject({
      alignItems: "flex-end",
      alignItemsSafe: true,
    });
    expect(read({ style: "justify-items: safe end" })).toMatchObject({
      justifyItems: "end",
      justifyItemsSafe: true,
    });
    expect(read({ style: "align-content: unsafe center" })).toMatchObject({
      alignContent: "center",
      alignContentSafe: false,
    });
    expect(read({ style: "justify-content: flex-end" })).toMatchObject({
      justifyContent: "flex-end",
      justifyContentSafe: false,
    });
  });

  it("reads start and end apart from flex-start and flex-end", () => {
    // place-items-start, items-start, self-start
    expect(read({ style: "align-items: start" }).alignItems).toBe("start");
    expect(read({ style: "align-items: flex-start" }).alignItems).toBe("flex-start");
    expect(read({ style: "align-self: self-end" }).alignSelf).toBe("end");
    expect(read({ style: "justify-content: left" }).justifyContent).toBe("start");
  });

  it("reads left and right as start off the inline axis", () => {
    const column = "display: flex; flex-direction: column; justify-content:";
    expect(read({ style: `${column} right` }).justifyContent).toBe("start");
    expect(read({ style: `${column} left` }).justifyContent).toBe("start");
    expect(read({ style: "display: flex; justify-content: right" }).justifyContent).toBe("end");
    // A grid's columns run on the inline axis, whatever its `flex-direction`.
    const grid = "display: grid; flex-direction: column; justify-content: right";
    expect(read({ style: grid }).justifyContent).toBe("end");
  });

  it("reads a safe self-alignment as its keyword, not the start", () => {
    // self-center-safe, justify-self-end-safe
    expect(read({ style: "align-self: safe center" })).toMatchObject({
      alignSelf: "center",
      alignSelfSafe: true,
    });
    expect(read({ style: "justify-self: safe flex-end" })).toMatchObject({
      justifySelf: "flex-end",
      justifySelfSafe: true,
    });
  });

  it("reads a baseline as itself, safe, and legacy as its keyword", () => {
    expect(read({ style: "align-items: baseline" })).toMatchObject({
      alignItems: "baseline",
      alignItemsSafe: true,
    });
    expect(read({ style: "align-self: last baseline" })).toMatchObject({
      alignSelf: "last baseline",
      alignSelfSafe: true,
    });
    expect(read({ style: "justify-items: legacy center" }).justifyItems).toBe("center");
    expect(read({ style: "justify-items: legacy" }).justifyItems).toBe("stretch");
  });

  it("warns once on a value it cannot read, which reads as the initial value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const style = read({ style: "align-self: sideways; justify-content: sideways" });
      expect(style.alignSelf).toBe("auto");
      expect(style.justifyContent).toBe("stretch");
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockClear();
      read({ style: "align-self: safe center; justify-items: legacy left" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
