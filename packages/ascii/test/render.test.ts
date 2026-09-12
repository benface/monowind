import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import figlet from "figlet";
import { parseFont } from "../src/font.ts";
import { renderAscii, trimAscii } from "../src/render.ts";

/** The npm `figlet` package is the independent reference
 * implementation: same `.flf` inputs, battle-tested output. Any
 * smushing subtlety we get wrong fails these diffs. */

// cwd-relative: the happy-dom environment rewrites import.meta.url.
const load = (name: string) => parseFont(readFileSync(resolve("fonts", name), "utf8"));

type FigletFont =
  Exclude<Parameters<typeof figlet.textSync>[1], string | undefined> extends {
    font?: infer F;
  }
    ? F
    : never;

const reference = (text: string, font: string) =>
  figlet
    .textSync(text, { font: font as FigletFont })
    .split("\n")
    .map((line) => line.trimEnd());

const ours = (text: string, name: string) =>
  renderAscii(text, load(name)).lines.map((line) => line.trimEnd());

const SAMPLES = [
  "Hello, World!",
  "monowind",
  "The quick brown fox jumps over the lazy dog 0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "|_/\\<>[]{}()",
  "WAVE jelly",
];

describe("renderAscii matches the figlet reference", () => {
  for (const sample of SAMPLES) {
    it(`Standard: ${JSON.stringify(sample)}`, () => {
      expect(ours(sample, "standard.flf")).toEqual(reference(sample, "Standard"));
    });
    it(`Small: ${JSON.stringify(sample)}`, () => {
      expect(ours(sample, "small.flf")).toEqual(reference(sample, "Small"));
    });
  }
});

describe("TLF (toilet) fonts", () => {
  it("parses and renders mono9", () => {
    const font = load("mono9.tlf");
    expect(font.height).toBe(8);
    const { lines } = renderAscii("Hi", font);
    expect(lines).toHaveLength(8);
    expect(Math.max(...lines.map((l) => l.length))).toBeGreaterThan(4);
    // Every row is equal-width before trimming (grid-safe).
    expect(new Set(renderAscii("Hi", font).lines.map((l) => l.length)).size).toBe(1);
  });

  it("hardblanks come out as spaces, never leak", () => {
    const font = load("standard.flf");
    for (const line of renderAscii("A W", font).lines) {
      expect(line).not.toContain(font.hardblank);
    }
  });
});

describe("spaces", () => {
  it("draws a no-break space as the space glyph, so two of them widen the gap", () => {
    const font = load("standard.flf");
    const width = (text: string) => Math.max(...renderAscii(text, font).lines.map((l) => l.length));
    expect(width("a b")).toBe(width("a b"));
    expect(width("a  b")).toBeGreaterThan(width("a b"));
    expect(renderAscii("a b", font).lines).toEqual(renderAscii("a b", font).lines);
  });
});

describe("trimAscii", () => {
  it("drops the blank rows and columns around the art, moving the runs along", () => {
    const paint = { color: "red" };
    const art = {
      lines: ["      ", "  ab  ", "   c  ", "      "],
      runs: [
        { line: 1, start: 0, end: 4, paint },
        { line: 2, start: 3, end: 4, paint },
        { line: 3, start: 0, end: 6, paint },
      ],
    };
    expect(trimAscii(art)).toEqual({
      lines: ["ab", " c"],
      runs: [
        { line: 0, start: 0, end: 2, paint },
        { line: 1, start: 1, end: 2, paint },
      ],
    });
    expect(trimAscii({ lines: ["   ", "   "], runs: [] })).toEqual({ lines: [], runs: [] });
  });

  it("takes a small-font glyph's leading column and descender row", () => {
    const art = renderAscii("A", load("small.flf"));
    expect(art.lines.every((line) => line.startsWith(" "))).toBe(true);
    expect(art.lines[art.lines.length - 1]!.trim()).toBe("");
    const trimmed = trimAscii(art);
    expect(trimmed.lines.length).toBe(art.lines.length - 1);
    expect(trimmed.lines.some((line) => !line.startsWith(" "))).toBe(true);
  });
});
