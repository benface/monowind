import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as index from "../src/index.ts";

/** Every component the package ships is rendered by a test: a part
 * nothing instantiates is a part nothing type-checks or runs. */

const here = import.meta.dirname;
const source = readdirSync(here)
  .filter((file) => /\.tsx?$/.test(file) && file !== "coverage.test.ts")
  .map((file) => readFileSync(join(here, file), "utf8"))
  .join("\n");

it("renders every component it exports", () => {
  const missing: string[] = [];
  for (const [namespace, parts] of Object.entries(index)) {
    if (!/^[A-Z]/.test(namespace) || typeof parts !== "object" || parts === null) continue;
    for (const part of Object.keys(parts)) {
      if (part.startsWith("use")) continue;
      // Written as an element, not merely named.
      if (!new RegExp(`<${namespace}\\.${part}[\\s/>]`).test(source)) {
        missing.push(`${namespace}.${part}`);
      }
    }
  }
  expect(missing.join(", ")).toBe("");
});
