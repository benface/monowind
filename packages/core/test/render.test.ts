import { expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
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

it("places a middle-aligned inline box by a whole-row baseline length, its line's text on its middle row", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="width: 400px">text <span style="display: inline-block; vertical-align: middle; padding: 4px 0" data-test="label">x</span> mid <span style="display: inline-flex; vertical-align: middle; padding: 4px 0" data-test="bare"><span style="display: block">y</span></span> end</div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 40);
  render(node);
  const label = node.children.find((child) => child.source.getAttribute("data-test") === "label")!;
  const bare = node.children.find((child) => child.source.getAttribute("data-test") === "bare")!;
  // Three-row boxes: the line's text on row 1 of both.
  expect(label.localRect.height).toBe(3);
  expect(label.inlineTextRow).toBe(1);
  expect(bare.inlineTextRow).toBe(1);
  const rows = renderPlainText(node).split("\n");
  expect(rows[1]).toContain("text");
  expect(rows[0]).not.toContain("text");
  // A box with a label aligns by the label's row; one that draws no
  // line of its own by its bottom edge, from the row's baseline.
  const labelStyle = (label.source as HTMLElement).style;
  expect(label.source.hasAttribute("data-mw-vmiddle")).toBe(true);
  expect(labelStyle.getPropertyValue("--mw-va")).toBe("0");
  expect(labelStyle.getPropertyValue("--mw-vb")).toBe("");
  const bareStyle = (bare.source as HTMLElement).style;
  expect(bareStyle.getPropertyValue("--mw-va")).toBe("-2");
  expect(bareStyle.getPropertyValue("--mw-vb")).toBe("1");
});
