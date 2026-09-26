import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { render, renderScroll } from "../src/render.ts";
import { buildTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

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

it("aligns a middle-aligned inline box by its text's row after the box's own alignment moves it", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div style="width: 400px">text <span style="display: inline-flex; align-items: center; height: 12px; vertical-align: middle" data-test="centered">x</span> end</div>`;
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, 40);
  render(node);
  const centered = node.children.find(
    (child) => child.source.getAttribute("data-test") === "centered",
  )!;
  // items-center puts the x on the box's middle row, the line's text row.
  expect(centered.resolvedPadding.top).toBe(1);
  expect(centered.baselineRow).toBe(1);
  expect((centered.source as HTMLElement).style.getPropertyValue("--mw-va")).toBe("0");
});

/** A host's light DOM, mounted. */
const mount = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

/** A layout pass's writes as the host makes them (element.ts), every
 * scroll container scrolled `rows` down. */
const layoutPass = (host: HTMLElement, cols: number, rows: number): LayoutNode => {
  const root = buildTree(host.firstElementChild!, 16)!;
  const scroll = (node: LayoutNode): void => {
    if (node.scrollRange) node.scroll = { x: 0, y: rows };
    for (const child of node.children) scroll(child);
  };
  layoutRoot(root, cols, scroll);
  render(root);
  return root;
};

const cells = (el: Element, property: string): number =>
  Number((el as HTMLElement).style.getPropertyValue(property));

it("writes nothing on a relayout that moves nothing, a stuck sticky span's shift included", () => {
  const host = mount(
    `<div><div style="overflow-y: auto; width: 80px; height: 8px">` +
      `<p>aaaa <span style="position: sticky; top: 0px">bb</span> cc dd ee ff gg hh ii jj</p>` +
      `</div></div>`,
  );
  layoutPass(host, 20, 1);
  expect(cells(host.querySelector("span")!, "--mw-it")).toBe(1);
  const observer = new MutationObserver(() => {});
  observer.observe(host, { attributes: true, subtree: true });
  layoutPass(host, 20, 1);
  expect(observer.takeRecords()).toEqual([]);
  observer.disconnect();
});

/** The engine's flags and variables on an element, sorted. */
const engineNames = (el: Element): string[] => {
  const { style } = el as HTMLElement;
  const variables = Array.from({ length: style.length }, (_, i) => style.item(i));
  const flags = el.getAttributeNames().filter((name) => name.startsWith("data-mw-"));
  return [...flags, ...variables.filter((name) => name.startsWith("--mw-"))].sort();
};

it("clears a box's flags and variables from an element a relayout makes inline", () => {
  const host = mount(
    `<div><p>a <em style="display: inline-block; padding: 0 16px; overflow: hidden">x</em> b</p>` +
      `<div><strong style="display: block; position: sticky; top: 0px">y</strong></div></div>`,
  );
  layoutPass(host, 20, 0);
  const em = host.querySelector("em")!;
  const strong = host.querySelector("strong")!;
  expect(em.hasAttribute("data-mw-inline-box")).toBe(true);
  expect(strong.hasAttribute("data-mw-laid-out")).toBe(true);
  em.style.display = "inline";
  strong.style.display = "inline";
  strong.style.position = "static";
  layoutPass(host, 20, 0);
  // An inline element's own: its tracking, its padding cells.
  expect(engineNames(em)).toEqual(["--mw-ipl", "--mw-ipr", "--mw-ls"]);
  expect(engineNames(strong)).toEqual(["--mw-ls"]);
  // A box again: its padding is the box's.
  em.style.display = "inline-block";
  layoutPass(host, 20, 0);
  expect(engineNames(em)).not.toContain("--mw-ipl");
  expect(engineNames(em)).not.toContain("--mw-ipr");
});

it("clears every name render.ts writes from an element that is no box, but an inline element's own", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/render.ts"), "utf8");
  const names = [...source.matchAll(/"((?:data-mw|--mw)-[\w-]+)"/g)].map((match) => match[1]!);
  const host = mount(`<div><p>a <em>x</em> b</p></div>`);
  const em = host.querySelector("em")!;
  // The host's own flag aside.
  for (const name of names.filter((name) => name !== "data-mw-leaf")) {
    if (name.startsWith("--")) em.style.setProperty(name, "1");
    else em.setAttribute(name, "");
  }
  layoutPass(host, 20, 0);
  expect(engineNames(em)).toEqual(["--mw-ls"]);
});

it("takes back the scroll a fixed box escapes, once: a fixed box inside it sits on its cells", () => {
  const rows = Array.from({ length: 12 }, (_, i) => `<p>Row ${i + 1}</p>`).join("");
  const host = mount(
    `<div><div style="overflow-y: auto; width: 112px; height: 24px">${rows}` +
      `<div data-test="fixed" style="position: fixed; top: 0px; left: 128px; width: 80px">` +
      `<p>One</p><p data-test="inner" style="position: fixed; top: 8px; left: 216px">Inner</p>` +
      `</div></div></div>`,
  );
  const root = layoutPass(host, 80, 3);
  const fixed = host.querySelector('[data-test="fixed"]')!;
  const inner = host.querySelector('[data-test="inner"]')!;
  expect(cells(fixed, "--mw-sy")).toBe(3);
  expect(cells(inner, "--mw-sy")).toBe(0);
  // A scroll repaint: the outer box's takeback follows the scroll.
  renderScroll(root, () => (root.children[0]!.scroll = { x: 0, y: 5 }));
  expect(cells(fixed, "--mw-sy")).toBe(5);
  expect(cells(inner, "--mw-sy")).toBe(0);
});
