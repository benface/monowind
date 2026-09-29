import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeIndex } from "../src/animation.ts";
import { focusableRects } from "../src/focus.ts";
import { paintGrid } from "../src/paint.ts";
import { hitChain } from "../src/pointer.ts";
import { generatedElements, readGenerated } from "../src/generated.ts";
import type { Pseudo } from "../src/generated.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderCellSegments, renderPlainText } from "../src/plain-text.ts";
import { render } from "../src/render.ts";
import {
  charIndexAt,
  isTextLeaf,
  leafExtent,
  positionOf,
  selectedRanges,
  serializeSelection,
} from "../src/selection.ts";
import { sheetRules } from "../src/sheets.ts";
import { readCellStyle } from "../src/style.ts";
import { buildTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

afterEach(() => vi.restoreAllMocks());

/** Serve each `[data-test]` element's pseudo-element its style from a
 * stand-in span holding its declarations — happy-dom computes no
 * pseudo-element style — and give each a rule, so the engine reads
 * them. */
function pseudoStyles(
  styles: [name: string, pseudo: Pseudo | "::marker", declarations: string][],
): void {
  const standIns = new Map<string, Element>();
  for (const [name, pseudo, declarations] of styles) {
    const standIn = document.createElement("span");
    standIn.style.cssText = declarations;
    document.body.append(standIn);
    standIns.set(`${name}${pseudo}`, standIn);
  }
  const rule = document.createElement("style");
  rule.textContent = styles
    .map(([name, pseudo]) => `[data-test="${name}"]${pseudo} { content: "" }`)
    .join("\n");
  document.head.append(rule);
  const computed = globalThis.getComputedStyle;
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation((target, pseudo) => {
    const name = (target as Element).getAttribute?.("data-test");
    const standIn = pseudo ? standIns.get(`${name}${pseudo}`) : undefined;
    return standIn ? computed(standIn) : computed(target, pseudo);
  });
}

/** The host, filled with `html` where given, laid out in 4px cells
 * (16px root). */
function layOut(html?: string, cols = 20): LayoutNode {
  const host = byTest("host");
  if (html !== undefined) host.innerHTML = html;
  const root = buildTree(host, 16)!;
  layoutRoot(root, cols);
  return root;
}

const rows = (html: string, cols = 20): string[] => renderPlainText(layOut(html, cols)).split("\n");

const byTest = (name: string) => document.querySelector(`[data-test="${name}"]`)!;

/** The nodes under `node` that `pick` takes, in tree order. */
const nodesIn = (node: LayoutNode, pick: (node: LayoutNode) => unknown): LayoutNode[] => [
  ...(pick(node) ? [node] : []),
  ...node.children.flatMap((child) => nodesIn(child, pick)),
];

/** A range's boundary points. */
const points = (
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number,
) => ({
  startContainer,
  startOffset,
  endContainer,
  endOffset,
});

/** A host to fill, its styles reset. */
function newHost(): void {
  vi.restoreAllMocks();
  document.head.querySelectorAll("style").forEach((style) => style.remove());
  document.body.innerHTML = `<div data-test="host"></div>`;
}

/** A style rule as the CSSOM gives one, `content` set or not. */
const styleRule = (selectorText: string, content = "", cssRules: object[] = []) => ({
  selectorText,
  style: { getPropertyValue: (property: string) => (property === "content" ? content : "") },
  cssRules,
});

const generatedOf = (cssRules: object[]) =>
  sheetRules({ cssRules } as unknown as CSSStyleSheet).generated;

describe("the rules that give a pseudo-element content", () => {
  it("name the elements their selectors match, the pseudo-element stripped", () => {
    expect(
      generatedOf([
        styleRule(String.raw`.before\:mr-1::before`, "var(--tw-content)"),
        styleRule(String.raw`.md\:before\:mr-1::before, .hover\:after\:x:hover::after`, '""'),
        styleRule(".a:hover::after, .b > ::before, .f ::after, ::before, .c", '"x"'),
        styleRule("q:before", '"«"'),
        styleRule(".d::before", ""),
        styleRule(".e::marker", '"•"'),
      ]),
    ).toEqual({
      "::before": [String.raw`.before\:mr-1`, String.raw`.md\:before\:mr-1`, ".b > *", "*", "q"],
      "::after": [String.raw`.hover\:after\:x:hover`, ".a:hover", ".f *"],
    });
  });

  it("resolve a nested rule against its parent's selectors", () => {
    expect(
      generatedOf([
        styleRule(".card", "", [styleRule("&::after", '""'), styleRule(".icon::before", '"→"')]),
      ]),
    ).toEqual({ "::before": [":is(.card) .icon"], "::after": [":is(.card)"] });
  });

  it("read a container query's, whose condition the element's own style resolves", () => {
    const container = { containerName: "", conditionText: "(width > 1px)" };
    expect(generatedOf([{ ...container, cssRules: [styleRule(".c::before", '"x"')] }])).toEqual({
      "::before": [".c"],
      "::after": [],
    });
  });

  it("leave out the engine's own, keyed on its flags", () => {
    expect(
      generatedOf([styleRule(`mono-wind [data-mw-scroll="after"]::after, .x::after`, '""')]),
    ).toEqual({ "::before": [], "::after": [".x"] });
  });

  it("drop a selector no engine parses", () => {
    expect(generatedOf([styleRule("a!b::before, .tag::before", '"x"')])).toEqual({
      "::before": [".tag"],
      "::after": [],
    });
  });

  it("match the host's elements, each pseudo-element's apart, and every q", () => {
    document.body.innerHTML = `<style>.tag::before { content: "#" }</style>
      <div data-test="host"><span class="tag">a</span><span>b</span><q>c</q></div>`;
    const host = byTest("host");
    const texts = (elements: ReadonlySet<Element>) => Array.from(elements, (el) => el.textContent);
    const { "::before": before, "::after": after } = generatedElements(host);
    expect([texts(before), texts(after)]).toEqual([["a", "c"], ["c"]]);
  });
});

describe("a pseudo-element's reads", () => {
  it("read its content's parts, and none without content", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: "→ " counter(step)`]]);
    byTest("host").innerHTML = `<p data-test="p">p</p>`;
    const p = byTest("p");
    expect(readGenerated(p, "::before")!.parts).toEqual([
      "→ ",
      { counter: "step", style: "decimal" },
    ]);
    expect(readGenerated(p, "::after")).toBeNull();
  });

  it("leave its variant's classes to it, the element reading none of them", () => {
    document.body.innerHTML = `<p data-test="p" class="before:w-4 after:h-2 hover:before:w-2 w-3">p</p>`;
    const style = readCellStyle(byTest("p"), 16);
    expect(style.width).toEqual({ kind: "cells", value: 3 });
    expect(style.height).toBeUndefined();
  });

  it("read its box from its own style, none of its element's own state", () => {
    newHost();
    pseudoStyles([
      ["card", "::before", `content: ""; position: absolute; width: 16px; height: 4px`],
    ]);
    byTest("host").innerHTML = `<div data-test="card" class="relative" popover>c</div>`;
    const card = byTest("card");
    const generated = readGenerated(card, "::before")!;
    expect(readCellStyle(card, 16, undefined, { generated })).toMatchObject({
      position: "absolute",
      width: { kind: "cells", value: 4 },
      topLayer: false,
      backdrop: null,
      anchorNames: [],
      marker: null,
    });
  });
});

describe("a pseudo-element box's declared lengths", () => {
  it("read as computed, its box off for the read, where no class names them", () => {
    newHost();
    pseudoStyles([
      [
        "card",
        "::after",
        'content: ""; position: absolute; top: 0; right: 0; width: 50%; height: 8px',
      ],
    ]);
    byTest("host").innerHTML = `<div data-test="card">c</div>`;
    const card = byTest("card");
    const generated = readGenerated(card, "::after")!;
    expect(readCellStyle(card, 16, undefined, { generated })).toMatchObject({
      width: { kind: "percent", value: 50 },
      height: { kind: "cells", value: 2 },
      insets: { top: 0, right: 0, bottom: null, left: null },
    });
    expect(card.hasAttribute("data-mw-after-declared")).toBe(false);
  });
});

describe("generated text", () => {
  it("opens and closes its element's text: a span's, a leaf's, a container's in runs of their own", () => {
    newHost();
    pseudoStyles([
      ["span", "::before", `content: "→ "`],
      ["leaf", "::before", `content: "["`],
      ["leaf", "::after", `content: "]"`],
      ["box", "::before", `content: "top"`],
      ["box", "::after", `content: "end"`],
    ]);
    expect(
      rows(`<p>a <span data-test="span">b</span> c</p>
        <p data-test="leaf">d</p>
        <div data-test="box"><p>e</p></div>`),
    ).toEqual(["a → b c", "[d]", "top", "e", "end"]);
  });

  it("wraps with its line", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: "one two "`]]);
    expect(rows(`<p data-test="p">three four</p>`, 8)).toEqual(["one two", "three", "four"]);
  });

  it("takes its padding and margins as cells, only its padding its background", () => {
    newHost();
    pseudoStyles([
      [
        "p",
        "::before",
        `content: "→"; padding: 0 4px; margin-right: 8px; background-color: rgb(0, 0, 255)`,
      ],
    ]);
    expect(rows(`<p data-test="p">x</p>`)).toEqual([" →   x"]);
    const root = layOut();
    const [row] = renderCellSegments(root);
    expect(row!.slice(0, 2)).toMatchObject([
      { text: " → ", backgroundColor: "rgb(0, 0, 255)" },
      { text: expect.stringMatching(/^  x/) },
    ]);
    expect(row![1]!.backgroundColor).toBeUndefined();
  });

  it("paints in its own color", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: "→ "; color: rgb(255, 0, 0)`]]);
    const root = layOut(`<p data-test="p">x</p>`);
    const [row] = renderCellSegments(root);
    expect(row![0]).toMatchObject({ text: "→ ", color: "rgb(255, 0, 0)" });
  });
});

describe("pseudo-element boxes", () => {
  /** Each pseudo-element box under the host: its pseudo-element and rect. */
  const boxes = (cols = 20) => {
    const root = layOut(undefined, cols);
    const found = nodesIn(root, (node) => node.generated).map(({ generated, localRect, text }) => {
      const { x, y, width, height } = localRect;
      return `${generated!.pseudo} ${x},${y} ${width}x${height} "${text}"`;
    });
    return { root, found };
  };

  it("builds an absolutely positioned one against its containing block, painting its fill", () => {
    newHost();
    pseudoStyles([
      [
        "card",
        "::after",
        `content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: rgb(255, 0, 0)`,
      ],
    ]);
    byTest("host").innerHTML =
      `<div data-test="card" class="after:inset-0" style="position: relative; width: 20px; height: 8px">z</div>`;
    const { root, found } = boxes();
    expect(found).toEqual(['::after 0,0 5x2 ""']);
    const [first] = renderCellSegments(root);
    expect(first![0]).toMatchObject({ backgroundColor: "rgb(255, 0, 0)" });
  });

  it("builds a block one on rows of its own, an inline-block one in its line", () => {
    newHost();
    pseudoStyles([
      ["box", "::before", `content: "head"; display: block`],
      ["p", "::before", `content: "ab"; display: inline-block; width: 16px`],
    ]);
    expect(
      rows(`<div data-test="box"><p>body</p></div><p data-test="p" class="before:w-4">x</p>`),
    ).toEqual(["head", "body", "ab  x"]);
  });

  it("splits an inline element around a block one, as around a block child", () => {
    newHost();
    pseudoStyles([["a", "::after", `content: "X"; display: block`]]);
    expect(rows(`<p>a <a data-test="a">link</a> c</p>`)).toEqual(["a link", "X", "c"]);
  });

  it("floats a floated one, its line wrapping beside it", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: "#"; float: left; width: 8px; height: 8px`]]);
    byTest("host").innerHTML = `<p data-test="p" class="before:w-2 before:h-2">one two</p>`;
    const { root, found } = boxes(6);
    expect(found).toEqual(['::before 0,0 2x2 "#"']);
    expect(renderPlainText(root).split("\n")).toEqual(["# one", "  two"]);
  });
});

describe("counters and quotes", () => {
  it("count a pseudo-element's counters in CSS's order: its element's ::before, children, ::after", () => {
    newHost();
    pseudoStyles([
      ["list", "::before", `content: ""; counter-reset: step 4`],
      ["list", "::after", `content: "of " counter(step)`],
      ["a", "::before", `content: counter(step) ". "; counter-increment: step`],
      ["b", "::before", `content: counter(step) ". "; counter-increment: step`],
    ]);
    expect(
      rows(`<div data-test="list"><p data-test="a">a</p><p data-test="b">b</p></div>`),
    ).toEqual(["5. a", "6. b", "of 6"]);
  });

  it("walk the counters once a build, however many runs read them", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: counter(item) ". "; counter-increment: item`]]);
    const reads = (count: number) => {
      const spy = vi.mocked(globalThis.getComputedStyle);
      rows(`<p data-test="p">x</p>`.repeat(count));
      const before = spy.mock.calls.length;
      rows(`<p data-test="p">x</p>`.repeat(count));
      return spy.mock.calls.length - before;
    };
    const ten = reads(10);
    expect(reads(20)).toBeLessThan(ten * 2.5);
  });

  it("write quotes from their depth in tree order, the last pair past the deepest", () => {
    newHost();
    const quoted = (quotes = "") =>
      (["outer", "inner", "deep"] as const).flatMap((name) => [
        [name, "::before", `content: open-quote; ${quotes}`] as [string, Pseudo, string],
        [name, "::after", `content: close-quote; ${quotes}`] as [string, Pseudo, string],
      ]);
    const html = (lang: string) =>
      `<p lang="${lang}" data-test="outer">a <span data-test="inner">b <span data-test="deep">c</span></span></p>`;
    pseudoStyles(quoted());
    expect(rows(html("en"))).toEqual(["“a ‘b ‘c’’”"]);
    expect(rows(html("fr"))).toEqual(["«a «b «c»»»"]);
    expect(rows(html("fr-CA"))).toEqual(["«a ”b ”c““»"]);
    expect(rows(html("de-AT"))).toEqual(["„a ‚b ‚c‘‘“"]);
    expect(rows(html("ja"))).toEqual(["「a 『b 『c』』」"]);
    expect(rows(html("tlh"))).toEqual(["“a ‘b ‘c’’”"]);
    newHost();
    pseudoStyles(quoted(`quotes: "<" ">"`));
    expect(rows(html("en"))).toEqual(["<a <b <c>>>"]);
  });

  it("move the depth with no-open-quote and no-close-quote, never below 0", () => {
    newHost();
    pseudoStyles([
      ["skip", "::before", `content: no-open-quote`],
      ["q", "::before", `content: open-quote`],
      ["q", "::after", `content: close-quote close-quote close-quote "!"`],
    ]);
    expect(rows(`<p data-test="skip">a <span data-test="q">b</span></p>`)).toEqual(["a ‘b’”!"]);
  });

  it("give a marker's quote its depth, before its item's ::before", () => {
    newHost();
    pseudoStyles([
      ["item", "::marker", `content: open-quote`],
      ["item", "::before", `content: open-quote`],
      ["item", "::after", `content: close-quote close-quote`],
    ]);
    expect(
      rows(`<ol><li data-test="item" style="list-style-position: inside">a</li></ol>`),
    ).toEqual(["“‘a’”"]);
  });
});

describe("selection and copy of generated text", () => {
  /** The host laid out, and its text leaves. */
  const laidOut = (html: string) => {
    const root = layOut(html, 40);
    return { root, leaves: nodesIn(root, isTextLeaf) };
  };

  it("stand a ::before's characters at its element's start, an ::after's at its end", () => {
    newHost();
    pseudoStyles([
      ["s", "::before", `content: "→ "`],
      ["s", "::after", `content: "!"`],
    ]);
    const { leaves } = laidOut(`<p>a <span data-test="s">b</span> c</p>`);
    const [leaf] = leaves;
    expect(leaf!.text).toBe("a → b! c");
    const span = byTest("s");
    const b = span.firstChild!;
    expect(charIndexAt(leaf!, span.parentNode!, 1)).toBe(2);
    expect(charIndexAt(leaf!, span, 0)).toBe(2);
    expect(charIndexAt(leaf!, b, 0)).toBe(4);
    expect(charIndexAt(leaf!, span, 1)).toBe(6);
    expect(charIndexAt(leaf!, span.parentNode!, 2)).toBe(6);
    expect(positionOf(leaf!, 2)).toEqual({ node: span, offset: 0 });
    expect(positionOf(leaf!, 3)).toEqual({ node: span, offset: 0 });
    expect(positionOf(leaf!, 5)).toEqual({ node: span, offset: 1 });
  });

  it("keep a ::before's and an ::after's characters apart, whatever stands between them", () => {
    newHost();
    pseudoStyles([
      ["s", "::before", `content: "["`],
      ["s", "::after", `content: "]"`],
    ]);
    const { leaves } = laidOut(
      `<p><span data-test="s"><b style="display: inline-block">x</b></span></p>`,
    );
    const [leaf] = leaves;
    const span = byTest("s");
    expect(leaf!.text).toBe("[\uFFFC]");
    expect(positionOf(leaf!, 2)).toEqual({ node: span, offset: 1 });
    expect(charIndexAt(leaf!, span, 1)).toBe(3);
  });

  it("highlight and copy it within a range, as its run's text", () => {
    newHost();
    pseudoStyles([
      ["s", "::before", `content: "→ "`],
      ["s", "::after", `content: "!"`],
    ]);
    const { root, leaves } = laidOut(`<p data-test="p">a <span data-test="s">b</span> c</p>`);
    const p = byTest("p");
    const b = byTest("s").firstChild!;
    const whole = points(p, 0, p, p.childNodes.length);
    expect(serializeSelection(root, whole)).toBe("a → b! c");
    expect(selectedRanges(root, whole).get(leaves[0]!)).toEqual({ start: 0, end: 8 });
    expect(serializeSelection(root, points(b, 0, p, p.childNodes.length))).toBe("b! c");
    expect(serializeSelection(root, points(p, 0, b, 1))).toBe("a → b");
  });

  it("copy a pseudo-element box's text where the range holds its edge", () => {
    newHost();
    pseudoStyles([
      ["box", "::before", `content: "head"; display: block`],
      ["box", "::after", `content: "tail"; display: block`],
    ]);
    const { root } = laidOut(`<div data-test="box"><p data-test="p">body</p></div>`);
    const box = byTest("box");
    const body = byTest("p").firstChild!;
    expect(serializeSelection(root, points(box, 0, box, 1))).toBe("head\n\nbody\n\ntail");
    expect(serializeSelection(root, points(box, 0, body, 4))).toBe("head\n\nbody");
    expect(serializeSelection(root, points(body, 0, box, 1))).toBe("body\n\ntail");
    expect(serializeSelection(root, points(body, 0, body, 4))).toBe("body");
  });
});

describe("the light DOM's pseudo-elements", () => {
  /** The host laid out and rendered. */
  const rendered = (html: string) => {
    const root = layOut(html);
    render(root);
    return root;
  };
  const styleOf = (name: string) => (byTest(name) as HTMLElement).style;

  it("write an inline one's cells on its element under its name, none of the element's", () => {
    newHost();
    pseudoStyles([["s", "::before", `content: "→"; padding: 0 4px; margin-right: 8px`]]);
    rendered(`<p>a <span data-test="s" style="padding-left: 4px">b</span></p>`);
    const span = byTest("s");
    const style = styleOf("s");
    expect(span.getAttribute("data-mw-before")).toBe("text");
    expect(style.getPropertyValue("--mw-before-pl")).toBe("1");
    expect(style.getPropertyValue("--mw-before-pr")).toBe("1");
    expect(style.getPropertyValue("--mw-before-ml")).toBe("0");
    expect(style.getPropertyValue("--mw-before-mr")).toBe("2");
    expect(style.getPropertyValue("--mw-ipl")).toBe("1");
    expect(style.getPropertyValue("--mw-ipr")).toBe("");
  });

  it("pin a box's geometry under its name, its element's own kept", () => {
    newHost();
    pseudoStyles([["box", "::before", `content: "head"; display: block`]]);
    rendered(`<div data-test="box" style="padding-left: 4px"><p>body</p></div>`);
    const box = byTest("box");
    const style = styleOf("box");
    expect(box.getAttribute("data-mw-before")).toBe("box");
    expect(box.hasAttribute("data-mw-laid-out")).toBe(true);
    expect(style.getPropertyValue("--mw-before-position")).toBe("absolute");
    expect(style.getPropertyValue("--mw-before-y")).toBe("0");
    expect(style.getPropertyValue("--mw-before-x")).toBe("1");
    expect(style.getPropertyValue("--mw-before-h")).toBe("1");
    expect(style.getPropertyValue("--mw-pl")).toBe("1");
    expect(style.getPropertyValue("--mw-h")).toBe("2");
  });

  it("keep an atomic box in its line, with its margins and alignment", () => {
    newHost();
    pseudoStyles([
      ["a", "::before", `content: "a"; display: inline-block; margin-left: 8px`],
      ["b", "::before", `content: "b"; display: inline-block; vertical-align: bottom`],
      [
        "c",
        "::before",
        `content: "c"; display: inline-block; vertical-align: middle; padding: 4px 0`,
      ],
    ]);
    const spans = ["a", "b", "c"].map((name) => `<span data-test="${name}">${name}</span>`);
    rendered(`<p>x ${spans.join(" ")}</p>`);
    const style = styleOf("a");
    expect(byTest("a").getAttribute("data-mw-before")).toBe("box");
    expect(style.getPropertyValue("--mw-before-position")).toBe("relative");
    expect(style.getPropertyValue("--mw-before-x")).toBe("0");
    expect(style.getPropertyValue("--mw-before-ml")).toBe("2");
    expect(style.getPropertyValue("--mw-before-w")).toBe("1");
    expect(style.getPropertyValue("--mw-before-va")).toBe("top");
    expect(styleOf("b").getPropertyValue("--mw-before-va")).toBe("bottom");
    // A three-row box, drawing no line natively: its bottom edge two rows
    // below the line's text row, from the row's baseline.
    expect(styleOf("c").getPropertyValue("--mw-before-va")).toBe(
      "calc(-2 * var(--mw-ch, 1px) + var(--mw-base, 0px))",
    );
  });

  it("keep a block one in a multi-column flow in its native lines, its gaps padding where spanners split the flow", () => {
    newHost();
    const head = `content: "Head"; display: block; margin-bottom: 4px`;
    pseudoStyles([
      ["flow", "::before", head],
      ["split", "::before", head],
    ]);
    const paragraphs = `<p>one two three four five six</p><p>alpha beta gamma delta</p>`;
    const columns = (name: string, spanner = "") =>
      `<div data-test="${name}" style="column-count: 2; column-gap: 4px">${paragraphs}${spanner}${paragraphs}</div>`;
    rendered(columns("flow") + columns("split", `<h3 style="column-span: all">span</h3>`));
    const written = (name: string) =>
      ["pt", "pb", "mt", "mb", "h"].map((each) =>
        styleOf(name).getPropertyValue(`--mw-before-${each}`),
      );
    expect(byTest("flow").getAttribute("data-mw-before")).toBe("flow");
    expect(written("flow")).toEqual(["0", "0", "0", "1", ""]);
    expect(written("split")).toEqual(["0", "1", "0", "0", ""]);
  });

  it("move an atomic box on a leaded line to its rows from where the line's leading puts it", () => {
    newHost();
    pseudoStyles([
      ["top", "::before", `content: "a"; display: inline-block`],
      ["bottom", "::before", `content: "b"; display: inline-block; vertical-align: bottom`],
    ]);
    rendered(
      `<p style="line-height: 48px">x <span data-test="top">y</span> <span data-test="bottom">z</span></p>`,
    );
    // Two gap rows a line: a row down from its top edge, a row up from
    // its bottom one.
    const y = (name: string) => styleOf(name).getPropertyValue("--mw-before-y");
    expect([y("top"), y("bottom")]).toEqual(["1", "-1"]);
  });

  it("place an absolute box in a container's text run where the run lies", () => {
    newHost();
    pseudoStyles([["s", "::after", `content: "↗"; position: absolute`]]);
    rendered(`<div style="position: relative"><p>head</p>ab <span data-test="s">link</span></div>`);
    const style = styleOf("s");
    expect(style.getPropertyValue("--mw-after-position")).toBe("absolute");
    expect(style.getPropertyValue("--mw-after-x")).toBe("7");
    expect(style.getPropertyValue("--mw-after-y")).toBe("1");
  });

  it("give the scroll spacer the pseudo-element the author leaves free", () => {
    newHost();
    pseudoStyles([
      ["a", "::after", `content: "end"; display: block`],
      ["b", "::before", `content: "top"; display: block`],
      ["b", "::after", `content: "end"; display: block`],
    ]);
    const scroller = (name: string) =>
      `<div data-test="${name}" style="overflow-y: auto; height: 8px"><p>1</p><p>2</p><p>3</p></div>`;
    rendered(`${scroller("a")}${scroller("b")}${scroller("c")}`);
    const side = (name: string) => byTest(name).getAttribute("data-mw-scroll");
    expect([side("a"), side("b"), side("c")]).toEqual(["before", "", "after"]);
  });

  it("clear a box's writes from a pseudo-element now inline", () => {
    newHost();
    pseudoStyles([["box", "::before", `content: "head"; display: block`]]);
    rendered(`<div data-test="box"><p>body</p></div>`);
    const box = byTest("box");
    expect(box.getAttribute("data-mw-before")).toBe("box");
    vi.restoreAllMocks();
    pseudoStyles([["box", "::before", `content: "head"`]]);
    const root = layOut();
    render(root);
    expect(box.getAttribute("data-mw-before")).toBe("text");
    expect(box.getAttribute("style")).not.toContain("--mw-before-x");
  });

  it("clear a pseudo-element's writes where a layout writes none", () => {
    newHost();
    pseudoStyles([["box", "::before", `content: "head"; display: block`]]);
    rendered(`<div data-test="box"><p>body</p></div>`);
    vi.restoreAllMocks();
    document.head.querySelectorAll("style").forEach((style) => style.remove());
    const root = layOut();
    render(root);
    const box = byTest("box");
    expect([...box.attributes].map((attribute) => attribute.name).join(" ")).not.toContain(
      "before",
    );
    expect(box.getAttribute("style")).not.toContain("before");
  });
});

describe("a pseudo-element box beside its element's", () => {
  const generatedIn = (node: LayoutNode) => nodesIn(node, (each) => each.generated);

  it("leaves its element the element's own node in the node index", () => {
    newHost();
    pseudoStyles([["box", "::after", `content: "tail"; display: block`]]);
    const root = layOut(`<div data-test="box"><p>body</p></div>`);
    const box = byTest("box");
    expect(nodeIndex(root).get(box)!.generated).toBeUndefined();
  });

  it("takes the decorations and opacity of its element's chain, none from past the host", () => {
    document.body.innerHTML = `<div style="text-decoration: underline; opacity: 0.5"><div data-test="host"></div></div>`;
    vi.restoreAllMocks();
    pseudoStyles([["box", "::before", `content: "head"; display: block`]]);
    const root = layOut(`<div data-test="box"><p>body</p></div>`);
    const [head] = generatedIn(root);
    expect(head!.style.textDecoration.line).toBe("none");
    expect(head!.inlineOpacity ?? 1).toBe(1);
  });

  it("takes its place among its leaf's atomic boxes", () => {
    newHost();
    pseudoStyles([["s", "::after", `content: "zz"; display: inline-block`]]);
    expect(
      rows(`<p><span data-test="s"><b style="display: inline-block">x</b></span> y</p>`),
    ).toEqual(["xzz y"]);
  });

  it("takes a flex leaf's static slot, an absolute one of its own", () => {
    newHost();
    pseudoStyles([["f", "::after", `content: "x"; position: absolute`]]);
    const root = layOut(
      `<div data-test="f" style="display: flex; position: relative; justify-content: flex-end; width: 40px">ab</div>`,
    );
    const [after] = generatedIn(root);
    const own = layOut(
      `<div style="display: flex; position: relative; justify-content: flex-end; width: 40px">ab<i style="position: absolute">x</i></div>`,
    );
    const italic = own.children[0]!.children[0]!;
    expect(after!.localRect).toMatchObject({ x: italic.localRect.x, y: italic.localRect.y });
  });

  it("is no element of its own to focus, its inline text its element's", () => {
    newHost();
    pseudoStyles([
      ["link", "::before", `content: "→ "; visibility: hidden`],
      ["link", "::after", `content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0`],
    ]);
    const root = layOut(
      `<div style="position: relative; height: 12px"><a data-test="link" href="#">go</a></div>`,
    );
    const rects = focusableRects(root).map(({ element, rect }) => [
      element.getAttribute("data-test"),
      rect,
    ]);
    expect(rects).toEqual([["link", { x: 0, y: 0, width: 4, height: 1 }]]);
  });

  it("maps no point of its element to an atomic one's character", () => {
    newHost();
    pseudoStyles([["s", "::before", `content: "#"; display: inline-block`]]);
    const root = layOut(`<p>a <span data-test="s">b</span></p>`);
    const leaf = root.children[0] ?? root;
    const b = byTest("s").firstChild!;
    expect(leaf.text).toBe("a \uFFFCb");
    expect(charIndexAt(leaf, b, 0)).toBe(3);
    expect(charIndexAt(leaf, b.parentNode!, 0)).toBe(2);
  });

  it("hits its element on a generated cell", () => {
    newHost();
    pseudoStyles([["link", "::before", `content: "→ "`]]);
    const root = layOut(`<p>a <a data-test="link" href="#">go</a></p>`);
    expect(hitChain(root, 2, 0, null).at(-1)).toBe(byTest("link"));
  });

  it("reads a button's, and no input's or img's", () => {
    newHost();
    pseudoStyles([
      ["button", "::before", `content: "> "`],
      ["input", "::before", `content: "x"`],
      ["img", "::before", `content: "y"`],
    ]);
    const html = `<button data-test="button">ok</button><input data-test="input"><img data-test="img" alt="">`;
    expect(rows(html).join("")).toBe("> ok");
  });

  it("gives an atomic one's run the extent of its element's edge", () => {
    newHost();
    pseudoStyles([["box", "::after", `content: "#"; display: inline-block`]]);
    const root = layOut(`<div data-test="box">a<p>b</p>c</div>`);
    const box = byTest("box");
    const last = root.children[0]!.children.at(-1)!;
    expect(last.anonymous).toBe(true);
    const extent = leafExtent(last)!;
    expect(extent.end).toEqual({ node: box, offset: 3 });
    expect(extent.start).toEqual({ node: box.lastChild, offset: 0 });
  });

  it("copies with one break around a block one, whatever its element", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: "head"; display: block`]]);
    const root = layOut(`<p data-test="p">body</p>`);
    const host = byTest("host");
    expect(serializeSelection(root, points(host, 0, host, 1))).toBe("head\nbody");
  });

  it("is a layer of its own where its effects make one, beside its element's", () => {
    newHost();
    pseudoStyles([["box", "::before", `content: "ab"; display: block; width: 8px; rotate: 45deg`]]);
    const root = layOut(`<div data-test="box" style="rotate: 3deg"><p>body</p></div>`);
    const layers = document.createElement("div");
    paintGrid(root, document.createElement("pre"), { layers, cell: { width: 10, height: 20 } });
    const boxes = [...layers.querySelectorAll<HTMLElement>(".layer")];
    expect(boxes.map((box) => box.style.rotate)).toEqual(["3deg", "45deg"]);
  });

  it("never scrolls: its overflow clips", () => {
    newHost();
    pseudoStyles([
      ["box", "::before", `content: "a b c d"; display: block; height: 4px; overflow: auto`],
    ]);
    const [before] = generatedIn(layOut(`<div data-test="box"><p>x</p></div>`, 2));
    expect(before!.scrollRange).toBeUndefined();
    expect(before!.style.overflow).toEqual({ x: "hidden", y: "hidden" });
  });

  it("takes an absolute one's static position in its line, as an inline box's", () => {
    newHost();
    pseudoStyles([["p", "::after", `content: "x"; position: absolute`]]);
    const root = layOut(`<div style="position: relative"><p data-test="p">ab</p></div>`);
    const [after] = generatedIn(root);
    expect(after!.localRect).toMatchObject({ x: 2, y: 0 });
  });
});

describe("the reads a build makes", () => {
  /** Each pseudo-element's `getComputedStyle` calls in a build, by
   * element and pseudo-element. */
  const readsIn = (html: string): Record<string, number> => {
    const host = byTest("host");
    host.innerHTML = html;
    const spy = vi.mocked(globalThis.getComputedStyle);
    const before = spy.mock.calls.length;
    buildTree(host, 16);
    const counts: Record<string, number> = {};
    for (const [target, pseudo] of spy.mock.calls.slice(before)) {
      if (!pseudo) continue;
      const key = `${(target as Element).getAttribute("data-test")}${pseudo}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  it("read each pseudo-element a rule gives content once, and no other", () => {
    newHost();
    pseudoStyles([
      ["p", "::before", `content: counter(n) ". "; counter-increment: n`],
      ["box", "::after", `content: ""; position: absolute; top: 0; left: 0`],
    ]);
    expect(
      readsIn(`<div data-test="box" style="position: relative"><p data-test="p">x</p></div>`),
    ).toEqual({ "p::before": 1, "box::after": 1 });
  });

  it("build a leaf's positioned box once", () => {
    newHost();
    pseudoStyles([["box", "::after", `content: ""; position: absolute; top: 0; left: 0`]]);
    const set = vi.spyOn(Element.prototype, "setAttribute");
    readsIn(`<p data-test="box" style="position: relative">z</p>`);
    const reads = set.mock.calls.filter(([name]) => name === "data-mw-after-declared");
    expect(reads).toHaveLength(1);
  });

  it("write quotes without walking the counters", () => {
    newHost();
    pseudoStyles([
      ["q", "::before", `content: open-quote`],
      ["q", "::after", `content: close-quote`],
    ]);
    const spy = vi.mocked(globalThis.getComputedStyle);
    const elementReads = (html: string) => {
      const host = byTest("host");
      host.innerHTML = html;
      const before = spy.mock.calls.length;
      buildTree(host, 16);
      return spy.mock.calls.slice(before).filter(([, pseudo]) => !pseudo).length;
    };
    const spans = "<span>a</span>".repeat(20);
    expect(elementReads(`<p>${spans}<b data-test="q">q</b></p>`)).toBe(
      elementReads(`<p>${spans}<b>q</b></p>`),
    );
  });

  it("read a list item's marker once, the counter walk sharing it", () => {
    newHost();
    pseudoStyles([
      ["p", "::before", `content: counter(list-item) ". "`],
      ["item", "::marker", `content: counter(list-item) ") "`],
    ]);
    expect(
      readsIn(
        `<p data-test="p">x</p><ol><li data-test="item">a</li><li data-test="item">b</li></ol>`,
      ),
    ).toEqual({ "p::before": 1, "item::marker": 2 });
  });
});

describe("an empty inline pseudo-element", () => {
  it("takes its padding and margins' cells, and draws its background on its padding", () => {
    newHost();
    pseudoStyles([
      ["p", "::before", `content: ""; padding: 0 4px; margin-right: 4px; background-color: red`],
    ]);
    expect(rows(`<p data-test="p">x</p>`)).toEqual(["   x"]);
  });

  it("flags an image its native box must not draw", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: url(icon.svg)`]]);
    const root = layOut(`<p data-test="p">x</p>`);
    render(root);
    expect(renderPlainText(root)).toBe("x");
    expect(byTest("p").getAttribute("data-mw-before")).toBe("image");
  });

  it("builds nothing where it takes no cell", () => {
    newHost();
    pseudoStyles([["p", "::before", `content: ""; background-color: red`]]);
    const root = layOut(`<p data-test="p">x</p>`);
    render(root);
    expect(root.children[0]?.inlineElements ?? root.inlineElements).toBeUndefined();
    expect(byTest("p").hasAttribute("data-mw-before")).toBe(false);
  });
});
