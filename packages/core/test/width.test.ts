import { describe, expect, it } from "vitest";
import { clusterAdvances, clusterWidth, graphemes, isColorEmoji, textCells } from "../src/width.ts";

describe("clusterWidth", () => {
  it("counts East Asian wide and fullwidth clusters as two cells", () => {
    for (const cluster of [
      "中",
      "日",
      "한",
      "あ",
      "ア",
      "ㄅ",
      "。",
      "Ａ",
      "￥",
      "〈",
      "𠀀",
      "𪚥",
    ]) {
      expect(clusterWidth(cluster), cluster).toBe(2);
    }
  });

  it("counts emoji presentation as two cells", () => {
    for (const cluster of ["😀", "🇯🇵", "👨‍👩‍👧", "1️⃣", "♥️", "🏳️‍🌈", "👍🏽", "⌚", "🈚"]) {
      expect(clusterWidth(cluster), cluster).toBe(2);
    }
  });

  it("counts text presentation, ambiguous symbols, halfwidth, and Latin as one cell", () => {
    for (const cluster of [
      "a",
      " ",
      "é",
      "é",
      "★",
      "✓",
      "♥",
      "↔",
      "→",
      "─",
      "█",
      "ﾊ",
      "…",
      "🇯",
      "⌚︎",
    ]) {
      expect(clusterWidth(cluster), cluster).toBe(1);
    }
  });

  it("counts a text-presentation pictograph by the East Asian width table", () => {
    for (const cluster of ["〰", "㊗", "〽", "🈂"]) {
      expect(clusterWidth(cluster), cluster).toBe(2);
      expect(isColorEmoji(cluster), cluster).toBe(false);
    }
  });

  it("counts default-ignorable and control clusters as no cell", () => {
    for (const cluster of ["​", "­", "‍", "️", "", "⁠"]) {
      expect(clusterWidth(cluster), JSON.stringify(cluster)).toBe(0);
    }
    expect(clusterWidth("")).toBe(0);
  });
});

describe("isColorEmoji", () => {
  it("is a two-cell emoji cluster", () => {
    for (const cluster of ["😀", "🇯🇵", "👨‍👩‍👧", "1️⃣", "♥️", "⌚", "👍🏽", "〰️"]) {
      expect(isColorEmoji(cluster), cluster).toBe(true);
    }
    for (const cluster of ["🇯", "♥", "⌚︎", "中", "a", "★"]) {
      expect(isColorEmoji(cluster), cluster).toBe(false);
    }
  });
});

describe("graphemes", () => {
  it("keeps sequences together", () => {
    expect(graphemes("éx")).toEqual(["é", "x"]);
    expect(graphemes("👨‍👩‍👧!")).toEqual(["👨‍👩‍👧", "!"]);
    expect(graphemes("🇯🇵🇫🇷")).toEqual(["🇯🇵", "🇫🇷"]);
    expect(graphemes("1️⃣2")).toEqual(["1️⃣", "2"]);
    expect(graphemes("한글")).toEqual(["한", "글"]);
  });

  it("splits ASCII per character", () => {
    expect(graphemes("ab c\n")).toEqual(["a", "b", " ", "c", "\n"]);
    expect(graphemes("")).toEqual([]);
  });

  it("splits as Intl.Segmenter does through Latin and the symbol blocks, a joiner included", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const wrong: string[] = [];
    for (let code = 0xa0; code <= 0x2bff; code++) {
      const c = String.fromCodePoint(code);
      for (const text of [`a${c}${c}b`, `${c}\u0301`, `${c}\u200d${c}`]) {
        const expected = Array.from(segmenter.segment(text), ({ segment }) => segment);
        if (graphemes(text).join("|") !== expected.join("|")) wrong.push(code.toString(16));
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("clusterAdvances", () => {
  it("puts a cluster's cells and tracking on its first unit and 0 on the rest", () => {
    expect(clusterAdvances("a中😀é")).toEqual([1, 2, 2, 0, 1, 0]);
    expect(clusterAdvances("a中😀", 1)).toEqual([2, 3, 3, 0]);
    expect(clusterAdvances("a​b", 1)).toEqual([2, 0, 2]);
  });
});

describe("textCells", () => {
  it("sums cluster widths", () => {
    expect(textCells("日本語 ok 😀")).toBe(6 + 4 + 2);
    expect(textCells("")).toBe(0);
  });
});
