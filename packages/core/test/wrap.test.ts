import { describe, expect, it } from "vitest";
import { wrapLineCount } from "../src/wrap.ts";

describe("wrapLineCount", () => {
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
});
