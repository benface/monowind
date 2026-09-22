import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as index from "../src/index.svelte.ts";

/** Every component the package ships is mounted by a test: Svelte
 * compiles a `.svelte` file only where something instantiates it, so
 * a part no test mounts is a part nothing compiles. */

const here = import.meta.dirname;
const source = readdirSync(here)
  .filter((file) => /\.(ts|svelte)$/.test(file) && file !== "coverage.test.ts")
  .map((file) => readFileSync(join(here, file), "utf8"))
  .join("\n");

it("renders every component it exports", () => {
  const components = Object.keys(index).filter((name) => /^[A-Z]/.test(name));
  expect(components.length).toBeGreaterThan(50);
  const missing = components.filter((name) => !new RegExp(`<${name}[\\s/>]`).test(source));
  expect(missing.join(", ")).toBe("");
});
