import { describe, expect, it } from "vitest";
import { registerLeafRenderer } from "../src/leaf.ts";
import { classifySelection, serializeSelection, wordAt } from "../src/selection.ts";
import { buildTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

/**
 * Copy serialization (specs/semantic-selection.md): a light-DOM
 * selection copies as the engine's layout text laid out by the
 * `innerText` rules. Pure over the tree — no layout pass needed.
 */

function build(html: string): { host: HTMLElement; root: LayoutNode } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  return { host, root: buildTree(host, 16)! };
}

const texts = (host: Element): Text[] => {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
};

const points = (start: Node, startOffset: number, end: Node, endOffset: number) => ({
  startContainer: start,
  startOffset,
  endContainer: end,
  endOffset,
});

const selectAll = (host: Element) => points(host, 0, host, host.childNodes.length);

describe("serializeSelection", () => {
  it("separates paragraphs by a blank line and other blocks by one break", () => {
    const p = build("<p>First one.</p><p>Second one.</p>");
    expect(serializeSelection(p.root, selectAll(p.host))).toBe("First one.\n\nSecond one.");
    const d = build("<div>First one.</div><div>Second one.</div>");
    expect(serializeSelection(d.root, selectAll(d.host))).toBe("First one.\nSecond one.");
  });

  it("slices partially selected leaves at both ends", () => {
    const { host, root } = build("<p>alpha beta</p><p>gamma delta</p>");
    const [a, b] = texts(host);
    expect(serializeSelection(root, points(a!, 6, b!, 5))).toBe("beta\n\ngamma");
    expect(serializeSelection(root, points(a!, 2, a!, 7))).toBe("pha b");
  });

  it("keeps <br> newlines inside a slice and drops a trailing one", () => {
    const { host, root } = build("<div>one<br>two<br></div><div>three</div>");
    expect(serializeSelection(root, selectAll(host))).toBe("one\ntwo\nthree");
  });

  it("uses tabs between a row's cells and newlines between rows", () => {
    const { host, root } = build(
      "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>",
    );
    expect(serializeSelection(root, selectAll(host))).toBe("a\tb\nc\td");
    const [, b, c] = texts(host);
    expect(serializeSelection(root, points(b!, 0, c!, 1))).toBe("b\nc");
  });

  it("splices an inline box into its paragraph and drops padding markers", () => {
    const { host, root } = build(
      '<p>see <span style="display: inline-block">the box</span> here <b style="padding: 0 4px">pad</b>.</p>',
    );
    expect(serializeSelection(root, selectAll(host))).toBe("see the box here pad.");
    const [, boxText, after] = texts(host);
    expect(serializeSelection(root, points(boxText!, 4, after!, 5))).toBe("box here");
  });

  it("splices nested and direct boxes in marker order", () => {
    const { host, root } = build(
      '<p>a <b><span style="display: inline-block">NESTED</span></b> b <span style="display: inline-block">YY</span> c</p>',
    );
    expect(serializeSelection(root, selectAll(host))).toBe("a NESTED b YY c");
  });

  it("emits an out-of-flow child after its parent's text", () => {
    const { host, root } = build(
      '<div>body text<span style="position: absolute">badge</span></div>',
    );
    expect(serializeSelection(root, selectAll(host))).toBe("body text\nbadge");
  });

  it("copies a renderer leaf's lines whole", () => {
    registerLeafRenderer({ tag: "test-art", render: () => ({ lines: ["/\\", "\\/"] }) });
    const { host, root } = build("<p>before</p><test-art>alt</test-art><p>after</p>");
    expect(serializeSelection(root, selectAll(host))).toBe("before\n\n/\\\n\\/\n\nafter");
    // A range touching only the leaf's light text still takes it whole.
    const [, alt] = texts(host);
    expect(serializeSelection(root, points(alt!, 1, alt!, 2))).toBe("/\\\n\\/");
  });

  it("classifies where a selection lives", () => {
    const { host } = build("<p>text</p>");
    const grid = document.createElement("pre");
    const gridText = document.createTextNode("grid");
    grid.appendChild(gridText);
    const [text] = texts(host);
    expect(classifySelection(host, grid, points(text!, 0, text!, 2))).toBe("light");
    expect(classifySelection(host, grid, points(host, 0, host, 1))).toBe("light");
    expect(classifySelection(host, grid, points(gridText, 0, gridText, 2))).toBe("grid");
    expect(classifySelection(host, grid, points(document.body, 0, text!, 2))).toBe("outside");
    expect(classifySelection(host, grid, points(gridText, 0, text!, 2))).toBe("outside");
  });
});

describe("wordAt", () => {
  const leaf = (html: string): LayoutNode => build(html).root.children[0]!;

  it("finds the Segmenter word, punctuation run, or blank at an index", () => {
    const node = leaf("<p>hello, world</p>");
    expect(wordAt(node, 8)).toEqual({ start: 7, end: 12 });
    expect(wordAt(node, 0)).toEqual({ start: 0, end: 5 });
    expect(wordAt(node, 5)).toEqual({ start: 5, end: 6 });
    expect(wordAt(node, 6)).toEqual({ start: 6, end: 7 });
    expect(wordAt(node, 12)).toBeNull();
  });

  it("stops at newlines and markers", () => {
    const node = leaf('<p>ab<br>cd<span style="display: inline-block">x</span>ef</p>');
    expect(node.text).toBe("ab\ncd￼ef");
    expect(wordAt(node, 3)).toEqual({ start: 3, end: 5 });
    expect(wordAt(node, 2)).toBeNull();
    expect(wordAt(node, 5)).toBeNull();
    expect(wordAt(node, 6)).toEqual({ start: 6, end: 8 });
  });

  it("spans an inline element boundary as one word", () => {
    const node = leaf("<p>un<b>believ</b>able here</p>");
    expect(wordAt(node, 4)).toEqual({ start: 0, end: 12 });
  });
});

describe("wordAt language", () => {
  it("segments in the element's language and caches the segmenter", () => {
    const node = build('<p lang="en">hello world</p>').root.children[0]!;
    expect(wordAt(node, 7)).toEqual({ start: 6, end: 11 });
    const invalid = build('<p lang="not a tag">hello world</p>').root.children[0]!;
    expect(wordAt(invalid, 1)).toEqual({ start: 0, end: 5 });
  });
});
