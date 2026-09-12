import { describe, expect, it } from "vitest";
import { collectShadowRuns } from "../src/borders.ts";
import type { BorderRun } from "../src/borders.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { readCellStyle } from "../src/style.ts";
import { defaultCellStyle } from "../src/types.ts";
import type { BoxShadow, CellMetrics } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

/** Box shadows (specs/box-shadow.md): the read, and the shades painted
 * behind a box. */

const read = (style: string, metrics?: CellMetrics): BoxShadow[] => {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  document.body.appendChild(el);
  return readCellStyle(el, 16, metrics).boxShadow;
};

/** A bordered 4-wide box at the origin of an 8×5 root, its shadows —
 * three rows around its text, or `height` rows with the text left out. */
const rows = (boxShadow: BoxShadow[], glyphSet: string | null = null, height = 0): string[] => {
  const root = makeNode({
    style: { width: { kind: "cells", value: 8 }, height: { kind: "cells", value: 5 } },
    children: [
      makeNode({
        style: {
          width: { kind: "cells", value: 4 },
          ...(height > 0 ? { height: { kind: "cells", value: height } } : {}),
          border: { top: 1, right: 1, bottom: 1, left: 1 },
          boxShadow,
          glyphSet,
        },
        text: height > 0 ? "" : "ab",
        intrinsicWidth: height > 0 ? 0 : 2,
      }),
    ],
  });
  layoutRoot(root, 8);
  return renderPlainText(root).split("\n");
};
const shadow = (x: number, y: number, blur = 0, spread = 0, color = "red"): BoxShadow => ({
  x,
  y,
  blur,
  spread,
  color,
  inset: false,
});
const inset = (x: number, y: number, blur = 0, spread = 0, color = "red"): BoxShadow => ({
  ...shadow(x, y, blur, spread, color),
  inset: true,
});

describe("box-shadow read", () => {
  it("reads offsets and spread to cells, the blur unrounded, the color, per shadow", () => {
    expect(read("box-shadow: 4px 4px 0 0 red")).toEqual([shadow(1, 1)]);
    expect(
      read("box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 6px -4px, rgba(0, 0, 0, 0.2) 8px 0px"),
    ).toEqual([
      shadow(0, 1, 1.5, -1, "rgba(0, 0, 0, 0.1)"),
      shadow(2, 0, 0, 0, "rgba(0, 0, 0, 0.2)"),
    ]);
  });

  it("converts offsets by the measured cell, a nonzero one at least a cell", () => {
    const metrics = { width: 9, height: 18, letterSpacing: 0 };
    expect(read("box-shadow: 0px 20px 25px -5px red", metrics)).toEqual([shadow(0, 1, 6.25, -1)]);
    expect(read("box-shadow: 4px 4px 0 0 red", metrics)).toEqual([shadow(1, 1)]);
    expect(read("box-shadow: -30px 40px 0 0 red", metrics)).toEqual([shadow(-3, 2)]);
  });

  it("keeps the inset keyword and reads none as none", () => {
    expect(read("box-shadow: inset 0px 2px 4px 0px rgb(0, 0, 0), 4px 4px 0px 0px red")).toEqual([
      inset(0, 1, 1, 0, "rgb(0, 0, 0)"),
      shadow(1, 1),
    ]);
    expect(read("box-shadow: none")).toEqual([]);
    expect(defaultCellStyle().boxShadow).toEqual([]);
  });
});

describe("box-shadow paint", () => {
  it("shades the box's silhouette beside and below it, the box itself untouched", () => {
    expect(rows([shadow(1, 1)]).slice(0, 4)).toEqual(["┌──┐", "│ab│█", "└──┘█", " ████"]);
  });

  it("grows the silhouette by the spread", () => {
    expect(rows([shadow(0, 0, 0, 1)]).slice(0, 4)).toEqual(["┌──┐█", "│ab│█", "└──┘█", "█████"]);
  });

  it("blurs into rings of the ramp, lighter outward", () => {
    expect(rows([shadow(0, 0, 2)]).slice(0, 4)).toEqual(["┌──┐░", "│ab│░", "└──┘░", "░░░░░"]);
    expect(rows([shadow(0, 0, 4)]).slice(0, 5)).toEqual([
      "┌──┐▒░",
      "│ab│▒░",
      "└──┘▒░",
      "▒▒▒▒▒░",
      "░░░░░░",
    ]);
    expect(rows([shadow(0, 0, 6)]).slice(0, 5)).toEqual([
      "┌──┐▓▒░",
      "│ab│▓▒░",
      "└──┘▓▒░",
      "▓▓▓▓▓▒░",
      "▒▒▒▒▒▒░",
    ]);
    expect(rows([shadow(1, 1, 2)], "ascii").slice(0, 5)).toEqual([
      "+--+..",
      "|ab|#.",
      "+--+#.",
      ".####.",
      "......",
    ]);
  });

  it("shades a translucent color by its alpha, leaning on the foreground", () => {
    expect(rows([shadow(1, 1, 0, 0, "rgba(0, 0, 0, 0.1)")])[3]).toBe(" ▒▒▒▒");
    expect(rows([shadow(1, 1, 0, 0, "rgb(0 0 0 / 0.5)")])[3]).toBe(" ▓▓▓▓");
    expect(rows([shadow(0, 0, 2, 0, "rgba(0, 0, 0, 0.1)")]).slice(3, 4)).toEqual(["░░░░░"]);
    expect(rows([shadow(0, 1, 2, 0, "rgba(0, 0, 0, 0.1)")]).slice(3, 5)).toEqual([
      "▒▒▒▒░",
      "░░░░░",
    ]);
    expect(rows([shadow(1, 1, 0, 0, "transparent")])[3] ?? "").toBe("");
    const out: BorderRun[] = [];
    const style = { ...defaultCellStyle(), boxShadow: [shadow(1, 1, 0, 0, "rgba(0, 0, 0, 0.1)")] };
    collectShadowRuns(style, { x: 0, y: 0, width: 4, height: 3 }, false, out);
    expect(out[0]!.color).toBe(
      "color-mix(in srgb, rgba(0, 0, 0, 0.1) 10%, var(--mw-fg, canvastext))",
    );
  });

  it("fades each ring's ink toward transparent, a level per ring", () => {
    const out: BorderRun[] = [];
    const style = { ...defaultCellStyle(), boxShadow: [shadow(0, 0, 4)] };
    collectShadowRuns(style, { x: 0, y: 0, width: 4, height: 3 }, false, out);
    const colorAt = (x: number, y: number) => out.find((run) => run.x === x && run.y === y)!.color;
    expect(colorAt(4, 1)).toBe("color-mix(in srgb, red 67%, transparent)");
    expect(colorAt(5, 1)).toBe("color-mix(in srgb, red 33%, transparent)");
  });

  it("draws an inset shadow inside the padding box, fading into the box", () => {
    // The lit rectangle moved a cell right and down: the padding box's
    // top row and left column shade, under the border and around text.
    expect(rows([inset(1, 1)]).slice(0, 3)).toEqual(["┌──┐", "│ab│", "└──┘"]);
    const tall = rows([inset(1, 1)], null, 4);
    expect(tall.slice(0, 4)).toEqual(["┌──┐", "│██│", "│█ │", "└──┘"]);
    expect(rows([inset(0, 0, 2)], null, 4).slice(0, 4)).toEqual(["┌──┐", "│░░│", "│░░│", "└──┘"]);
    expect(rows([inset(0, 0, 0, 1)], null, 4).slice(0, 4)).toEqual([
      "┌──┐",
      "│██│",
      "│██│",
      "└──┘",
    ]);
  });

  it("paints the first declared shadow on top", () => {
    const out: BorderRun[] = [];
    const style = { ...defaultCellStyle(), boxShadow: [shadow(1, 1), shadow(2, 2, 0, 0, "blue")] };
    collectShadowRuns(style, { x: 0, y: 0, width: 4, height: 3 }, false, out);
    const at = out.filter((run) => run.x === 4 && run.y === 3);
    expect(at.map((run) => run.color)).toEqual(["blue", "red"]);
  });
});
