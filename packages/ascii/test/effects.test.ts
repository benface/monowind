import { expect, it } from "vitest";
import { isEffect } from "../src/effects.ts";

/** The `effect` attribute's names (README "API"): the effects' own
 * alone, an object's inherited ones aside. */
it("knows an effect by its own name, not by one every object inherits", () => {
  expect(isEffect("rainbow")).toBe(true);
  expect(isEffect("metal")).toBe(true);
  expect(isEffect("toString")).toBe(false);
  expect(isEffect("constructor")).toBe(false);
});
