import { describe, expect, it } from "vitest";
import {
  alignPair,
  colorAlpha,
  compositeColors,
  mixColors,
  parseColor,
  prepareColor,
  serializeColor,
} from "../src/color.ts";
import type { ColorSpace, HueMode, Rgba } from "../src/color.ts";
import { layoutRoot } from "../src/layout.ts";
import { paintGrid } from "../src/paint.ts";
import { applyCellPaint, renderCellSegments } from "../src/plain-text.ts";
import type { CellSegment } from "../src/plain-text.ts";
import { readCellStyle } from "../src/style.ts";
import type { CellStyle, Gradient, GradientStop, LayoutNode } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Gradients (specs/gradients.md): the read of `background-image` in
 * the forms the engines serialize (recorded 2026-09-12 from Tailwind's
 * utilities in Chromium, Firefox, and WebKit), and the color math. */

const read = (backgroundImage: string): Gradient[] => {
  const el = document.createElement("div");
  el.setAttribute("style", `background-image: ${backgroundImage}`);
  document.body.appendChild(el);
  return readCellStyle(el, 16).backgroundImage;
};
const rgb = (color: string): string => serializeColor(parseColor(color)!);
const CYAN = "oklch(0.715 0.143 215.221)";
const BLUE = "oklch(0.546 0.245 262.881)";
// Outside sRGB.
const EMERALD_400 = "oklch(0.765 0.177 163.223)";
const YELLOW_400 = "oklch(0.852 0.199 91.936)";
const GRAY_800 = "oklch(0.278 0.033 256.848)";
const BLUE_500 = "oklch(0.623 0.214 259.815)";

describe("background-image read", () => {
  it("reads Tailwind's linear presets: side, angle, corner, stop positions", () => {
    const [toRight] = read(`linear-gradient(to right, ${CYAN} 0%, ${BLUE} 100%)`);
    expect(toRight).toMatchObject({
      kind: "linear",
      repeating: false,
      space: "oklab",
      direction: { toX: 1, toY: 0 },
    });
    expect(toRight!.stops.map((stop) => stop.position)).toEqual([{ fraction: 0 }, { fraction: 1 }]);
    // Tailwind v4's cyan-500 and blue-600 in sRGB, through oklch.
    expect(serializeColor(toRight!.stops[0]!.color)).toBe("color(srgb -0.23018 0.72187 0.85734)");
    expect(serializeColor(toRight!.stops[1]!.color)).toBe("rgb(21 93 252)");
    expect(read(`linear-gradient(45deg, ${CYAN} 0%, ${BLUE} 100%)`)[0]).toMatchObject({
      direction: { angle: 45 },
    });
    const [corner] = read(
      `linear-gradient(to right bottom, ${CYAN} 0%, ${BLUE} 50%, ${CYAN} 100%)`,
    );
    expect(corner).toMatchObject({ direction: { toX: 1, toY: 1 } });
    expect(corner!.stops).toHaveLength(3);
    expect(corner!.stops[1]!.position).toEqual({ fraction: 0.5 });
    expect(
      read(`linear-gradient(to right, ${CYAN} 10%, ${BLUE} 90%)`)[0]!.stops[0]!.position,
    ).toEqual({ fraction: 0.1 });
    expect(read(`linear-gradient(${CYAN}, ${BLUE})`)[0]).toMatchObject({
      direction: { angle: 180 },
    });
  });

  it("names the space: as written, else oklab, or srgb for legacy colors alone", () => {
    expect(read(`linear-gradient(to right in srgb, ${CYAN} 0%, ${BLUE} 100%)`)[0]!.space).toBe(
      "srgb",
    );
    expect(
      read(`linear-gradient(to right in oklab, rgba(0, 0, 0, 0) 0%, rgb(255, 255, 255) 100%)`)[0]!
        .space,
    ).toBe("oklab");
    expect(read(`linear-gradient(90deg, rgba(255, 0, 0, 0.5), rgba(0, 0, 0, 0))`)[0]!.space).toBe(
      "srgb",
    );
    expect(read(`linear-gradient(to right, ${CYAN} 0%, rgba(0, 0, 0, 0) 100%)`)[0]!.space).toBe(
      "oklab",
    );
    expect(read(`linear-gradient(in oklch, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      space: "oklch",
      hue: "shorter",
    });
    expect(
      read(`linear-gradient(to right in oklch longer hue, ${CYAN}, ${BLUE})`)[0],
    ).toMatchObject({ space: "oklch", hue: "longer", direction: { toX: 1, toY: 0 } });
    expect(read(`linear-gradient(in hsl decreasing hue, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      space: "hsl",
      hue: "decreasing",
    });
    expect(read(`linear-gradient(in srgb-linear, ${CYAN}, ${BLUE})`)[0]!.space).toBe("srgb-linear");
    expect(read(`linear-gradient(in lab, ${CYAN}, ${BLUE})`)[0]!.space).toBe("oklab");
    // A hint is no color: legacy stops around one keep srgb.
    expect(read(`linear-gradient(rgb(255, 0, 0), 30%, rgb(0, 0, 255))`)[0]!.space).toBe("srgb");
  });

  it("reads background-clip, the border box by default", () => {
    const clip = (css: string) => {
      const el = document.createElement("div");
      el.setAttribute("style", css);
      document.body.appendChild(el);
      return readCellStyle(el, 16).backgroundClip;
    };
    expect(clip("background-clip: text")).toBe("text");
    expect(clip("background-clip: padding-box")).toBe("padding-box");
    expect(clip("background-clip: content-box, text")).toBe("content-box");
    expect(clip("background-clip: border-box")).toBe("border-box");
    expect(clip("")).toBe("border-box");
  });

  it("resolves a currentcolor stop to the element's color", () => {
    const el = document.createElement("div");
    el.setAttribute(
      "style",
      "color: rgb(0, 255, 255); background-image: linear-gradient(to right, currentcolor 0%, rgba(0, 0, 0, 0) 100%)",
    );
    document.body.appendChild(el);
    const [layer] = readCellStyle(el, 16).backgroundImage;
    expect(serializeColor(layer!.stops[0]!.color)).toBe("rgb(0 255 255)");
  });

  it("reads radial shapes, sizes, and positions", () => {
    expect(read(`radial-gradient(${CYAN} 0%, ${BLUE} 100%)`)[0]).toMatchObject({
      kind: "radial",
      shape: "ellipse",
      size: "farthest-corner",
      at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } },
    });
    expect(
      read(`radial-gradient(at 25% 25%, rgb(255, 255, 255) 0%, ${BLUE} 100%)`)[0],
    ).toMatchObject({
      at: { x: { fraction: 0.25 }, y: { fraction: 0.25 } },
    });
    expect(read(`radial-gradient(circle, rgb(255, 255, 255), rgb(0, 0, 0))`)[0]).toMatchObject({
      shape: "circle",
      size: "farthest-corner",
    });
    expect(read(`radial-gradient(closest-side at left top, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      size: "closest-side",
      at: { x: { fraction: 0 }, y: { fraction: 0 } },
    });
    expect(read(`radial-gradient(circle 8px at bottom, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      shape: "circle",
      size: { rx: { cells: 2 }, ry: { cells: 2 } },
      at: { x: { fraction: 0.5 }, y: { fraction: 1 } },
    });
    expect(read(`radial-gradient(8px 50%, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      shape: "ellipse",
      size: { rx: { cells: 2 }, ry: { fraction: 0.5 } },
    });
  });

  it("reads conic angles and positions", () => {
    expect(read(`conic-gradient(${CYAN} 0%, ${BLUE} 50%, ${CYAN} 100%)`)[0]).toMatchObject({
      kind: "conic",
      from: 0,
      at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } },
    });
    expect(read(`conic-gradient(from 180deg at 0% 100%, ${CYAN}, ${BLUE})`)[0]).toMatchObject({
      from: 180,
      at: { x: { fraction: 0 }, y: { fraction: 1 } },
    });
    expect(read(`conic-gradient(from 0.5turn, ${CYAN}, ${BLUE})`)[0]).toMatchObject({ from: 180 });
    // Angle positions are fractions of the turn.
    expect(
      read(
        `conic-gradient(rgb(255, 0, 0) 0deg, rgb(0, 0, 255) 180deg, rgb(255, 0, 0) 1turn)`,
      )[0]!.stops.map((stop) => stop.position),
    ).toEqual([{ fraction: 0 }, { fraction: 0.5 }, { fraction: 1 }]);
  });

  it("reads layers in order, drops what is no gradient, and keeps repeating forms", () => {
    const layers = read(
      `linear-gradient(90deg, rgba(255, 0, 0, 0.5), rgba(0, 0, 0, 0)), radial-gradient(circle, rgb(255, 255, 255), rgb(0, 0, 0))`,
    );
    expect(layers.map((layer) => layer.kind)).toEqual(["linear", "radial"]);
    expect(layers[0]!.stops.map((stop) => stop.position)).toEqual([null, null]);
    expect(read(`url("http://localhost/nothing.png")`)).toEqual([]);
    expect(read("none")).toEqual([]);
    expect(read(`url("x.png"), linear-gradient(${CYAN}, ${BLUE})`)).toHaveLength(1);
    expect(read(`linear-gradient(${CYAN})`)).toEqual([]);
    expect(read(`repeating-linear-gradient(45deg, ${CYAN} 0%, ${BLUE} 25%)`)[0]!.repeating).toBe(
      true,
    );
  });

  it("reads hints, double positions, and px positions on the spacing scale", () => {
    const [hinted] = read(`linear-gradient(rgb(255, 0, 0), 30%, rgb(0, 0, 255))`);
    expect(hinted!.stops).toHaveLength(2);
    expect(hinted!.stops[0]!.hint).toEqual({ fraction: 0.3 });
    const [doubled] = read(`linear-gradient(rgb(255, 0, 0) 10% 20%, rgb(0, 0, 255) 8px)`);
    expect(doubled!.stops.map((stop) => stop.position)).toEqual([
      { fraction: 0.1 },
      { fraction: 0.2 },
      { cells: 2 },
    ]);
  });
});

describe("colors", () => {
  it("parses the computed forms to sRGB", () => {
    expect(rgb("rgb(255, 0, 0)")).toBe("rgb(255 0 0)");
    expect(rgb("rgba(255, 0, 0, 0.5)")).toBe("rgb(255 0 0 / 0.5)");
    expect(rgb("rgb(255 0 0 / 25%)")).toBe("rgb(255 0 0 / 0.25)");
    expect(rgb("oklab(0 0 0)")).toBe("rgb(0 0 0)");
    expect(rgb("oklch(1 0 0)")).toBe("rgb(255 255 255)");
    expect(rgb("oklch(0.637 0.237 25.331)")).toBe("rgb(251 44 54)");
    expect(rgb("color(srgb 1 0 0.5)")).toBe("rgb(255 0 128)");
    expect(rgb("color(srgb-linear 0.5 0 0)")).toBe("rgb(188 0 0)");
    expect(rgb("transparent")).toBe("rgb(0 0 0 / 0)");
    expect(parseColor("var(--mw-fg)")).toBeNull();
    expect(parseColor("red")).toBeNull();
    // A form the parser cannot read is taken as opaque, a written alpha
    // too: engines serialize every color as one it reads.
    expect(colorAlpha("color(rec2020 0.6 0.4 0.2 / 0.5)")).toBe(0.5);
    expect(colorAlpha("var(--mw-fg)")).toBe(1);
    expect(colorAlpha("hsl(200 50% 50% / 0.25)")).toBe(1);
  });

  it("parses lab(), lch(), display-p3 and xyz as the browsers convert them to sRGB", () => {
    // Firefox's and WebKit's `color-mix(in srgb, …)` of each, to their
    // six digits: css-color-4's conversions.
    const expectSrgb = (color: string, r: number, g: number, b: number, a = 1) => {
      const parsed = parseColor(color)!;
      for (const [got, want] of [
        [parsed.r, r],
        [parsed.g, g],
        [parsed.b, b],
      ] as const) {
        expect(Math.abs(got - want), color).toBeLessThan(5e-6);
      }
      expect(parsed.a).toBe(a);
    };
    expectSrgb("lab(50 40 30)", 0.734269, 0.344108, 0.276346);
    expectSrgb("lab(50% 40 30)", 0.734269, 0.344108, 0.276346);
    expectSrgb("lab(75 -20 60 / 0.5)", 0.680115, 0.76036, 0.247683, 0.5);
    expectSrgb("lab(10 5 -80)", -0.30915, 0.13419, 0.565955);
    expectSrgb("lab(4 0 0)", 0.0552846, 0.0552846, 0.0552846);
    expectSrgb("lab(100 0 0)", 1, 1, 1);
    expectSrgb("lch(50 60 40)", 0.769217, 0.317044, 0.219645);
    expectSrgb("lch(70 50 250 / 0.25)", 0.199737, 0.717109, 1.00452, 0.25);
    expectSrgb("lch(80 120 90)", 0.902069, 0.768308, -0.307071);
    expectSrgb("color(display-p3 1 0 0)", 1.09307, -0.226742, -0.150135);
    expectSrgb("color(display-p3 0.2 0.4 0.6 / 0.5)", 0.104057, 0.405933, 0.617002, 0.5);
    expectSrgb("color(xyz 0.2 0.3 0.4)", -0.114744, 0.654239, 0.644299);
    expectSrgb("color(xyz-d65 0.5 0.5 0.5)", 0.799209, 0.71806, 0.704423);
    expectSrgb("color(xyz-d50 0.3 0.2 0.1)", 0.7783, 0.337075, 0.375484);
  });

  it("parses a98-rgb, prophoto-rgb and rec2020 as the browsers convert them to sRGB", () => {
    // Firefox's and WebKit's `color-mix(in srgb, …)` of each, to their
    // six digits (css-color-4's transfer functions and matrices): WebKit's
    // where Firefox's D50 adaptation parts at the sixth, and a component
    // past 0..1 extended by its sign as Firefox and Chromium extend it.
    const expectSrgb = (color: string, r: number, g: number, b: number, a = 1) => {
      const parsed = parseColor(color)!;
      for (const [got, want] of [
        [parsed.r, r],
        [parsed.g, g],
        [parsed.b, b],
      ] as const) {
        expect(Math.abs(got - want), color).toBeLessThan(5e-6);
      }
      expect(parsed.a).toBe(a);
    };
    expectSrgb("color(a98-rgb 1 0 0)", 1.158183, 0, 0);
    expectSrgb("color(a98-rgb 0.2 0.6 0.3 / 0.5)", -0.329927, 0.605638, 0.271444, 0.5);
    expectSrgb("color(a98-rgb 0.5 0.5 0.5)", 0.503993, 0.503993, 0.503993);
    expectSrgb("color(a98-rgb -0.2 0.4 1.1)", -0.338367, 0.400621, 1.11445);
    expectSrgb("color(prophoto-rgb 1 0 0)", 1.363293, -0.515663, -0.09013);
    expectSrgb("color(prophoto-rgb 0.4 0.5 0.6)", 0.271023, 0.591387, 0.678214);
    expectSrgb("color(prophoto-rgb 0.7 0.2 0.9 / 25%)", 0.894535, -0.259707, 0.976856, 0.25);
    expectSrgb("color(prophoto-rgb 0.02 0.03 0.01)", 0.012751, 0.02612, 0.005531);
    expectSrgb("color(prophoto-rgb 1 1 1)", 1, 1, 1);
    expectSrgb("color(rec2020 0.6 0.4 0.2)", 0.736612, 0.423677, 0.21524);
    expectSrgb("color(rec2020 1 0 0)", 1.24822, -0.387908, -0.143514);
    expectSrgb("color(rec2020 0.05 0.07 0.02)", 0.093099, 0.134338, 0.041397);
    expectSrgb("color(rec2020 0.3 0.8 0.5 / 0.75)", -0.506488, 0.859585, 0.510902, 0.75);
    expectSrgb("color(rec2020 -0.1 0.5 0.5)", -0.49439, 0.579256, 0.551499);
  });

  const black = parseColor("rgb(0, 0, 0)")!;
  const white = parseColor("rgb(255, 255, 255)")!;
  const mix = (from: Rgba, to: Rgba, t: number, space: ColorSpace): string =>
    serializeColor(mixColors(prepareColor(from, space), prepareColor(to, space), t, space));

  it("mixes in each space with alpha premultiplied, and composites", () => {
    expect(mix(black, white, 0.5, "srgb")).toBe("rgb(128 128 128)");
    // OKLab's mid-lightness grey sits darker in sRGB.
    expect(mix(black, white, 0.5, "oklab")).toBe("rgb(99 99 99)");
    const clear = parseColor("rgba(0, 0, 0, 0)")!;
    // A fade to transparent keeps the color, as premultiplication does.
    expect(mix(white, clear, 0.5, "srgb")).toBe("rgb(255 255 255 / 0.5)");
    expect(mix(black, white, 0.5, "srgb-linear")).toBe("rgb(188 188 188)");
    expect(mix(black, white, 0.5, "oklch")).toBe("rgb(99 99 99)");
    const red = parseColor("rgba(255, 0, 0, 0.5)")!;
    expect(serializeColor(compositeColors(red, white))).toBe("rgb(255 128 128)");
    expect(serializeColor(compositeColors(clear, white))).toBe("rgb(255 255 255)");
  });

  it("carries a color outside sRGB through the mix, written as color(srgb) past it", () => {
    const emerald = parseColor(EMERALD_400)!;
    // OKLab's own values mixed: the synthesized fade's too.
    expect(mix(emerald, parseColor(GRAY_800)!, 0.25, "oklab")).toBe(
      "color(srgb -0.00758 0.65098 0.48455)",
    );
    const bright = parseColor("color(srgb 1.5 0 0)")!;
    expect(mix(bright, black, 0.75, "srgb")).toBe("rgb(96 0 0)");
    expect(serializeColor(bright)).toBe("color(srgb 1.5 0 0)");
    expect(serializeColor({ ...bright, a: 0.5 })).toBe("color(srgb 1.5 0 0 / 0.5)");
  });

  it("clips each color to sRGB to composite it, as browsers blend on an sRGB screen", () => {
    // Tailwind's yellow-400, its blue −0.27: half over white is the
    // browser's 127 within a unit, where the unclipped blend gives 93.
    const yellow = parseColor(YELLOW_400)!;
    expect(serializeColor(compositeColors({ ...yellow, a: 0.5 }, white))).toBe("rgb(254 227 128)");
    const bright = parseColor("color(srgb 1.5 0 -0.5)")!;
    expect(serializeColor(compositeColors({ ...bright, a: 0.5 }, black))).toBe("rgb(128 0 0)");
    expect(serializeColor(compositeColors({ ...white, a: 0.5 }, bright))).toBe("rgb(255 128 128)");
    // No blend: an opaque color, or one over transparent, as it is.
    const clear = parseColor("rgba(0, 0, 0, 0)")!;
    expect(serializeColor(compositeColors(bright, white))).toBe("color(srgb 1.5 0 -0.5)");
    expect(serializeColor(compositeColors({ ...bright, a: 0.5 }, clear))).toBe(
      "color(srgb 1.5 0 -0.5 / 0.5)",
    );
    // A zero-alpha color is no paint: the color beneath, unclipped.
    expect(serializeColor(compositeColors(clear, bright))).toBe("color(srgb 1.5 0 -0.5)");
  });
});

/** A `width` × `height` box with gradient layers (and a plain color),
 * its text `text`: the grid's background per cell, as `rgb()`. */
const paint = (
  layers: Gradient[],
  width: number,
  height: number,
  style: Partial<CellStyle> = {},
  text = "",
): { colors: (string | undefined)[][]; box: LayoutNode; root: LayoutNode } => {
  const box = makeNode({
    style: {
      width: { kind: "cells", value: width },
      height: { kind: "cells", value: height },
      backgroundImage: layers,
      ...style,
    },
    text,
    intrinsicWidth: text.length,
  });
  const root = makeNode({ children: [box] });
  layoutRoot(root, width);
  const colors = renderCellSegments(root).map((row) => row.flatMap(cellBackgrounds));
  return { colors, box, root };
};
/** A segment's background per cell: its run of backgrounds, or its one. */
const cellBackgrounds = (segment: CellSegment): (string | undefined)[] =>
  segment.backgrounds ?? Array.from(segment.text, () => segment.backgroundColor);
const stop = (color: string, position: number | null = null, hint?: number): GradientStop => ({
  color: parseColor(color)!,
  position: position === null ? null : { fraction: position },
  ...(hint === undefined ? {} : { hint: { fraction: hint } }),
});
const BLACK = "rgb(0, 0, 0)";
const WHITE = "rgb(255, 255, 255)";
const linear = (
  direction: Extract<Gradient, { kind: "linear" }>["direction"],
  stops: GradientStop[],
  space: ColorSpace = "srgb",
  repeating = false,
): Gradient => ({ kind: "linear", repeating, space, hue: "shorter", stops, direction });
const grey = (value: number): string => `rgb(${value} ${value} ${value})`;

describe("hue modes", () => {
  const red = parseColor("rgb(255, 0, 0)")!;
  const blue = parseColor("rgb(0, 0, 255)")!;
  const midway = (space: ColorSpace, hue: HueMode): string => {
    const layer = {
      ...linear({ toX: 1, toY: 0 }, [stop("rgb(255, 0, 0)"), stop("rgb(0, 0, 255)")], space),
      hue,
    };
    return paint([layer], 2, 1).colors[0]![0]!;
  };
  it("turns a polar space's hue the named way round", () => {
    // Red (0°) to blue (240°) in hsl: the shorter arc runs through
    // magenta, the longer through green.
    const at = (space: ColorSpace, hue: HueMode) => {
      const from = prepareColor(red, space);
      const to = prepareColor(blue, space);
      alignPair(from, to, space, hue);
      return serializeColor(mixColors(from, to, 0.5, space));
    };
    expect(at("hsl", "shorter")).toBe("rgb(255 0 255)");
    expect(at("hsl", "longer")).toBe("rgb(0 255 0)");
    expect(at("hsl", "increasing")).toBe("rgb(0 255 0)");
    expect(at("hsl", "decreasing")).toBe("rgb(255 0 255)");
    expect(at("oklch", "shorter")).not.toBe(at("oklch", "longer"));
    // Through the paint, a quarter of the way.
    expect(midway("hsl", "shorter")).toBe("rgb(255 0 128)");
    expect(midway("hsl", "longer")).toBe("rgb(255 255 0)");
  });

  it("aligns each pair of stops on its own: three stops turn the same way", () => {
    // Red, green, blue decreasing in hsl: each pair turns down through
    // the far side, so the middle of the second pair lands on red.
    const tri = {
      ...linear(
        { toX: 1, toY: 0 },
        [stop("rgb(255, 0, 0)"), stop("rgb(0, 255, 0)"), stop("rgb(0, 0, 255)")],
        "hsl",
      ),
      hue: "decreasing" as const,
    };
    expect(paint([tri], 2, 1).colors).toEqual([["rgb(0 0 255)", "rgb(255 0 0)"]]);
  });

  it("gives a stop without a hue its pair's, pair by pair", () => {
    // Red, white, blue in oklch: the second pair keeps blue's hue,
    // as white to blue alone does.
    const tri = linear(
      { toX: 1, toY: 0 },
      [stop("rgb(255, 0, 0)"), stop(WHITE), stop("rgb(0, 0, 255)")],
      "oklch",
    );
    const duo = linear({ toX: 1, toY: 0 }, [stop(WHITE), stop("rgb(0, 0, 255)")], "oklch");
    expect(paint([tri], 8, 1).colors[0]!.slice(4)).toEqual(paint([duo], 4, 1).colors[0]);
  });

  it("treats white's saturation as missing in hsl, as CSS does", () => {
    const white = parseColor(WHITE)!;
    const red = parseColor("rgb(255, 0, 0)")!;
    const from = prepareColor(white, "hsl");
    const to = prepareColor(red, "hsl");
    alignPair(from, to, "hsl", "shorter");
    expect(serializeColor(mixColors(from, to, 0.5, "hsl"))).toBe("rgb(255 128 128)");
  });
});

describe("gradient paint", () => {
  it("colors each cell at its center along the line: across, down, and diagonal", () => {
    expect(paint([linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])], 4, 1).colors).toEqual([
      [32, 96, 159, 223].map(grey),
    ]);
    expect(paint([linear({ angle: 180 }, [stop(BLACK), stop(WHITE)])], 1, 4).colors).toEqual(
      [32, 96, 159, 223].map((value) => [grey(value)]),
    );
    // A 4×2 box of 1:2 cells is square in px, so `to bottom right` is 45°.
    const diagonal = paint([linear({ toX: 1, toY: 1 }, [stop(BLACK), stop(WHITE)])], 4, 2).colors;
    expect(diagonal[0]![0]).toBe(grey(48));
    expect(diagonal[1]![3]).toBe(grey(207));
    expect(diagonal[0]![3]).toBe(grey(143));
    expect(diagonal[1]![0]).toBe(grey(112));
  });

  it("sizes a radial by its keywords or lengths, a circle round in px", () => {
    const radial = (
      shape: "circle" | "ellipse",
      size: Extract<Gradient, { kind: "radial" }>["size"],
    ): Gradient => ({
      kind: "radial",
      repeating: false,
      space: "srgb",
      hue: "shorter",
      stops: [stop(WHITE), stop(BLACK)],
      shape,
      size,
      at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } },
    });
    expect(paint([radial("circle", "closest-side")], 4, 1).colors).toEqual([
      [0, 128, 128, 0].map(grey),
    ]);
    expect(paint([radial("circle", "farthest-side")], 4, 1).colors).toEqual([
      [64, 191, 191, 64].map(grey),
    ]);
    // A 2-cell radius is 2 cell widths on both axes: round in px.
    const round = radial("circle", { rx: { cells: 2 }, ry: { cells: 2 } });
    expect(paint([round], 4, 2).colors).toEqual([
      [25, 112, 112, 25].map(grey),
      [25, 112, 112, 25].map(grey),
    ]);
  });

  it("reads px positions in cell widths along any line, as every px length", () => {
    const stops = [
      { ...stop(BLACK), position: { cells: 2 } },
      { ...stop(WHITE), position: { cells: 4 } },
    ];
    // Down a 1×4 box of 1:2 cells the line is 8px; 2 and 4 cell widths
    // are 2px and 4px of it.
    expect(paint([linear({ angle: 180 }, stops)], 1, 4).colors).toEqual(
      [0, 128, 255, 255].map((value) => [grey(value)]),
    );
  });

  it("measures the box in the given cell: an angle's line follows the px aspect", () => {
    const layers = [linear({ angle: 45 }, [stop(BLACK), stop(WHITE)])];
    const { root, colors } = paint(layers, 4, 2);
    expect(colors[0]![0]).toBe(grey(112));
    const wide = renderCellSegments(root, { cell: { width: 2, height: 2 } })[0]!;
    expect(cellBackgrounds(wide[0]!)[0]).toBe(grey(85));
  });

  it("radiates from the center through the farthest corner, and sweeps a conic", () => {
    const radial: Gradient = {
      kind: "radial",
      repeating: false,
      space: "srgb",
      hue: "shorter",
      stops: [stop(WHITE), stop(BLACK)],
      shape: "ellipse",
      size: "farthest-corner",
      at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } },
    };
    expect(paint([radial], 4, 1).colors).toEqual([[120, 210, 210, 120].map(grey)]);
    const conic: Gradient = {
      kind: "conic",
      repeating: false,
      space: "srgb",
      hue: "shorter",
      stops: [stop(BLACK), stop(WHITE)],
      from: 0,
      at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } },
    };
    expect(paint([conic], 2, 2).colors).toEqual([
      [grey(236), grey(19)],
      [grey(146), grey(109)],
    ]);
    const cornered: Gradient = {
      ...conic,
      from: 180,
      at: { x: { fraction: 0 }, y: { fraction: 0 } },
    };
    expect(paint([cornered], 2, 1).colors).toEqual([[grey(236), grey(215)]]);
    expect(paint([linear({ toX: -1, toY: 0 }, [stop(BLACK), stop(WHITE)])], 4, 1).colors).toEqual([
      [223, 159, 96, 32].map(grey),
    ]);
  });

  it("resolves stop positions, hints, and repeating forms as CSS does", () => {
    const across = { toX: 1, toY: 0 };
    expect(paint([linear(across, [stop(BLACK, 0.25), stop(WHITE, 0.75)])], 4, 1).colors).toEqual([
      [0, 64, 191, 255].map(grey),
    ]);
    expect(paint([linear(across, [stop(BLACK, null, 0.25), stop(WHITE)])], 4, 1).colors).toEqual([
      [90, 156, 202, 239].map(grey),
    ]);
    expect(
      paint([linear(across, [stop(BLACK, 0), stop(WHITE, 0.5)], "srgb", true)], 4, 1).colors,
    ).toEqual([[64, 191, 64, 191].map(grey)]);
    // Three stops, the middle one unset: spread evenly.
    expect(paint([linear(across, [stop(BLACK), stop(WHITE), stop(BLACK)])], 4, 1).colors).toEqual([
      [64, 191, 191, 64].map(grey),
    ]);
  });

  it("interpolates in the named space", () => {
    const across = { toX: 1, toY: 0 };
    expect(paint([linear(across, [stop(BLACK), stop(WHITE)], "srgb")], 2, 1).colors).toEqual([
      [64, 191].map(grey),
    ]);
    expect(paint([linear(across, [stop(BLACK), stop(WHITE)], "oklab")], 2, 1).colors).toEqual([
      [34, 174].map(grey),
    ]);
    // Stops outside sRGB mix as they are, each cell written unclipped.
    const deep = [stop(EMERALD_400), stop(GRAY_800)];
    expect(paint([linear(across, deep, "oklab")], 2, 1).colors[0]![0]).toBe(
      "color(srgb -0.00758 0.65098 0.48455)",
    );
    // In hsl too: Firefox's cells, Chromium's within a level, as an
    // sRGB screen clips them (probed 2026-09-23).
    const toBlue = [stop(EMERALD_400), stop(BLUE_500)];
    expect(paint([linear(across, toBlue, "hsl")], 4, 1).colors).toEqual([
      [
        "color(srgb -0.19042 0.8984 0.74051)",
        "color(srgb -0.16943 0.9303 1.01575)",
        "color(srgb -0.12941 0.75445 1.11406)",
        "color(srgb 0.06805 0.55527 1.05494)",
      ],
    ]);
    // A lightness past 1 gives a saturation below 0, mixed as it is.
    const glare = [stop("color(srgb 1.5 1.2 0.9)"), stop("rgb(0, 0, 255)")];
    expect(paint([linear(across, glare, "hsl")], 4, 1).colors).toEqual([
      [
        "color(srgb 1.24609 1.029 0.97891)",
        "rgb(230 248 240)",
        "rgb(198 191 198)",
        "rgb(123 77 222)",
      ],
    ]);
  });

  it("composites translucent stops over the plain color, and layers over each other", () => {
    const across = { toX: 1, toY: 0 };
    const fade = linear(across, [stop("rgba(0, 0, 0, 0)"), stop(WHITE)]);
    expect(paint([fade], 2, 1, { backgroundColor: "rgb(255, 0, 0)" }).colors).toEqual([
      ["rgb(255 64 64)", "rgb(255 191 191)"],
    ]);
    // Without a plain color, over a cell no background has reached, a
    // cell keeps its alpha for the browser to composite.
    const bare = renderCellSegments(paint([fade], 2, 1).root, { ground: parseColor(BLACK)! });
    expect(bare[0]!.flatMap(cellBackgrounds)).toEqual([
      "rgb(255 255 255 / 0.25)",
      "rgb(255 255 255 / 0.75)",
    ]);
    const veil = linear(across, [stop("rgba(255, 0, 0, 0.5)"), stop("rgba(255, 0, 0, 0.5)")]);
    const white = linear(across, [stop(WHITE), stop(WHITE)]);
    expect(paint([veil, white], 2, 1).colors).toEqual([["rgb(255 128 128)", "rgb(255 128 128)"]]);
  });

  it("blends a translucent fill over gradient cells, one run of their colors still", () => {
    const layers = [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])];
    const veil = makeNode({
      style: {
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 0 },
        width: { kind: "cells", value: 2 },
        height: { kind: "cells", value: 1 },
        backgroundColor: "rgb(255 255 255 / 0.2)",
      },
    });
    const box = makeNode({
      style: {
        position: "relative",
        width: { kind: "cells", value: 2 },
        height: { kind: "cells", value: 1 },
        backgroundImage: layers,
      },
      children: [veil],
    });
    const root = makeNode({ children: [box] });
    layoutRoot(root, 2);
    const row = renderCellSegments(root)[0]!;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({
      text: "  ",
      gradient: "fill",
      backgrounds: [grey(102), grey(204)],
    });
  });

  it("keeps the fill's colors under a leaf's own text, plain color or not", () => {
    const layers = [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])];
    const plain = paint(layers, 4, 1, { backgroundColor: "rgb(255, 0, 0)" }, "ab");
    expect(plain.colors).toEqual([[32, 96, 159, 223].map(grey)]);
    // A plain color the parser leaves alone still shows under clear cells.
    const clear = linear({ toX: 1, toY: 0 }, [stop("rgba(0, 0, 0, 0)"), stop("rgba(0, 0, 0, 0)")]);
    expect(paint([clear], 2, 1, { backgroundColor: "red" }).colors).toEqual([["red", "red"]]);
  });

  it("clips to the padding or content box, the gradient still the border box's", () => {
    const layers = [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])];
    const sides = { top: 0, right: 1, bottom: 0, left: 1 };
    expect(paint(layers, 4, 1, { backgroundClip: "padding-box", border: sides }).colors).toEqual([
      [undefined, grey(96), grey(159), undefined],
    ]);
    expect(paint(layers, 4, 1, { backgroundClip: "content-box", padding: sides }).colors).toEqual([
      [undefined, grey(96), grey(159), undefined],
    ]);
  });

  it("clips to text: an inline element's opacity blends its glyph's tint as a group", () => {
    // Firefox's rendering: the glyph takes the gradient, then the fade
    // (Chromium draws it whole, WebKit not at all; probed 2026-09-23).
    const layers = [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])];
    const transparent = "rgba(0, 0, 0, 0)";
    const box = makeNode({
      style: {
        width: { kind: "cells", value: 4 },
        height: { kind: "cells", value: 1 },
        backgroundImage: layers,
        backgroundClip: "text",
        color: transparent,
      },
      text: "ab",
      intrinsicWidth: 2,
    });
    box.charInline = [-1, 0];
    box.inlineElements = [
      {
        element: document.createElement("span"),
        tracking: 0,
        padLeft: 0,
        padRight: 0,
        insets: null,
        anchorNames: [],
        color: transparent,
        backgroundColor: undefined,
        fontWeight: "400",
        fontStyle: "normal",
        textDecorationLine: "none",
        visible: true,
        pointerEvents: true,
        opacity: 0.4,
        parent: -1,
      },
    ];
    const root = makeNode({ children: [box] });
    layoutRoot(root, 4);
    // The tint at the span's opacity, 0.4, nothing lying beneath.
    expect(renderCellSegments(root)[0]!.slice(0, 2)).toMatchObject([
      { text: "a", color: grey(32), gradient: "text" },
      { text: "b", color: grey(96), gradient: "text", opacity: 0.4 },
    ]);
  });

  it("clips to text: glyphs take the gradient through a transparent color", () => {
    const layers = [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])];
    const glyphs = (color: string) => {
      const { root } = paint(layers, 4, 1, { backgroundClip: "text", color }, "ab");
      return renderCellSegments(root)[0]!.map((segment) => [
        segment.text,
        segment.colors ?? segment.color,
        segment.backgroundColor,
      ]);
    };
    // One run, its glyphs' colors as hard stops shown through the
    // text; the cells past the text stay bare.
    expect(glyphs("rgba(0, 0, 0, 0)")).toEqual([
      ["ab", [grey(32), grey(96)], undefined],
      ["  ", undefined, undefined],
    ]);
    // An opaque color hides the gradient; a translucent one blends.
    expect(glyphs("rgb(255, 0, 0)")[0]).toEqual(["ab", "rgb(255, 0, 0)", undefined]);
    expect(glyphs("rgba(255, 0, 0, 0.5)")[0]![1]![0]).toBe("rgb(144 16 16)");
    // Past sRGB, the gradient's color shows through unclipped.
    const emerald = [linear({ toX: 1, toY: 0 }, [stop(EMERALD_400), stop(EMERALD_400)])];
    const tinted = paint(
      emerald,
      2,
      1,
      { backgroundClip: "text", color: "rgba(0, 0, 0, 0)" },
      "ab",
    );
    expect(renderCellSegments(tinted.root)[0]![0]).toMatchObject({
      text: "ab",
      color: rgb(EMERALD_400),
    });
    const style = {} as CSSStyleDeclaration;
    applyCellPaint(
      renderCellSegments(
        paint(layers, 4, 1, { backgroundClip: "text", color: "rgba(0, 0, 0, 0)" }, "ab").root,
      )[0]![0]!,
      style,
    );
    expect(style.backgroundClip).toBe("text");
    expect(style.color).toBe("transparent");
    expect(style.backgroundImage).toContain(grey(32));
    // Inside a filled parent the glyphs keep a span each, the parent's
    // color under every one: a clipped run would clip that away.
    const child = makeNode({
      style: {
        width: { kind: "cells", value: 2 },
        height: { kind: "cells", value: 1 },
        backgroundImage: layers,
        backgroundClip: "text",
        color: "rgba(0, 0, 0, 0)",
      },
      text: "ab",
      intrinsicWidth: 2,
    });
    const parent = makeNode({
      style: { backgroundColor: "red", width: { kind: "cells", value: 2 } },
      children: [child],
    });
    const nested = makeNode({ children: [parent] });
    layoutRoot(nested, 2);
    expect(
      renderCellSegments(nested)[0]!.map((segment) => [
        segment.text,
        segment.color,
        segment.backgroundColor,
      ]),
    ).toEqual([
      ["a", grey(64), "red"],
      ["b", grey(191), "red"],
    ]);
    // A plain color clips the same way.
    const { root } = paint(
      [],
      2,
      1,
      { backgroundClip: "text", backgroundColor: "rgb(0, 0, 255)", color: "rgba(0, 0, 0, 0)" },
      "ab",
    );
    // The glyphs take the color and no cell a background.
    expect(renderCellSegments(root)[0]![0]).toEqual({
      text: "ab",
      color: "rgb(0 0 255)",
      gradient: "text",
    });
  });

  it("keeps a bg-clear child's cells out of the parent's gradient run", () => {
    const child = makeNode({
      style: {
        width: { kind: "cells", value: 2 },
        height: { kind: "cells", value: 1 },
        backgroundClear: true,
      },
    });
    const parent = makeNode({
      style: {
        width: { kind: "cells", value: 4 },
        backgroundImage: [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])],
      },
      children: [child],
    });
    const root = makeNode({ children: [parent] });
    layoutRoot(root, 4);
    const row = renderCellSegments(root)[0]!;
    expect(row.map(cellBackgrounds).flat()).toEqual([undefined, undefined, grey(159), grey(223)]);
    for (const segment of row) expect(segment.backgrounds ?? []).not.toContain(undefined);
  });

  it("joins gradient cells alone: plain fills side by side keep their spans", () => {
    const box = (backgroundColor: string) =>
      makeNode({
        style: {
          width: { kind: "cells", value: 2 },
          height: { kind: "cells", value: 1 },
          backgroundColor,
        },
      });
    const row = makeNode({
      style: { display: "flex", width: { kind: "cells", value: 4 } },
      children: [box("red"), box("blue")],
    });
    const root = makeNode({ children: [row] });
    layoutRoot(root, 4);
    expect(renderCellSegments(root)[0]!.map((segment) => segment.backgroundColor)).toEqual([
      "red",
      "blue",
    ]);
  });

  it("keeps the glyphs' own color over the fill", () => {
    const { root } = paint(
      [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])],
      4,
      1,
      { color: "cyan" },
      "ab",
    );
    const segments = renderCellSegments(root)[0]!;
    expect(
      segments.map((segment) => [segment.text, segment.color, cellBackgrounds(segment)]),
    ).toEqual([
      ["ab", "cyan", [grey(32), grey(96)]],
      ["  ", undefined, [grey(159), grey(223)]],
    ]);
  });

  it("paints a run of cell backgrounds as one span with hard stops", () => {
    const { root } = paint([linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])], 4, 1);
    const [run] = renderCellSegments(root)[0]!;
    expect(run!.backgroundColor).toBeUndefined();
    // A plain record: happy-dom's style object drops the calc() stops.
    const style = {} as CSSStyleDeclaration;
    applyCellPaint(run!, style);
    expect(style.backgroundImage).toBe(
      "linear-gradient(to right, rgb(32 32 32) 0 calc(var(--mw-cw, 1ch) * 1), rgb(96 96 96) 0 calc(var(--mw-cw, 1ch) * 2), rgb(159 159 159) 0 calc(var(--mw-cw, 1ch) * 3), rgb(223 223 223) 0 calc(var(--mw-cw, 1ch) * 4))",
    );
  });

  it("leaves a run of cell backgrounds unwritten when a repaint changes something else", () => {
    const target = document.createElement("pre");
    const tree = (color: string) => {
      const root = makeNode({
        children: [
          makeNode({
            style: {
              width: { kind: "cells", value: 4 },
              height: { kind: "cells", value: 1 },
              backgroundImage: [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])],
            },
          }),
          makeNode({ style: { color }, text: "ab", intrinsicWidth: 2 }),
        ],
      });
      layoutRoot(root, 4);
      return root;
    };
    paintGrid(tree("red"), target);
    const run = target.querySelector("span")!;
    run.style.setProperty("--kept", "1");
    paintGrid(tree("blue"), target);
    expect(target.querySelector("span")).toBe(run);
    expect(run.style.getPropertyValue("--kept")).toBe("1");
  });

  it("leaves a clear cell to the fill beneath, or wipes it under bg-clear", () => {
    const clear = linear({ toX: 1, toY: 0 }, [stop("rgba(0, 0, 0, 0)"), stop("rgba(0, 0, 0, 0)")]);
    const inside = (style: Partial<CellStyle>): (string | undefined)[] => {
      const child = makeNode({
        style: {
          width: { kind: "cells", value: 2 },
          height: { kind: "cells", value: 1 },
          backgroundImage: [clear],
          ...style,
        },
      });
      const parent = makeNode({
        style: { backgroundColor: "red", width: { kind: "cells", value: 2 } },
        children: [child],
      });
      const root = makeNode({ children: [parent] });
      layoutRoot(root, 2);
      return renderCellSegments(root)[0]!.flatMap((segment) =>
        Array.from(segment.text, () => segment.backgroundColor),
      );
    };
    expect(inside({})).toEqual(["red", "red"]);
    expect(inside({ backgroundClear: true })).toEqual([undefined, undefined]);
  });

  it("inverts a selected cell's own color", () => {
    const { root, box } = paint(
      [linear({ toX: 1, toY: 0 }, [stop(BLACK), stop(WHITE)])],
      4,
      1,
      {},
      "abcd",
    );
    const selection = new Map([[box, { start: 1, end: 2 }]]);
    const segments = renderCellSegments(root, { selection })[0]!;
    // The selected cell keeps its own span: its colors swap.
    expect(
      segments.map((segment) => [segment.text, cellBackgrounds(segment), segment.selected]),
    ).toEqual([
      ["a", [grey(32)], undefined],
      ["b", [grey(96)], true],
      ["cd", [grey(159), grey(223)], undefined],
    ]);
  });
});
