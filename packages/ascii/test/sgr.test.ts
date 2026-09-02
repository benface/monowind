import { describe, expect, it } from "vitest";
import { parseSgrLine } from "../src/sgr.ts";
import { parseFont } from "../src/font.ts";
import { renderAscii } from "../src/render.ts";

describe("parseSgrLine", () => {
  it("passes plain lines through untouched", () => {
    expect(parseSgrLine("abc  ")).toEqual({ chars: "abc  " });
  });

  it("maps the 16-color palette to theme tokens", () => {
    const { chars, colors } = parseSgrLine("\x1b[31mAB\x1b[0mC");
    expect(chars).toBe("ABC");
    expect(colors![0]).toEqual({ color: "var(--mw-ansi-red)" });
    expect(colors![1]).toEqual({ color: "var(--mw-ansi-red)" });
    expect(colors![2]).toBeUndefined();
  });

  it("handles bold, bright foregrounds, and backgrounds together", () => {
    const { colors } = parseSgrLine("\x1b[1;93;44mX");
    expect(colors![0]).toEqual({
      bold: true,
      color: "var(--mw-ansi-bright-yellow)",
      backgroundColor: "var(--mw-ansi-blue)",
    });
  });

  it("passes 256-color and true-color through as literal CSS", () => {
    expect(parseSgrLine("\x1b[38;5;196mZ").colors![0]).toEqual({ color: "rgb(255, 0, 0)" });
    expect(parseSgrLine("\x1b[38;2;1;2;3mQ").colors![0]).toEqual({ color: "rgb(1, 2, 3)" });
  });
});

describe("colored TLF end to end", () => {
  // A minimal 1-row TLF where "A" is red and everything else plain.
  const font = () => {
    const lines = ["tlf2a$ 1 1 8 -1 1", "comment"];
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      lines.push(ch === "A" ? "\x1b[31mA\x1b[0m@" : `${ch}@`);
    }
    return parseFont(lines.join("\n"));
  };

  it("renders per-cell paint runs from embedded escapes", () => {
    const { lines, runs } = renderAscii("AB", font());
    expect(lines).toEqual(["AB"]);
    expect(runs).toEqual([{ line: 0, start: 0, end: 1, paint: { color: "var(--mw-ansi-red)" } }]);
  });
});
