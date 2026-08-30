import { expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { render } from "../src/render.ts";
import { buildTree } from "../src/tree.ts";

/** DOM renderer (happy-dom): decoration cells are deduped — later runs
 * (junction tees) replace earlier glyphs (border edges) instead of
 * stacking spans in one cell, matching renderAscii's overwrite. */
it("paints one span per cell, junctions replacing border glyphs", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="display: flex; width: 28px; border: 1px solid; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 7);
  const layer = document.createElement("div");
  render(node, layer);
  const glyphs = Array.from(layer.querySelectorAll("span"), (s) => s.textContent);
  const count = (g: string) => glyphs.filter((glyph) => glyph === g).length;
  expect(count("┬")).toBe(1);
  expect(count("┴")).toBe(1);
  // 5 interior top/bottom cells minus the tee cell each: no `─` span
  // hiding underneath a junction (the pre-dedup bug painted 10).
  expect(count("─")).toBe(8);
});

it("honors z-index on positioned elements for decoration paint order", () => {
  // Without z-index the later (red) box would win the shared cells;
  // z-10 on the FIRST (relative) box flips the overlap row to cyan.
  const host2 = document.createElement("div");
  host2.innerHTML = `<div style="width: 24px">
    <div style="border: 1px solid; border-color: cyan; z-index: 10; position: relative">a</div>
    <div style="border: 1px solid; border-color: red; margin-top: -4px">b</div>
  </div>`;
  document.body.appendChild(host2);
  const node = buildTree(host2.firstElementChild!, 16)!;
  layoutRoot(node, 6);
  const layer = document.createElement("div");
  render(node, layer);
  const colors = Array.from(layer.querySelectorAll("span"), (s) => s.style.color);
  // The overlap row belongs to cyan (z-10), so cyan paints MORE cells
  // than a plain later-wins walk would leave it.
  expect(colors.filter((c) => c === "cyan").length).toBeGreaterThan(
    colors.filter((c) => c === "red").length,
  );
});

it("keeps z-index inert on static block-flow children, per CSS", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="width: 24px">
    <div style="border: 1px solid; border-color: cyan; z-index: 10">a</div>
    <div style="border: 1px solid; border-color: red; margin-top: -4px">b</div>
  </div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 6);
  const layer = document.createElement("div");
  render(node, layer);
  const colors = Array.from(layer.querySelectorAll("span"), (s) => s.style.color);
  // Document order stands: the later (red) box owns the overlap row.
  expect(colors.filter((c) => c === "red").length).toBeGreaterThan(
    colors.filter((c) => c === "cyan").length,
  );
  // And the browser side gets no --mw-z (z-index stays auto there too).
  expect(host.querySelector("div div")!.getAttribute("style")).not.toContain("--mw-z");
});
