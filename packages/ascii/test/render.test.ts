import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import figlet from "figlet";
import { parseFont } from "../src/font.ts";
import { renderAscii } from "../src/render.ts";

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
