import { expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { render } from "../src/render.ts";
import { buildTree } from "../src/tree.ts";

/** render.ts writes engine-owned geometry vars / attrs on the light DOM
 * (positions, padding cells, `--mw-z`, etc.). The GRID's paint semantics
 * live in `plain-text.test.ts` alongside the goldens. */

it("keeps `--mw-z` unset on static block-flow children, per CSS", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="width: 24px">
    <div style="border: 1px solid; border-color: cyan; z-index: 10">a</div>
    <div style="border: 1px solid; border-color: red; margin-top: -4px">b</div>
  </div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 6);
  render(node);
  // z-index is inert on static block children in CSS — engine mirrors
  // that by NOT writing --mw-z there (the companion falls back to auto).
  expect(host.querySelector("div div")!.getAttribute("style")).not.toContain("--mw-z");
});
