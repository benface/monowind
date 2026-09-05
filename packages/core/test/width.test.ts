import { describe, expect, it } from "vitest";
import { clusterAdvances, clusterWidth, graphemes, textCells } from "../src/width.ts";

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

  it("counts default-ignorable and control clusters as no cell", () => {
    for (const cluster of ["​", "­", "‍", "️", "", "⁠"]) {
      expect(clusterWidth(cluster), JSON.stringify(cluster)).toBe(0);
    }
    expect(clusterWidth("")).toBe(0);
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
