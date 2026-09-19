import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMPOSITE, INTERACTIVE } from "../src/element.ts";

/** The interactive light elements (specs/cell-model.md "Pointer
 * states") are listed three times — the engine's constant, and the
 * companion stylesheet's cursor and pointer-events rules — and the
 * composites' containers a fourth, in the focus invert's exclusion;
 * all must agree. */

/** The list's selectors: split at its own commas, past those inside a
 * `:not()`, each stripped of the formatter's whitespace. */
function list(selectors: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selectors) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out.map((selector) => selector.replaceAll(/\s+/g, "").replaceAll('"', "'")).sort();
}

const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8");

it("styles.css keeps the same interactive elements' cursor and pointer events", () => {
  const cursor = css.match(/\[data-mw-float\]\):not\(([^{]*)\)\s*\{\s*cursor: text/);
  const pointer = css.match(
    /:not\(\[data-mw-dragging\]\)\s*:is\(([^{]*)\)\s*\{\s*pointer-events: auto/,
  );
  expect(cursor, "the grid-mode cursor rule").not.toBeNull();
  expect(pointer, "the grid-mode pointer-events rule").not.toBeNull();
  expect(list(cursor![1]!)).toEqual(list(INTERACTIVE));
  expect(list(pointer![1]!)).toEqual(list(INTERACTIVE));
});

it("styles.css keeps the focus invert off the same composites' containers", () => {
  const invert = css.match(/:focus-visible:not\(([^{]*)\)\s*\{\s*background-color: var\(--mw-fg\)/);
  expect(invert, "the focus invert rule").not.toBeNull();
  expect(list(invert![1]!)).toEqual(list(COMPOSITE));
});
