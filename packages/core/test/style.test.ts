import { describe, expect, it, vi } from "vitest";
import { readCellStyle } from "../src/style.ts";
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
});

describe("sizing fallbacks", () => {
  it("reads inline width/height in px, %, and auto", () => {
    expect(read({ style: "width: 80px" }).width).toEqual({ kind: "cells", value: 20 });
    expect(read({ style: "width: 50%" }).width).toEqual({ kind: "percent", value: 50 });
    expect(read({ style: "width: auto" }).width).toEqual({ kind: "auto" });
    expect(read({ style: "height: 12px" }).height).toEqual({ kind: "cells", value: 3 });
  });

  it("detects intrinsic keyword utilities via class scan, variants included", () => {
    expect(read({ class: "w-min" }).width).toEqual({ kind: "min-content" });
    expect(read({ class: "md:w-max" }).width).toEqual({ kind: "max-content" });
    expect(read({ class: "hover:w-fit" }).width).toEqual({ kind: "fit-content" });
    expect(read({ class: "h-min" }).height).toEqual({ kind: "min-content" });
  });

  it("treats an element without sizing utilities or inline size as auto", () => {
    expect(read({ class: "border px-2 text-red-500" }).width).toEqual({ kind: "auto" });
  });

  it("reads inline intrinsic keywords too", () => {
    expect(read({ style: "width: fit-content" }).width).toEqual({ kind: "fit-content" });
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
});
