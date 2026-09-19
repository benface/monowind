import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** The companion's layering (styles.css, the header): every
 * `!important` declaration is a lock in `@layer theme`, but the
 * grid-mode pointer-events rules, which an author's important utility
 * must still beat (specs/cell-model.md "Pointer states"); a plain
 * declaration in the layer would lose to a utility, so the layer holds
 * none but the sticky resets. */

interface Declaration {
  property: string;
  important: boolean;
  layer: string | undefined;
}

/** The stylesheet's declarations, each with its innermost layer. */
function declarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const layers: (string | undefined)[] = [];
  let preludeStart = 0;
  let bodyStart = -1;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      const prelude = css.slice(preludeStart, i).trim();
      layers.push(/^@layer\s+([\w-]+)$/.exec(prelude)?.[1]);
      preludeStart = bodyStart = i + 1;
    } else if (char === "}") {
      if (bodyStart !== -1) {
        const layer = layers.filter((name) => name !== undefined).pop();
        for (const declaration of css.slice(bodyStart, i).split(";")) {
          const [property, value] = declaration.split(":");
          if (value === undefined) continue;
          out.push({ property: property!.trim(), important: value.includes("!important"), layer });
        }
      }
      layers.pop();
      bodyStart = -1;
      preludeStart = i + 1;
    } else if (char === ";" && bodyStart === -1) preludeStart = i + 1;
  }
  return out;
}

const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8").replaceAll(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const all = declarations(css);

it("styles.css orders the theme layer first", () => {
  expect(css).toMatch(/^@layer theme, base;$/m);
});

it("styles.css keeps every lock in the theme layer", () => {
  const outside = all.filter((d) => d.important && d.layer !== "theme");
  expect(new Set(outside.map((d) => d.property))).toEqual(new Set(["pointer-events"]));
});

it("styles.css keeps the theme layer to locks", () => {
  const plain = all.filter((d) => d.layer === "theme" && !d.important);
  expect(new Set(plain.map((d) => d.property))).toEqual(new Set(["--mw-sx", "--mw-sy"]));
});
