import { describe, expect, it } from "vitest";
import {
  formsContext,
  inlineMembersOf,
  inlineOwners,
  inPositionedStep,
  membersOf,
  paintIndex,
  zIndexApplies,
} from "../src/stacking.ts";
import type { CellStyle, InlineElement, LayoutNode } from "../src/types.ts";
import { makeNode, random } from "./helpers.ts";

/** Paint order (specs/positioning.md "Paint order"): each box within its
 * nearest stacking context, in CSS's steps and phases. */

const names = new WeakMap<LayoutNode, string>();

/** A named box: `style` over the defaults, `text` a leaf's. */
const box = (
  name: string,
  style: Partial<CellStyle> = {},
  children: LayoutNode[] = [],
  text = "",
): LayoutNode => {
  const node = makeNode({ style, children, text });
  names.set(node, name);
  return node;
};

/** The index's entries by name, a leaf's glyphs as `name:text`, an
 * inline member's as `name:N`, its entry. */
const order = (root: LayoutNode): string[] =>
  paintIndex(root).entries.map(
    ({ node, kind, member }) =>
      names.get(node)! + (member >= 0 ? `:${member}` : kind === "text" ? ":text" : ""),
  );

/** An inline element's entry under `parent`, positioned where `z` is
 * given (null for `auto`), a context where `context` says so. */
const inline = (
  parent: number,
  {
    z,
    context = false,
    positioned = true,
  }: { z?: number | null; context?: boolean; positioned?: boolean },
): InlineElement =>
  ({
    parent,
    positioned,
    zIndex: z ?? null,
    context: context || (z ?? null) !== null,
  }) as InlineElement;

const relative: Partial<CellStyle> = { position: "relative" };
const absolute = (zIndex: number | null = null): Partial<CellStyle> => ({
  position: "absolute",
  zIndex,
});

describe("the members and turns of the probed cases", () => {
  it("lifts a z-10 menu over the next card, and keeps a z-auto one in tree order", () => {
    const cards = (menuZ: number | null, second: Partial<CellStyle>) =>
      box("root", {}, [
        box("card1", relative, [box("menu", absolute(menuZ))]),
        box("card2", second),
      ]);
    expect(order(cards(10, relative))).toEqual(["root", "card1", "card2", "menu"]);
    expect(order(cards(null, relative))).toEqual(["root", "card1", "menu", "card2"]);
    // A static card paints its fill in the in-flow phase, before any member.
    expect(order(cards(null, {}))).toEqual(["root", "card2", "card1", "menu"]);
  });

  it("orders z-auto members across parents by tree order", () => {
    const root = box("root", {}, [
      box("p1", relative, [box("a1", absolute())]),
      box("p2", {}, [box("b1", absolute())]),
    ]);
    expect(order(root)).toEqual(["root", "p2", "p1", "a1", "b1"]);
  });

  it("paints a negative member over its context's fill, under its in-flow boxes", () => {
    const context = box("root", {}, [
      box("sc", { position: "relative", zIndex: 0 }, [box("inflow"), box("neg", absolute(-1))]),
    ]);
    expect(order(context)).toEqual(["root", "sc", "neg", "inflow"]);
    // A static or z-auto parent forms none: the member goes under it.
    for (const parent of [{}, relative]) {
      const root = box("root", {}, [box("par", parent, [box("neg", absolute(-1))])]);
      expect(order(root)[1]).toBe("neg");
    }
    // A faded parent forms one.
    const faded = box("root", {}, [box("par", { opacity: 0.5 }, [box("neg", absolute(-1))])]);
    expect(order(faded)).toEqual(["root", "par", "neg"]);
  });

  it("keeps a z-10 child under a later z-1 box where its parent forms a context", () => {
    const escape = (x: Partial<CellStyle>) =>
      box("root", {}, [
        box("x", x, [box("z", absolute(10))]),
        box("y", { position: "relative", zIndex: 1 }),
      ]);
    expect(order(escape({}))).toEqual(["root", "x", "y", "z"]);
    expect(order(escape({ zIndex: 5 }))).toEqual(["root", "x", "y", "z"]);
    for (const trigger of [
      { opacity: 0.99 },
      { stacking: true },
      { position: "sticky" },
      { position: "relative", zIndex: 0 },
    ] as Partial<CellStyle>[]) {
      expect(order(escape(trigger))).toEqual(["root", "x", "z", "y"]);
    }
  });

  it("paints a box that forms a context in the positioned step, over later in-flow boxes", () => {
    const root = box("root", {}, [box("x", { stacking: true }), box("y")]);
    expect(order(root)).toEqual(["root", "y", "x"]);
    const later = box("root", {}, [box("r", relative), box("o", { opacity: 0.5 })]);
    expect(order(later)).toEqual(["root", "r", "o"]);
  });

  it("applies a flex item's z-index", () => {
    const root = box("root", {}, [
      box("f", { display: "flex" }, [box("f1", { zIndex: 2 }), box("f2")]),
    ]);
    expect(order(root)).toEqual(["root", "f", "f2", "f1"]);
    const flex = root.children[0]!;
    expect(zIndexApplies(flex.children[1]!, flex)).toBe(true);
    expect(formsContext(flex.children[1]!, flex)).toBe(false);
    expect(zIndexApplies(flex, root)).toBe(false);
  });

  it("paints a flex or grid item whole among the inline content, in order-modified order", () => {
    for (const display of ["flex", "grid"] as const) {
      const root = box("root", {}, [
        box("f", { display }, [box("i1", { order: 1 }, [box("in1")]), box("i2")]),
        box("later"),
      ]);
      expect(order(root), display).toEqual(["root", "f", "later", "i2", "i1", "in1"]);
    }
  });

  it("paints a fixed box in the positioned step", () => {
    const root = box("root", {}, [box("par", {}, [box("fx", { position: "fixed" })]), box("st")]);
    expect(order(root)).toEqual(["root", "par", "st", "fx"]);
  });

  it("paints every in-flow fill before any in-flow text", () => {
    const root = box("root", {}, [box("t1", {}, [], "ab"), box("b2", {}, [], "cd")]);
    expect(order(root)).toEqual(["root", "t1", "b2", "t1:text", "b2:text"]);
  });

  it("paints the floats between the in-flow fills and the text, each whole", () => {
    const root = box("root", {}, [
      box("p", {}, [box("f", { float: "left" }, [box("in-float", {}, [], "x")])]),
      box("q", {}, [box("later", {}, [], "y")]),
    ]);
    expect(order(root)).toEqual([
      "root",
      "p",
      "q",
      "later",
      "f",
      "in-float",
      "in-float:text",
      "later:text",
    ]);
  });

  it("paints the top-layer stack last, over every z-index", () => {
    const popover = box("pop", { position: "fixed", topLayer: true });
    popover.topLayerRank = 0;
    const root = box("root", {}, [
      box("fx", { position: "fixed", zIndex: 2147483647 }),
      box("wrap", {}, [popover]),
    ]);
    root.topLayer = [{ node: popover, ancestors: [root, root.children[1]!] }];
    expect(order(root)).toEqual(["root", "wrap", "fx", "pop"]);
    expect(paintIndex(root).parents.get(popover)).toBe(root.children[1]);
  });

  it("orders a leaf's inline members among the boxes, nested ones inside a context", () => {
    const leaf = box("p", {}, [], "abcdef");
    leaf.inlineElements = [
      inline(-1, {}),
      inline(-1, { z: 1 }),
      inline(1, { z: -1 }),
      inline(1, { z: null, positioned: false }),
      inline(3, { z: 2 }),
    ];
    leaf.inlineMembers = inlineMembersOf(leaf.inlineElements, -1);
    expect(leaf.inlineMembers).toEqual([0, 1]);
    const root = box("root", {}, [leaf, box("r", relative)]);
    // The z-auto span with the relative box in tree order; the z-1 span
    // after them, its own negative member first, then its glyphs, its
    // static child's among them, then its positive member.
    expect(order(root)).toEqual(["root", "p", "p:text", "p:0", "r", "p:2", "p:1", "p:4"]);
    expect(inlineOwners(leaf.inlineElements)).toEqual([0, 1, 2, 1, 4]);
  });

  it("finds no member in a tree of in-flow boxes", () => {
    const root = box("root", {}, [box("a", {}, [box("b")]), box("c", { float: "left" })]);
    expect(membersOf(root)).toBeNull();
    expect(inPositionedStep(root.children[0]!, root)).toBe(false);
  });
});

describe("the order fuzz", () => {
  it("matches a pairwise comparator written from Appendix E on 500 random trees", () => {
    const key = (entry: { node: LayoutNode; text: boolean }) =>
      `${names.get(entry.node)}${entry.text ? ":text" : ""}`;
    for (let seed = 1; seed <= 500; seed++) {
      const root = randomTree(seed);
      const expected = expectedEntries(root).sort(comparator(root)).map(key);
      const entries = paintIndex(root).entries.map(({ node, kind }) => ({
        node,
        text: kind === "text",
      }));
      expect(entries.map(key), `seed ${seed}`).toEqual(expected);
    }
  });
});

/** A tree of 3 to 30 boxes mixing every position, z-indexes from -2 to
 * 3, faded and context-forming boxes, flex and grid parents and their
 * items' `order`, floats, atomic inline boxes, leaves' text, hidden
 * subtrees and top-layer boxes. */
function randomTree(seed: number): LayoutNode {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;
  const size = 3 + Math.floor(next() * 28);
  const root = box("root");
  const nodes = [root];
  const top: LayoutNode[] = [];
  for (let i = 1; i < size; i++) {
    const parent = pick(nodes);
    const style: Partial<CellStyle> = {
      position: pick(["static", "static", "static", "relative", "absolute", "fixed", "sticky"]),
      zIndex: pick([null, null, null, -2, -1, 0, 1, 2, 3]),
      opacity: next() < 0.2 ? 0.5 : 1,
      stacking: next() < 0.1,
      display: pick(["block", "block", "block", "block", "flex", "grid"] as const),
      float: next() < 0.15 ? "left" : "none",
      order: pick([0, 0, 0, -1, 1]),
    };
    const node = box(`n${i}`, style, [], next() < 0.6 ? "t" : "");
    if (next() < 0.1) node.inlineBox = { top: 0, right: 0, bottom: 0, left: 0 };
    if (next() < 0.05) node.forceHidden = true;
    if (next() < 0.03) node.tableHidden = true;
    parent.children.push(node);
    nodes.push(node);
    if (next() < 0.05) top.push(node);
  }
  // A container's text lives in its runs: only childless boxes keep theirs.
  for (const node of nodes) if (node.children.length > 0) node.text = "";
  const parents = new Map<LayoutNode, LayoutNode>();
  for (const node of nodes) for (const child of node.children) parents.set(child, node);
  top.forEach((node, rank) => {
    node.topLayerRank = rank;
    const ancestors: LayoutNode[] = [];
    for (let at = parents.get(node); at; at = parents.get(at)) ancestors.unshift(at);
    (root.topLayer ??= []).push({ node, ancestors });
  });
  return root;
}

interface Expected {
  node: LayoutNode;
  text: boolean;
}

/** Every entry the paint should hold: each shown box's ink and each
 * leaf's glyphs, under the tree's root and each top-layer box. */
function expectedEntries(root: LayoutNode): Expected[] {
  const out: Expected[] = [];
  const visit = (node: LayoutNode, top: boolean): void => {
    if (node.forceHidden || node.tableHidden) return;
    if (!top && node.topLayerRank !== undefined) return;
    out.push({ node, text: false });
    if (node.text !== "") out.push({ node, text: true });
    for (const child of node.children) visit(child, false);
  };
  visit(root, true);
  for (const { node } of root.topLayer ?? []) visit(node, true);
  return out;
}

/** Appendix E as a pairwise comparison, independent of the traversal:
 * each entry's chain of turns — the box that paints it whole, and the
 * turn that one paints in — up to a root; at their lowest common turn,
 * each entry's step there, then its z, then tree order. */
function comparator(root: LayoutNode): (a: Expected, b: Expected) => number {
  const parent = new Map<LayoutNode, LayoutNode>();
  // Order-modified document order: a flex or grid container's items by
  // their `order`.
  const tree = new Map<LayoutNode, number>();
  const visit = (node: LayoutNode): void => {
    tree.set(node, tree.size);
    const { display } = node.style;
    const items = display === "flex" || display === "grid";
    const children = items
      ? node.children.slice().sort((a, b) => a.style.order - b.style.order)
      : node.children;
    for (const child of children) {
      parent.set(child, node);
      visit(child);
    }
  };
  visit(root);
  const roots = [root, ...(root.topLayer ?? []).map(({ node }) => node)];
  const isRoot = (node: LayoutNode) => roots.includes(node);
  const member = (node: LayoutNode) => !isRoot(node) && inPositionedStep(node, parent.get(node)!);
  const floated = (node: LayoutNode) =>
    !isRoot(node) &&
    !member(node) &&
    !atomic(node) &&
    node.style.float !== "none" &&
    parent.get(node)!.style.display === "block";
  const atomic = (node: LayoutNode) =>
    !isRoot(node) &&
    !member(node) &&
    (node.inlineBox !== undefined || ["flex", "grid"].includes(parent.get(node)!.style.display));
  const painter = (node: LayoutNode) =>
    isRoot(node) || member(node) || floated(node) || atomic(node);
  const context = (node: LayoutNode) =>
    isRoot(node) || (member(node) && formsContext(node, parent.get(node)!));
  const up = (node: LayoutNode, test: (at: LayoutNode) => boolean): LayoutNode => {
    let at = parent.get(node)!;
    while (!test(at)) at = parent.get(at)!;
    return at;
  };
  /** The turn a painter paints in: a member's, its context's. */
  const turnOf = (node: LayoutNode): LayoutNode | null =>
    isRoot(node) ? null : member(node) ? up(node, context) : up(node, painter);
  const chain = (entry: Expected): LayoutNode[] => {
    const turns: LayoutNode[] = [];
    let at: LayoutNode | null = painter(entry.node) ? entry.node : up(entry.node, painter);
    for (; at; at = turnOf(at)) turns.push(at);
    return turns;
  };
  const z = (node: LayoutNode) =>
    zIndexApplies(node, parent.get(node)!) ? (node.style.zIndex ?? 0) : 0;
  /** Where a turn's step puts what is in it: its own ink, a negative
   * member, an in-flow box's ink, a float, the text and atomic boxes,
   * then the other members. */
  const step = (item: LayoutNode | Expected, turn: LayoutNode): number[] => {
    if ("node" in item) {
      if (item.text) return [4, 0, tree.get(item.node)!];
      return item.node === turn ? [0] : [2, 0, tree.get(item.node)!];
    }
    if (member(item)) return [z(item) < 0 ? 1 : 5, z(item), tree.get(item)!];
    return [floated(item) ? 3 : 4, 0, tree.get(item)!];
  };
  return (a, b) => {
    const chainA = chain(a);
    const chainB = chain(b);
    const rootA = chainA[chainA.length - 1]!;
    const rootB = chainB[chainB.length - 1]!;
    if (rootA !== rootB) return roots.indexOf(rootA) - roots.indexOf(rootB);
    if (a.node === b.node) return Number(a.text) - Number(b.text);
    let i = chainA.length - 1;
    let j = chainB.length - 1;
    while (i > 0 && j > 0 && chainA[i - 1] === chainB[j - 1]) {
      i--;
      j--;
    }
    // In the common turn: the entry itself, or the turn it paints in.
    const turn = chainA[i]!;
    const keyA = step(i === 0 ? a : chainA[i - 1]!, turn);
    const keyB = step(j === 0 ? b : chainB[j - 1]!, turn);
    for (let k = 0; k < Math.max(keyA.length, keyB.length); k++) {
      const difference = (keyA[k] ?? -1) - (keyB[k] ?? -1);
      if (difference !== 0) return difference;
    }
    return 0;
  };
}
