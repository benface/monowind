import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFont } from "../src/font.ts";
import { renderAscii } from "../src/render.ts";

/** Every bundled font must parse and render grid-safe output: the
 * advertised height, equal-width rows, hardblanks resolved. */
describe("bundled fonts", () => {
  const files = readdirSync(resolve("fonts")).filter((f) => /\.(flf|tlf)$/.test(f));
  it("bundles the full clearly-licensed set", () => {
    expect(files.length).toBeGreaterThanOrEqual(44);
  });
  for (const file of files) {
    it(file, () => {
      const font = parseFont(readFileSync(resolve("fonts", file), "utf8"));
      const { lines } = renderAscii("Test 123!", font);
      expect(lines).toHaveLength(font.height);
      expect(new Set(lines.map((l) => l.length)).size).toBe(1);
      for (const line of lines)
        expect(line).not.toContain(font.hardblank === " " ? "\0" : font.hardblank);
    });
  }
});
