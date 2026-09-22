import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as index from "../src/index.ts";

/** Every component the package ships is rendered by a test: a part
 * nothing instantiates is a part nothing type-checks or runs. */

const here = import.meta.dirname;
const source = readdirSync(here)
  .filter((file) => /\.(ts|vue)$/.test(file) && file !== "coverage.test.ts")
  .map((file) => readFileSync(join(here, file), "utf8"))
  .join("\n");

it("renders every component it exports", () => {
  const components = Object.keys(index).filter((name) => /^[A-Z]/.test(name));
  expect(components.length).toBeGreaterThan(50);
  // Handed to `h`, not merely named: an import list mentions every
  // component a test file imports, rendered or not.
  const missing = components.filter(
    (name) => !new RegExp(`h\\(\\s*(?:ui\\.)?${name}\\b`).test(source),
  );
  expect(missing.join(", ")).toBe("");
});
