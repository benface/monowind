import { describe, expect, it } from "vitest";
import { INLINE_PAD, longestSegmentAdvance, wrapLineCount, wrapLines } from "../src/wrap.ts";

describe("wrapLineCount / wrapLines", () => {
  it("returns 0 for empty text", () => {
    expect(wrapLineCount("", 10)).toBe(0);
    expect(wrapLineCount("   ", 10)).toBe(0);
  });

  it("fits short text on one line", () => {
    expect(wrapLineCount("hello", 10)).toBe(1);
    expect(wrapLineCount("hello world", 11)).toBe(1);
    expect(wrapLineCount("hello world", 12)).toBe(1);
  });

  it("wraps at word boundaries", () => {
    // "hello world" = 11 chars; at width 10 → "hello" (5) then "world" (5)
    expect(wrapLineCount("hello world", 10)).toBe(2);
    // "hello world foo" = 15 chars; at width 10 → "hello" then "world foo" (9)
    expect(wrapLineCount("hello world foo", 10)).toBe(2);
    // At width 6: "hello" (5, fits), then "world foo" (9, break to "world" (5) then "foo")
    expect(wrapLineCount("hello world foo", 6)).toBe(3);
  });

  it("breaks long words at cell boundaries", () => {
    // Single 15-char word at width 5 → 3 lines of 5
    expect(wrapLineCount("aaaaaaaaaaaaaaa", 5)).toBe(3);
    // 15 chars at width 6 → 6 + 6 + 3 = 3 lines
    expect(wrapLineCount("aaaaaaaaaaaaaaa", 6)).toBe(3);
    // 15 chars at width 4 → 4 + 4 + 4 + 3 = 4 lines
    expect(wrapLineCount("aaaaaaaaaaaaaaa", 4)).toBe(4);
  });

  it("collapses horizontal whitespace runs to single spaces", () => {
    expect(wrapLineCount("hello    world", 11)).toBe(1);
    expect(wrapLineCount("hello\tworld", 11)).toBe(1);
  });

  it("treats \\n as a hard line break (from <br>)", () => {
    // Two paragraphs, each fits on one line → 2 total.
    expect(wrapLineCount("hello\nworld", 11)).toBe(2);
    // Blank line in between → 3 total (blank counts as 1).
    expect(wrapLineCount("hello\n\nworld", 11)).toBe(3);
    // Hard break composes with word-wrap: each line wraps independently.
    expect(wrapLineCount("hello world\nfoo bar", 5)).toBe(4);
  });

  it("returns 1 when width is 0 for non-empty text (documented edge)", () => {
    expect(wrapLineCount("hi", 0)).toBe(1);
    expect(wrapLineCount("hi", -5)).toBe(1);
  });

  it("handles motivating-example text at various widths", () => {
    const text = "This will be on the left"; // 24 chars, 6 words
    expect(wrapLineCount(text, 24)).toBe(1);
    expect(wrapLineCount(text, 12)).toBe(2); // "This will be" then "on the left"
    expect(wrapLineCount(text, 8)).toBe(4); // wraps to 4 lines
  });

  it("wraps by per-character advances (a leaf's own tracking)", () => {
    // Every character tracked ×1 (leaf tracking 1): 2 cells each; the gap
    // after a line's last character is free.
    const advances = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    // "hello world" = 22 − 1 free = 21.
    expect(wrapLines("hello world", 21, { advances, tracking: 1 })).toEqual(["hello world"]);
    expect(wrapLines("hello world", 20, { advances, tracking: 1 })).toEqual(["hello", "world"]);
    // A segment wider than the line breaks at cell boundaries: 3 chars
    // (2+2+2 − 1 free) fit in 5.
    expect(wrapLines("abcdef", 5, { advances: [2, 2, 2, 2, 2, 2], tracking: 1 })).toEqual([
      "abc",
      "def",
    ]);
  });

  it("keeps a tracked inline element's trailing gap (browsers do too)", () => {
    // "<span tracked ×2>ab</span> cd" in an untracked leaf: a=3, b=3, rest 1.
    const advances = [3, 3, 1, 1, 1];
    expect(wrapLines("ab cd", 9, { advances })).toEqual(["ab cd"]);
    expect(wrapLines("ab cd", 8, { advances })).toEqual(["ab", "cd"]);
    // At a line end the element's gap still counts: "ab" needs 6.
    expect(wrapLines("ab cd", 5, { advances })).toEqual(["a", "b", "cd"]);
  });

  it("treats U+FFFC (atomic inline box) as unbreakable with breaks on both sides", () => {
    // 4-cell box glued to text with NO spaces: breaks are still allowed
    // around it, like browsers give replaced elements.
    const advances = [1, 1, 4, 1, 1];
    expect(wrapLines("ab\uFFFCcd", 10, { advances })).toEqual(["ab\uFFFCcd"]);
    expect(wrapLines("ab\uFFFCcd", 6, { advances })).toEqual(["ab\uFFFC", "cd"]);
    expect(wrapLines("ab\uFFFCcd", 5, { advances })).toEqual(["ab", "\uFFFC", "cd"]);
    // Narrower than the box: it overflows alone, never splits.
    expect(wrapLines("ab\uFFFCcd", 3, { advances })).toEqual(["ab", "\uFFFC", "cd"]);
  });

  it("measures min-content by advances", () => {
    expect(longestSegmentAdvance("aa bbb")).toBe(3);
    // Tracked ×2 inline element in an untracked leaf: its gap is kept → 6.
    expect(longestSegmentAdvance("aa bbb", { advances: [3, 3, 1, 1, 1, 1] })).toBe(6);
    // The leaf's own tracking: the trailing gap is free → 9 − 2 = 7.
    expect(longestSegmentAdvance("aa bbb", { advances: [3, 3, 3, 3, 3, 3], tracking: 2 })).toBe(7);
  });
});

describe("first-line indent (text-indent)", () => {
  it("charges the first line only", () => {
    // "hello world" (11 cells) fits in width 11 with no indent, but
    // indent 4 leaves only 7 cells on line 1 — "world" wraps.
    expect(wrapLines("hello world", 11)).toEqual(["hello world"]);
    expect(wrapLines("hello world", 11, { firstLineIndent: 4 })).toEqual(["hello", "world"]);
  });

  it("does not re-indent after a hard line break", () => {
    // `<br>` (a \n) restarts the wrap but not the indent (per CSS:
    // text-indent applies to the first formatted line only). Second
    // segment gets the full width 10 and fits "world foo" (9 cells).
    expect(wrapLines("hello\nworld foo", 10, { firstLineIndent: 4 })).toEqual([
      "hello",
      "world foo",
    ]);
  });

  it("is a no-op when the indent is 0", () => {
    // Same as no indent: "hello" (5) + " world" (6) = 11 > 10 → wraps,
    // then "world" (5) + " foo" (4) = 9 fits.
    expect(wrapLines("hello world foo", 10, { firstLineIndent: 0 })).toEqual([
      "hello",
      "world foo",
    ]);
  });
});

describe("inline padding markers", () => {
  it("glues INLINE_PAD to its neighbors — the padding travels with the word", () => {
    // "aa ⁠bb": the marker is the padded span's left edge. At width 4 the
    // padded word (3 cells) doesn't fit after "aa " → wraps as one unit.
    expect(wrapLines(`aa ${INLINE_PAD}bb`, 4)).toEqual(["aa", `${INLINE_PAD}bb`]);
    // No break between the marker and the following character.
    expect(wrapLines(`${INLINE_PAD}bbb`, 2)).toEqual([`${INLINE_PAD}b`, "bb"]);
  });
});
