import { describe, expect, it, vi } from "vitest";
import {
  invalidateLeaves,
  leafObservedAttributes,
  onLeafRegistryChange,
  registerLeafRenderer,
} from "../src/leaf.ts";
import { buildTree } from "../src/tree.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderCellSegments } from "../src/plain-text.ts";
import { makeNode } from "./helpers.ts";

/** Public leaf-renderer API (specs/leaf-renderers.md): registered
 * custom elements supply their own grid content; children are
 * skipped; paint runs ride the inline-run machinery. */

describe("leaf renderers", () => {
  it("renders the leaf's lines and paint runs into the grid", () => {
    registerLeafRenderer({
      tag: "test-banner",
      render: () => ({
        lines: ["ABB", "A B"],
        runs: [
          { line: 0, start: 1, end: 3, paint: { color: "red", fontWeight: "bold" } },
          { line: 1, start: 0, end: 1, paint: { backgroundColor: "var(--x)" } },
        ],
      }),
    });
    const el = document.createElement("test-banner");
    el.textContent = "semantic text stays put";
    el.appendChild(document.createElement("div")); // children are skipped
    const node = buildTree(el, 16)!;
    expect(node.text).toBe("ABB\nA B");
    expect(node.intrinsicWidth).toBe(3);
    expect(node.intrinsicHeight).toBe(2);
    expect(node.children).toEqual([]);
    const root = makeNode({ children: [node] });
    layoutRoot(root, 10);
    const rows = renderCellSegments(root);
    // Row 0: bare "A", then the red bold "BB" run.
    expect(rows[0]![0]).toMatchObject({ text: "A" });
    expect(rows[0]![1]).toMatchObject({ text: "BB", color: "red", fontWeight: "bold" });
    // Row 1: the var() background passes through as a string.
    expect(rows[1]![0]).toMatchObject({ text: "A", backgroundColor: "var(--x)" });
  });

  it("survives a throwing renderer: warns, renders nothing, layout intact", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerLeafRenderer({
      tag: "test-thrower",
      render: () => {
        throw new Error("boom");
      },
    });
    const el = document.createElement("test-thrower");
    const node = buildTree(el, 16)!;
    expect(node.text).toBe("");
    expect(node.intrinsicWidth).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("renderer threw"), el);
    warn.mockRestore();
  });

  it("rejects non-custom-element tags and replaces last-wins with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerLeafRenderer({ tag: "div", render: () => ({ lines: ["x"] }) });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not a custom-element tag"));
    const div = document.createElement("div");
    div.textContent = "normal";
    expect(buildTree(div, 16)!.text).toBe("normal");
    registerLeafRenderer({ tag: "test-dupe", render: () => ({ lines: ["one"] }) });
    registerLeafRenderer({ tag: "test-dupe", render: () => ({ lines: ["two"] }) });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("last registration wins"));
    expect(buildTree(document.createElement("test-dupe"), 16)!.text).toBe("two");
    warn.mockRestore();
  });

  it("unions observed attributes and notifies on registration and invalidation", () => {
    registerLeafRenderer({
      tag: "test-attrs",
      render: () => ({ lines: [] }),
      observedAttributes: ["font", "Effect"],
    });
    expect(leafObservedAttributes()).toEqual(expect.arrayContaining(["font", "effect"]));
    const listener = vi.fn();
    const unsubscribe = onLeafRegistryChange(listener);
    invalidateLeaves();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    invalidateLeaves();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
