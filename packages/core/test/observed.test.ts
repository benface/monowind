import { expect, it } from "vitest";
import { registerLeafRenderer } from "../src/leaf.ts";
import { rendersAttribute } from "../src/observed.ts";

/** The attributes the host follows (specs/cell-model.md "Observation"). */

it("follows the attributes that render, every data-* but the engine's marks, and a leaf's all", () => {
  const box = document.createElement("div");
  for (const name of [
    "class",
    "style",
    "hidden",
    "open",
    "disabled",
    "dir",
    "colspan",
    "aria-expanded",
    "aria-selected",
    "data-state",
    "data-highlighted",
    "id",
    "role",
    "popovertarget",
    "max",
  ]) {
    expect(rendersAttribute(box, name), name).toBe(true);
  }
  for (const name of [
    "name",
    "tabindex",
    "title",
    "aria-activedescendant",
    "aria-controls",
    "aria-valuenow",
    "data-mw-laid-out",
  ]) {
    expect(rendersAttribute(box, name), name).toBe(false);
  }
  registerLeafRenderer({ tag: "test-observed", render: () => ({ lines: [] }) });
  const leaf = document.createElement("test-observed");
  expect(rendersAttribute(leaf, "font")).toBe(true);
  expect(rendersAttribute(leaf, "data-mw-laid-out")).toBe(false);
});
