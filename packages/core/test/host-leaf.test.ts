import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { renderPlainText } from "../src/plain-text.ts";
import { leafExtent, positionOf } from "../src/selection.ts";
import { buildRootLeaf } from "../src/tree.ts";
import { INLINE_PAD, OBJECT_REPLACEMENT } from "../src/wrap.ts";

/** The host as a leaf (specs/host-leaf.md): its own inline content is
 * the root leaf, built over its child nodes minus the metrics probe. */
function host(innerHTML: string, style = ""): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = style;
  el.innerHTML = innerHTML;
  const probe = document.createElement("span");
  probe.setAttribute("data-mw-probe", "");
  probe.style.cssText = "position: absolute";
  probe.textContent = "MMMM";
  el.appendChild(probe);
  document.body.appendChild(el);
  return el;
}

describe("buildRootLeaf", () => {
  it("collects text, inline elements, atomic boxes, and <br> without the probe", () => {
    const el = host(
      'foo <b style="padding-left: 4px">bar</b><br>baz <span style="display: inline-block">box</span>' +
        '<div style="position: absolute">out</div>',
      "padding: 8px; border: 1px solid; text-align: center; white-space: nowrap",
    );
    const leaf = buildRootLeaf(el, 16)!;
    expect(leaf.source).toBe(el);
    expect(leaf.text).toBe(`foo ${INLINE_PAD}bar\nbaz ${OBJECT_REPLACEMENT}`);
    expect(leaf.inlineElements?.map((entry) => [entry.element.tagName, entry.padLeft])).toEqual([
      ["B", 1],
    ]);
    // The atomic box rides the run; the out-of-flow child hangs off the leaf.
    expect(leaf.children.map((child) => [child.source.tagName, Boolean(child.inlineBox)])).toEqual([
      ["SPAN", true],
      ["DIV", false],
    ]);
    // Characters map back to the host's own text nodes; the run's extent
    // reaches from the first character through the trailing box, never
    // the probe.
    expect(positionOf(leaf, 0)?.node).toBe(el.firstChild);
    const box = el.querySelector("span")!;
    expect(leafExtent(leaf)).toEqual({
      start: { node: el.firstChild, offset: 0 },
      end: { node: el, offset: Array.prototype.indexOf.call(el.childNodes, box) + 1 },
    });
    // The host's box stays outside: no padding or border on the leaf;
    // its text properties come through; tracking and leading are zero.
    expect(leaf.style.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(leaf.style.border).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(leaf.style.textAlign).toBe("center");
    expect(leaf.style.whiteSpace).toBe("nowrap");
    expect(leaf.style.tracking).toBe(0);
    expect(leaf.style.lineGap).toBe(0);
  });

  it("truncates at the host's width under nowrap + clip + ellipsis", () => {
    const el = host(
      "a long line",
      "white-space: nowrap; overflow: hidden; text-overflow: ellipsis",
    );
    const leaf = buildRootLeaf(el, 16)!;
    layoutRoot(leaf, 6);
    expect(renderPlainText(leaf)).toBe("a lon…");
  });

  it("is null for a container host, an empty host, or out-of-flow children alone", () => {
    expect(buildRootLeaf(host("foo<div>block</div>"), 16)).toBeNull();
    expect(buildRootLeaf(host("  \n  "), 16)).toBeNull();
    expect(buildRootLeaf(host('<div style="position: absolute">out</div>'), 16)).toBeNull();
  });
});
