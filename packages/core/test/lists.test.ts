import { describe, expect, it, vi } from "vitest";
import {
  counterStyles,
  counterText,
  contentParts,
  countersOf,
  markerParts,
  markerText,
  pageCounterStyles,
  parseChanges,
  partText,
  parseResets,
  styleOfRule,
  withBullets,
} from "../src/counters.ts";
import { layoutRoot } from "../src/layout.ts";
import { renderCellSegments, renderPlainText } from "../src/plain-text.ts";
import { hitStack } from "../src/pointer.ts";
import { render } from "../src/render.ts";
import { selectedRanges, serializeSelection } from "../src/selection.ts";
import { readCellStyle } from "../src/style.ts";
import { buildTree, counterTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";
import type { CounterStyleDescriptors } from "../src/counters.ts";

describe("predefined counter styles", () => {
  it("reads each at 1 and 27 as Chromium does", () => {
    // Chromium's accessibility tree names each marker (probed 2026-09-28);
    // its square is ■, where the grid's glyph role is ▪.
    const table: [string, number, string][] = [
      ["decimal", 1, "1. "],
      ["decimal", 27, "27. "],
      ["decimal-leading-zero", 1, "01. "],
      ["decimal-leading-zero", 27, "27. "],
      ["arabic-indic", 1, "١. "],
      ["arabic-indic", 27, "٢٧. "],
      ["armenian", 1, "Ա. "],
      ["armenian", 27, "ԻԷ. "],
      ["upper-armenian", 1, "Ա. "],
      ["upper-armenian", 27, "ԻԷ. "],
      ["lower-armenian", 1, "ա. "],
      ["lower-armenian", 27, "իէ. "],
      ["bengali", 1, "১. "],
      ["bengali", 27, "২৭. "],
      ["cambodian", 1, "១. "],
      ["cambodian", 27, "២៧. "],
      ["khmer", 1, "១. "],
      ["khmer", 27, "២៧. "],
      ["cjk-decimal", 1, "一、"],
      ["cjk-decimal", 27, "二七、"],
      ["devanagari", 1, "१. "],
      ["devanagari", 27, "२७. "],
      ["georgian", 1, "ა. "],
      ["georgian", 27, "კზ. "],
      ["gujarati", 1, "૧. "],
      ["gujarati", 27, "૨૭. "],
      ["gurmukhi", 1, "੧. "],
      ["gurmukhi", 27, "੨੭. "],
      ["hebrew", 1, "א. "],
      ["hebrew", 27, "כז. "],
      ["kannada", 1, "೧. "],
      ["kannada", 27, "೨೭. "],
      ["lao", 1, "໑. "],
      ["lao", 27, "໒໗. "],
      ["malayalam", 1, "൧. "],
      ["malayalam", 27, "൨൭. "],
      ["mongolian", 1, "᠑. "],
      ["mongolian", 27, "᠒᠗. "],
      ["myanmar", 1, "၁. "],
      ["myanmar", 27, "၂၇. "],
      ["oriya", 1, "୧. "],
      ["oriya", 27, "୨୭. "],
      ["persian", 1, "۱. "],
      ["persian", 27, "۲۷. "],
      ["lower-roman", 1, "i. "],
      ["lower-roman", 27, "xxvii. "],
      ["upper-roman", 1, "I. "],
      ["upper-roman", 27, "XXVII. "],
      ["tamil", 1, "௧. "],
      ["tamil", 27, "௨௭. "],
      ["telugu", 1, "౧. "],
      ["telugu", 27, "౨౭. "],
      ["thai", 1, "๑. "],
      ["thai", 27, "๒๗. "],
      ["tibetan", 1, "༡. "],
      ["tibetan", 27, "༢༧. "],
      ["lower-alpha", 1, "a. "],
      ["lower-alpha", 27, "aa. "],
      ["lower-latin", 1, "a. "],
      ["lower-latin", 27, "aa. "],
      ["upper-alpha", 1, "A. "],
      ["upper-alpha", 27, "AA. "],
      ["upper-latin", 1, "A. "],
      ["upper-latin", 27, "AA. "],
      ["lower-greek", 1, "α. "],
      ["lower-greek", 27, "αγ. "],
      ["hiragana", 1, "あ、"],
      ["hiragana", 27, "ひ、"],
      ["hiragana-iroha", 1, "い、"],
      ["hiragana-iroha", 27, "お、"],
      ["katakana", 1, "ア、"],
      ["katakana", 27, "ヒ、"],
      ["katakana-iroha", 1, "イ、"],
      ["katakana-iroha", 27, "オ、"],
      ["disc", 1, "• "],
      ["disc", 27, "• "],
      ["circle", 1, "◦ "],
      ["circle", 27, "◦ "],
      ["square", 1, "▪ "],
      ["square", 27, "▪ "],
      ["disclosure-open", 1, "▾ "],
      ["disclosure-open", 27, "▾ "],
      ["disclosure-closed", 1, "▸ "],
      ["disclosure-closed", 27, "▸ "],
      ["cjk-earthly-branch", 1, "子、"],
      ["cjk-earthly-branch", 27, "二七、"],
      ["cjk-heavenly-stem", 1, "甲、"],
      ["cjk-heavenly-stem", 27, "二七、"],
    ];
    const wrong = table.filter(([name, value, text]) => markerText(value, name) !== text);
    expect(wrong).toEqual([]);
  });

  it("falls back past a style's range, and for 0 and negatives where the system has none", () => {
    expect(markerText(3999, "lower-roman")).toBe("mmmcmxcix. ");
    expect(markerText(4000, "upper-roman")).toBe("4000. ");
    expect(markerText(0, "upper-roman")).toBe("0. ");
    expect(markerText(0, "lower-alpha")).toBe("0. ");
    expect(markerText(-3, "lower-alpha")).toBe("-3. ");
    expect(markerText(0, "lower-greek")).toBe("0. ");
    expect(markerText(19999, "georgian")).toBe("ჵჰშჟთ. ");
    // Past the fixed symbols, cjk-decimal; below 0, its own fallback,
    // the marker keeping the style's suffix.
    expect(markerText(13, "cjk-earthly-branch")).toBe("一三、");
    expect(markerText(-3, "cjk-heavenly-stem")).toBe("-3、");
    expect(markerText(-3, "cjk-decimal")).toBe("-3、");
  });

  it("keeps css-counter-styles-3's ranges where Chromium extends them, as WebKit does", () => {
    expect(markerText(10000, "armenian")).toBe("10000. ");
    expect(markerText(0, "hebrew")).toBe("0. ");
    expect(markerText(11000, "hebrew")).toBe("11000. ");
  });

  it("counts a sign toward decimal-leading-zero's pad", () => {
    expect(markerText(3, "decimal-leading-zero")).toBe("03. ");
    expect(markerText(0, "decimal-leading-zero")).toBe("00. ");
    expect(markerText(-3, "decimal-leading-zero")).toBe("-3. ");
    expect(markerText(27, "decimal-leading-zero")).toBe("27. ");
  });

  it("reads an unknown name as decimal, and counter() as the bare representation", () => {
    expect(markerText(4, "not-a-style")).toBe("4. ");
    expect(counterText(27, "lower-alpha")).toBe("aa");
    expect(counterText(-3, "decimal")).toBe("-3");
  });
});

/** A rule's descriptors, empty where it leaves one out. */
const rule = (descriptors: Partial<CounterStyleDescriptors>): CounterStyleDescriptors => ({
  system: "",
  symbols: "",
  additiveSymbols: "",
  negative: "",
  prefix: "",
  suffix: "",
  range: "",
  pad: "",
  fallback: "",
  ...descriptors,
});

describe("@counter-style rules", () => {
  const styles = counterStyles();
  const text = (value: number, descriptors: Partial<CounterStyleDescriptors>) => {
    const counter = styleOfRule(rule(descriptors), styles);
    return (
      counter &&
      markerText(
        value,
        "rule",
        counterStyles((name) => (name === "rule" ? counter : undefined)),
      )
    );
  };

  it("falls back past 60 code points, and pads no further", () => {
    expect(text(1e9, { system: "symbolic", symbols: '"*"' })).toBe("1000000000. ");
    expect(text(60, { system: "symbolic", symbols: '"*"' })).toBe(`${"*".repeat(60)}. `);
    expect(text(1e9, { system: "additive", additiveSymbols: '1 "I"' })).toBe("1000000000. ");
    expect(
      text(7, { system: "numeric", symbols: "0 1 2 3 4 5 6 7 8 9", pad: '1000000000 "0"' }),
    ).toBe(`${"0".repeat(59)}7. `);
  });

  it("reads a comma as an additive symbol", () => {
    expect(text(2, { system: "additive", additiveSymbols: '1 ","' })).toBe(",,. ");
  });

  it("runs each system", () => {
    expect(text(4, { system: "cyclic", symbols: '"a" "b" "c"' })).toBe("a. ");
    expect(text(3, { system: "fixed 3", symbols: "x y" })).toBe("x. ");
    expect(text(5, { system: "fixed 3", symbols: "x y" })).toBe("5. ");
    expect(text(5, { system: "symbolic", symbols: '"*" "†"' })).toBe("***. ");
    expect(text(3, { symbols: '"*"' })).toBe("***. ");
    expect(text(4, { system: "alphabetic", symbols: "a b" })).toBe("ab. ");
    expect(text(5, { system: "numeric", symbols: "0 1" })).toBe("101. ");
    expect(text(8, { system: "additive", additiveSymbols: '5 "V", 1 "I"' })).toBe("VIII. ");
    expect(text(0, { system: "additive", additiveSymbols: '1 "I", 0 "N"' })).toBe("N. ");
  });

  it("takes its prefix, suffix, negative, range, pad and fallback", () => {
    const numeric = { system: "numeric", symbols: "0 1 2 3 4 5 6 7 8 9" };
    expect(text(7, { ...numeric, prefix: '"("', suffix: '") "' })).toBe("(7) ");
    expect(text(-7, { ...numeric, negative: '"(" ")"' })).toBe("(7). ");
    expect(text(7, { ...numeric, pad: '3 "0"' })).toBe("007. ");
    expect(text(7, { ...numeric, range: "1 5, 10 infinite", fallback: "lower-roman" })).toBe(
      "vii. ",
    );
    expect(text(12, { ...numeric, range: "1 5, 10 infinite", fallback: "lower-roman" })).toBe(
      "12. ",
    );
  });

  it("decodes escapes, and draws an image as nothing", () => {
    expect(text(1, { system: "cyclic", symbols: '"\\2022"', suffix: '" "' })).toBe("• ");
    expect(text(1, { system: "cyclic", symbols: 'url("dot.png")', suffix: '" "' })).toBe(" ");
  });

  it("drops a rule CSS drops", () => {
    expect(styleOfRule(rule({ system: "alphabetic", symbols: "a" }), styles)).toBeUndefined();
    expect(styleOfRule(rule({ system: "cyclic" }), styles)).toBeUndefined();
    expect(styleOfRule(rule({ system: "additive" }), styles)).toBeUndefined();
    expect(
      styleOfRule(rule({ system: "cyclic", symbols: "a", pad: "-1 x" }), styles),
    ).toBeUndefined();
    expect(
      styleOfRule(rule({ system: "cyclic", symbols: "a", range: "5 1" }), styles),
    ).toBeUndefined();
  });

  it("extends a style, overriding its descriptors", () => {
    expect(text(4, { system: "extends lower-roman", suffix: '") "' })).toBe("iv) ");
  });
});

describe("the page's counter styles", () => {
  const ruleList = (rules: Record<string, Partial<CounterStyleDescriptors>>) =>
    Object.entries(rules).map(([name, descriptors]) => ({ name, ...rule(descriptors) }));
  /** A node whose document holds the given rules, in one sheet, and
   * counts its reads of the sheet list. */
  const nodeWith = (rules: Record<string, Partial<CounterStyleDescriptors>>) => {
    const sheet = { cssRules: ruleList(rules) };
    const reads = { count: 0 };
    const documentNode = {
      get styleSheets() {
        reads.count++;
        return [sheet];
      },
      adoptedStyleSheets: [],
    };
    const node = {
      getRootNode: () => documentNode,
      ownerDocument: documentNode,
    } as unknown as Node;
    return { node, sheet, reads };
  };

  it("reads a rule over a predefined style, but never over decimal", () => {
    const styles = pageCounterStyles(
      nodeWith({
        "lower-roman": { system: "cyclic", symbols: "r" },
        decimal: { system: "cyclic", symbols: "d" },
        arrow: { system: "cyclic", symbols: '"→"', suffix: '" "' },
      }).node,
    );
    expect(markerText(2, "lower-roman", styles)).toBe("r. ");
    expect(markerText(2, "decimal", styles)).toBe("2. ");
    expect(markerText(2, "arrow", styles)).toBe("→ ");
  });

  it("reads a shadow root's rule over its document's", () => {
    const documentNode = {
      styleSheets: [{ cssRules: ruleList({ star: { symbols: '"*"' }, dash: { symbols: '"-"' } }) }],
      adoptedStyleSheets: [],
    };
    const shadowRoot = {
      styleSheets: [],
      adoptedStyleSheets: [{ cssRules: ruleList({ star: { symbols: '"+"' } }) }],
    };
    const node = { getRootNode: () => shadowRoot, ownerDocument: documentNode } as unknown as Node;
    const styles = pageCounterStyles(node);
    expect(markerText(1, "star", styles)).toBe("+. ");
    expect(markerText(1, "dash", styles)).toBe("-. ");
  });

  it("reads no sheet for a style no rule may define, and a sheet again once its rules change", () => {
    const { node, sheet, reads } = nodeWith({ star: { symbols: '"*"' } });
    const styles = pageCounterStyles(node);
    markerText(1, "decimal", styles);
    markerText(1, "disc", styles);
    expect(reads.count).toBe(0);
    expect(markerText(1, "star", styles)).toBe("*. ");
    expect(markerText(1, "lower-alpha", styles)).toBe("a. ");
    expect(reads.count).toBe(1);
    sheet.cssRules = ruleList({ star: { symbols: '"*"' }, dot: { symbols: '"."' } });
    expect(markerText(1, "dot", pageCounterStyles(node))).toBe(".. ");
  });

  it("read a rule under the conditions that hold, through imports, in sheets that apply", () => {
    const star = ruleList({ star: { symbols: '"*"' } });
    const sheetWith = (cssRules: object[], more: object = {}) => ({ cssRules, ...more });
    const stylesOf = (...sheets: object[]) => {
      const documentNode = { styleSheets: sheets, adoptedStyleSheets: [] };
      const node = { getRootNode: () => documentNode, ownerDocument: documentNode };
      return pageCounterStyles(node as unknown as Node);
    };
    const media = (mediaText: string, cssRules: object[]) => ({
      media: { mediaText },
      conditionText: mediaText,
      cssRules,
    });
    expect(markerText(1, "star", stylesOf(sheetWith([media("print", star)])))).toBe("1. ");
    expect(markerText(1, "star", stylesOf(sheetWith([media("screen", star)])))).toBe("*. ");
    expect(markerText(1, "star", stylesOf(sheetWith([{ cssRules: star }])))).toBe("*. ");
    expect(
      markerText(
        1,
        "star",
        stylesOf(sheetWith([{ conditionText: "(x: y)", containerName: "", cssRules: star }])),
      ),
    ).toBe("1. ");
    const imported = { media: { mediaText: "" }, styleSheet: sheetWith(star) };
    expect(markerText(1, "star", stylesOf(sheetWith([imported])))).toBe("*. ");
    expect(markerText(1, "star", stylesOf(sheetWith(star, { disabled: true })))).toBe("1. ");
    expect(
      markerText(1, "star", stylesOf(sheetWith(star, { media: { mediaText: "print" } }))),
    ).toBe("1. ");
    vi.stubGlobal("CSS", { supports: () => false });
    expect(
      markerText(1, "star", stylesOf(sheetWith([{ conditionText: "(x: y)", cssRules: star }]))),
    ).toBe("1. ");
    vi.unstubAllGlobals();
  });

  it("read a sheet again when its rules are replaced", () => {
    const { node, sheet } = nodeWith({ star: { symbols: '"*"' } });
    expect(markerText(1, "star", pageCounterStyles(node))).toBe("*. ");
    sheet.cssRules = ruleList({ star: { symbols: '"+"' } });
    expect(markerText(1, "star", pageCounterStyles(node))).toBe("+. ");
  });

  it("extends decimal where an extends chain loops, whichever style is read first", () => {
    const rules = {
      a: { system: "extends b", prefix: '"x"' },
      b: { system: "extends a", suffix: '"b"' },
      c: { system: "extends a" },
    };
    const aFirst = pageCounterStyles(nodeWith(rules).node);
    expect(markerText(3, "a", aFirst)).toBe("x3. ");
    expect(markerText(3, "b", aFirst)).toBe("3b");
    const bFirst = pageCounterStyles(nodeWith(rules).node);
    expect(markerText(3, "b", bFirst)).toBe("3b");
    expect(markerText(3, "a", bFirst)).toBe("x3. ");
    expect(markerText(3, "c", bFirst)).toBe("x3. ");
  });
});

describe("numbering", () => {
  /** The host's counters, as the walk reads them. */
  const countersIn = (html: string) => {
    document.body.innerHTML = `<div data-test="host">${html}</div>`;
    const host = document.querySelector('[data-test="host"]')!;
    const values = countersOf(counterTree(host)!);
    const items = Array.from(host.querySelectorAll("*")).filter((el) => values.has(el));
    return { host, values, items };
  };
  /** Each list item's number, in tree order. */
  const numbers = (html: string) => {
    const { values, items } = countersIn(html);
    return items.map((item) => values.get(item)!.get("list-item")!.at(-1));
  };

  it.each([
    ["from 1", "<ol><li><li><li></ol>", [1, 2, 3]],
    ["from start", '<ol start="5"><li><li></ol>', [5, 6]],
    ["from a zero start", '<ol start="0"><li><li></ol>', [0, 1]],
    ["from a negative start", '<ol start="-2"><li><li></ol>', [-2, -1]],
    ["from a start HTML parses", '<ol start=" 3rd"><li></ol><ol start="x"><li></ol>', [3, 1]],
    ["reversed", "<ol reversed><li><li><li></ol>", [3, 2, 1]],
    ["reversed from start", '<ol reversed start="10"><li><li></ol>', [10, 9]],
    ["reversed from a zero start", '<ol reversed start="0"><li><li></ol>', [0, -1]],
    [
      "up and down through values",
      '<ol><li><li value="7"><li><li value="2"><li></ol>',
      [1, 7, 8, 2, 3],
    ],
    ["reversed around a value", '<ol reversed><li><li value="10"><li></ol>', [11, 10, 9]],
    ["in nested lists", "<ol><li><ol><li><li></ol></li><li></ol>", [1, 1, 2, 2]],
    [
      "reversed around a nested list",
      "<ol reversed><li><ol><li><li><li></ol></li><li></ol>",
      [2, 1, 2, 3, 1],
    ],
    [
      "in flex and grid lists",
      '<ol style="display: flex"><li><li></ol><ol style="display: grid"><li></ol>',
      [1, 2, 1],
    ],
    ["past display: none items", '<ol><li><li style="display: none"><li></ol>', [1, 2]],
    [
      "through hidden, absolute, floated and sr-only items",
      `<ol><li style="visibility: hidden"><li style="position: absolute"><li style="float: left">
        <li style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)"><li></ol>`,
      [1, 2, 3, 4, 5],
    ],
    ["around a div, and in one", "<ol><li><div></div><li><div><li></div><li></ol>", [1, 2, 3, 4]],
    [
      "from an item's counter-set",
      '<ol><li><li style="counter-set: list-item 5"><li></ol>',
      [1, 5, 6],
    ],
    [
      "by an item's counter-increment",
      '<ol><li style="counter-increment: list-item 3"><li></ol>',
      [3, 4],
    ],
    [
      "past an item that increments list-item by 0",
      '<ol><li><div style="display: list-item; counter-increment: list-item 0"></div><li></ol>',
      [1, 1, 2],
    ],
    ["outside any list", "<li><li>", [1, 2]],
    ["from a list's counter-reset", '<ol style="counter-reset: list-item 4"><li><li></ol>', [5, 6]],
    [
      "from any element's counter-reset",
      '<div style="counter-reset: list-item 4"><li><li></div>',
      [5, 6],
    ],
    [
      "from a counter-reset over start",
      '<ol start="10" style="counter-reset: list-item 4"><li></ol>',
      [5],
    ],
    [
      "from a counter-set over value",
      '<ol><li value="7" style="counter-set: list-item 3"></ol>',
      [3],
    ],
    [
      "restarting in a list whose counter-reset names another counter",
      '<ol><li><li><ol style="counter-reset: other"><li></ol><ol style="counter-reset: none"><li></ol></ol>',
      [1, 2, 1, 1],
    ],
    [
      "from a later sibling's reset, which replaces an earlier one's",
      `<div style="counter-reset: list-item 10"></div><li></li>
        <div style="counter-reset: list-item 20"></div><li></li>`,
      [11, 21],
    ],
    [
      "past a closed details's contents",
      "<ol><li><details><summary>s</summary><li></details><li></ol>",
      [1, 2],
    ],
    [
      "through an open details's contents",
      "<ol><li><details open><summary>s</summary><li></details><li></ol>",
      [1, 2, 3],
    ],
    [
      "past a content-visibility: hidden box's contents",
      '<ol><li><div style="content-visibility: hidden"><li></div><li></ol>',
      [1, 2],
    ],
  ])("counts %s", (_, html, expected) => {
    expect(numbers(html)).toEqual(expected);
  });

  it("reads each counter in scope, the outermost first", () => {
    const { values, items } = countersIn(
      `<ol><li><ol><li><li data-test="deep"></ol></ol>
       <div style="counter-reset: section 2"><li style="counter-increment: section"></div>`,
    );
    const deep = document.querySelector('[data-test="deep"]')!;
    expect(values.get(deep)).toEqual(new Map([["list-item", [1, 2]]]));
    expect(values.get(items.at(-1)!)!.get("section")).toEqual([3]);
  });

  it("parses the counter properties as computed and as specified", () => {
    expect(parseResets("list-item 0 reversed(list-item) x 4")).toEqual([
      { name: "list-item", value: undefined, reversed: true },
      { name: "x", value: 4, reversed: false },
    ]);
    expect(parseResets("reversed(a) 3")).toEqual([{ name: "a", value: 3, reversed: true }]);
    expect(parseResets("none")).toEqual([]);
    expect(parseChanges("a b 2 a -3", 1, true)).toEqual(
      new Map([
        ["a", -2],
        ["b", 2],
      ]),
    );
    expect(parseChanges("a b 2 a -3", 0, false)).toEqual(
      new Map([
        ["a", -3],
        ["b", 2],
      ]),
    );
    expect(parseChanges("", 1, true)).toEqual(new Map());
  });
});

describe("marker reads", () => {
  it("take the parts of content, else of list-style-type", () => {
    expect(markerParts("normal", "decimal")).toEqual([{ listStyle: "decimal" }]);
    expect(markerParts("", "--arrow")).toEqual([{ listStyle: "--arrow" }]);
    expect(markerParts("normal", '"→ "')).toEqual(["→ "]);
    expect(markerParts("normal", "none")).toEqual([]);
    expect(markerParts("none", "decimal")).toEqual([]);
    expect(markerParts('"→"', "none")).toEqual(["→"]);
  });

  it("read content's strings, counters and quotes, and nothing of an image or alternative text", () => {
    expect(
      contentParts(
        `"§" counter(section) "." counters(list-item, ", (", upper-roman) url("a.png") open-quote "\\2022" no-close-quote / "alt"`,
      ),
    ).toEqual([
      "§",
      { counter: "section", style: "decimal" },
      ".",
      { counter: "list-item", style: "upper-roman", separator: ", (" },
      { quote: "open" },
      "•",
      { quote: "no-close" },
    ]);
    expect(contentParts("counter(x,lower-alpha)")).toEqual([
      { counter: "x", style: "lower-alpha" },
    ]);
    expect(contentParts("none")).toEqual([]);
  });

  it("write each part from the item's counters", () => {
    const values = new Map([
      ["list-item", [2, 3]],
      ["x", [27]],
    ]);
    const styles = counterStyles();
    const text = (part: Parameters<typeof partText>[0]) => partText(part, values, styles);
    expect(text({ listStyle: "lower-alpha" })).toBe("c. ");
    expect(text({ counter: "x", style: "lower-alpha" })).toBe("aa");
    expect(text({ counter: "list-item", style: "decimal", separator: "." })).toBe("2.3");
    expect(text({ counter: "missing", style: "decimal" })).toBe("0");
    expect(text({ counter: "x", style: "none" })).toBe("");
  });

  it("read a list item's type, position and paint, and no marker for another box", () => {
    document.body.innerHTML = `
      <ol style="color: rgb(1, 2, 3); list-style-type: decimal">
        <li data-test="decimal" style="font-weight: 700">a</li>
        <li data-test="inside" style="list-style-type: '→ '; list-style-position: inside">b</li>
        <li data-test="none" style="list-style-type: none">c</li>
      </ol>
      <div data-test="block">d</div>`;
    const read = (name: string) =>
      readCellStyle(document.querySelector(`[data-test="${name}"]`)!, 16).marker;
    expect(read("decimal")).toMatchObject({
      parts: [{ listStyle: "decimal" }],
      inside: false,
      color: null,
      glyph: { "font-weight": "700" },
    });
    expect(read("inside")).toMatchObject({ parts: ["→ "], inside: true });
    expect(read("none")).toBeNull();
    expect(read("block")).toBeNull();
  });
});

/** A host's tree laid out in 4px cells (16px root), each list item's
 * type set, as happy-dom has no UA list styles. */
function lay(html: string, cols = 20): LayoutNode {
  document.body.innerHTML = `<div data-test="host"><style>ol { list-style-type: decimal } ul { list-style-type: disc } .inside { list-style-position: inside }</style>${html}</div>`;
  const root = buildTree(document.querySelector('[data-test="host"]')!, 16)!;
  layoutRoot(root, cols);
  return root;
}

/** The node built from the element `[data-test=name]`. */
function nodeOf(root: LayoutNode, name: string): LayoutNode {
  const el = document.querySelector(`[data-test="${name}"]`);
  const find = (node: LayoutNode): LayoutNode | undefined =>
    node.source === el && !node.anonymous ? node : node.children.map(find).find(Boolean);
  return find(root)!;
}

const markerOf = (node: LayoutNode) => {
  const { text, width, x, y } = node.marker!;
  return { text, width, x, y };
};

describe("outside markers", () => {
  it("end at the item's border-box start, on its first line's row", () => {
    const root = lay(
      `<ol start="9"><li data-test="a">a</li><li data-test="b" style="padding-left: 8px">b</li></ol>`,
    );
    expect(markerOf(nodeOf(root, "a"))).toEqual({ text: "9. ", width: 3, x: -3, y: 0 });
    expect(markerOf(nodeOf(root, "b"))).toEqual({ text: "10. ", width: 4, x: -4, y: 0 });
  });

  it("stay put for text-indent and text-align", () => {
    const root = lay(
      `<ol><li data-test="a" style="text-indent: 8px; text-align: center">a</li></ol>`,
    );
    expect(markerOf(nodeOf(root, "a"))).toMatchObject({ x: -3, y: 0 });
  });

  it("sit on the first line CSS takes the baseline from, or the first content row", () => {
    const root = lay(`<ol>
      <li data-test="nested"><div></div><div style="padding-top: 8px">x</div></li>
      <li data-test="padded" style="padding-top: 4px"><div></div></li>
      <li data-test="empty"></li>
    </ol>`);
    expect(markerOf(nodeOf(root, "nested"))).toMatchObject({ y: 2 });
    expect(markerOf(nodeOf(root, "padded"))).toMatchObject({ y: 1 });
    expect(nodeOf(root, "padded").localRect.height).toBe(1);
    expect(markerOf(nodeOf(root, "empty"))).toMatchObject({ y: 0 });
    expect(nodeOf(root, "empty").localRect.height).toBe(1);
  });

  it("move in by the floats beside a leaf item's first line", () => {
    const root = lay(`<ol>
      <div style="float: left; width: 32px; height: 8px"></div>
      <li data-test="a">a</li>
      <li data-test="b" style="padding-left: 8px">b</li>
    </ol>`);
    // The first line starts 8 cells into a's content box and 6 into b's.
    expect(markerOf(nodeOf(root, "a"))).toMatchObject({ x: 8 - 3 });
    expect(markerOf(nodeOf(root, "b"))).toMatchObject({ x: 6 - 3 });
  });

  it("take the item's tracking", () => {
    const root = lay(`<ol><li data-test="a" style="letter-spacing: 0.4px">a</li></ol>`);
    expect(markerOf(nodeOf(root, "a"))).toMatchObject({ width: 6, x: -6 });
  });

  it("draw none for an empty text", () => {
    const root = lay(`<ol><li data-test="a" style="list-style-type: none">a</li></ol>`);
    expect(nodeOf(root, "a").marker).toBeUndefined();
  });
});

describe("inside markers", () => {
  it("open the first line, after its text-indent, the line wrapping at the width less both", () => {
    const root = lay(
      `<ol class="inside"><li data-test="a" style="text-indent: 4px">aaa bbb</li></ol>`,
      8,
    );
    const item = nodeOf(root, "a");
    expect(item.marker!.text).toBe("1. ");
    expect(item.indent).toBe(4);
    expect(item.lines!.spans).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    expect(item.intrinsicWidth).toBe(1 + 3 + 7);
  });

  it("take a line of their own above a leading block, and make an empty item a row", () => {
    const root = lay(
      `<ol class="inside"><li data-test="a"><div>x</div></li><li data-test="b"></li></ol>`,
    );
    const item = nodeOf(root, "a");
    const [run, block] = item.children;
    expect(run!.anonymous).toBe(true);
    expect(run!.marker!.text).toBe("1. ");
    expect(run!.localRect).toMatchObject({ y: 0, height: 1 });
    expect(block!.localRect.y).toBe(1);
    expect(nodeOf(root, "b").localRect.height).toBe(1);
  });

  it("go on an item's first run", () => {
    const root = lay(`<ol class="inside"><li data-test="a">x<div>y</div></li></ol>`);
    const [run] = nodeOf(root, "a").children;
    expect(run!.anonymous).toBe(true);
    expect(run!.text).toBe("x");
    expect(run!.marker!.text).toBe("1. ");
  });
});

describe("marker paint", () => {
  const rows = (html: string, cols = 20) => renderPlainText(lay(html, cols)).split("\n");

  it("draws outside markers in the list's padding, each ending at its item", () => {
    const items = Array.from({ length: 10 }, (_, i) => `<li>${"abcdefghij"[i]}</li>`).join("");
    expect(rows(`<ol style="padding-left: 16px">${items}</ol>`).slice(7)).toEqual([
      " 8. h",
      " 9. i",
      "10. j",
    ]);
  });

  it("draws inside markers on the first line, aligned and wrapped with it", () => {
    expect(rows(`<ol class="inside"><li>aaa bbb</li></ol>`, 8)).toEqual(["1. aaa", "bbb"]);
    expect(rows(`<ol class="inside"><li style="text-align: center">ab</li></ol>`, 11)).toEqual([
      "   1. ab",
    ]);
    expect(
      rows(`<ol class="inside"><li style="text-indent: 8px"><div>x</div></li></ol>`, 11),
    ).toEqual(["  1.", "  x"]);
  });

  it("spread an inside marker's spaces with a justified line's", () => {
    expect(
      rows(`<ol class="inside"><li style="text-align: justify">aa bb cc dd</li></ol>`, 10),
    ).toEqual(["1.  aa  bb", "cc dd"]);
  });

  it("truncate an inside marker's text, and the marker too in a box narrower than it", () => {
    const truncating = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis";
    expect(rows(`<ol class="inside"><li style="${truncating}">abcdef</li></ol>`, 6)).toEqual([
      "1. ab…",
    ]);
    expect(
      rows(`<ol class="inside"><li style="${truncating}; width: 8px">abcdef</li></ol>`),
    ).toEqual(["1…"]);
  });

  it("draw no outside marker for an item that clips", () => {
    expect(
      rows(`<ol style="padding-left: 12px"><li style="overflow: hidden">a</li><li>b</li></ol>`),
    ).toEqual(["   a", "2. b"]);
  });

  it("paint in the marker's color and weight, and an inside marker in its item's decoration", () => {
    const underline = "text-decoration-line: underline";
    const root = lay(`<ol style="padding-left: 12px; color: rgb(1, 2, 3)">
      <li style="font-weight: 700; ${underline}">a</li>
    </ol><ol class="inside"><li style="${underline}">b</li></ol>`);
    const [outside, inside] = renderCellSegments(root);
    expect(outside![0]).toMatchObject({
      text: "1. ",
      color: "rgb(1, 2, 3)",
      glyph: { "font-weight": "700" },
    });
    expect(outside![0]!.decoration).toBeUndefined();
    expect(outside![1]).toMatchObject({ text: "a" });
    expect(outside![1]!.decoration).toBeDefined();
    expect(inside![0]).toMatchObject({ text: "1. b" });
    expect(inside![0]!.decoration).toBeDefined();
  });

  it("follow the item's color as a frame resamples it, where they share it", () => {
    const root = lay(
      `<ol style="padding-left: 12px"><li data-test="a" style="color: rgb(1, 2, 3)">a</li></ol>`,
    );
    nodeOf(root, "a").style.color = "rgb(9, 9, 9)";
    expect(renderCellSegments(root)[0]![0]).toMatchObject({ text: "1. a", color: "rgb(9, 9, 9)" });
  });

  it("underline an inside marker on a line of its own as its item propagates", () => {
    const root = lay(`<div style="text-decoration-line: underline">
      <ol class="inside"><li><div>x</div></li></ol>
    </div>`);
    const [row] = renderCellSegments(root);
    expect(row![0]).toMatchObject({ text: "1. " });
    expect(row![0]!.decoration).toBeDefined();
  });

  it("hit the item on its marker's cells", () => {
    const root = lay(`<ol data-test="list" style="padding-left: 12px">
      <li data-test="a">a</li><li data-test="b" style="list-style-type: none">b</li>
    </ol>`);
    const hit = (col: number, row: number) =>
      hitStack(root, col, row, null).at(-1)!.source.getAttribute("data-test");
    expect(hit(0, 0)).toBe("a");
    expect(hit(2, 0)).toBe("a");
    expect(hit(0, 1)).toBe("list");
  });
});

describe("marker selection", () => {
  /** The range from `[data-test=from]`'s text at `start` to
   * `[data-test=to]`'s at `end` (its text's length by default). */
  const between = (from: string, start: number, to = from, end?: number) => {
    const text = (name: string) => document.querySelector(`[data-test="${name}"]`)!.firstChild!;
    const last = text(to);
    return {
      startContainer: text(from),
      startOffset: start,
      endContainer: last,
      endOffset: end ?? last.textContent!.length,
    };
  };
  const host = () => document.querySelector('[data-test="host"]')!;
  const all = () => ({
    startContainer: host(),
    startOffset: 0,
    endContainer: host(),
    endOffset: host().childNodes.length,
  });

  it("copies each marker with its item's first line whole, and highlights none", () => {
    const root = lay(`<ol style="padding-left: 12px"><li>a</li></ol>
      <ol class="inside"><li>b</li><li><div>c</div></li></ol>
      <ol style="padding-left: 24px"><li><ol style="padding-left: 12px"><li>d</li></ol></li></ol>
      <ol style="padding-left: 12px"><li style="visibility: hidden">e</li><li>f</li></ol>`);
    expect(serializeSelection(root, all())).toBe("1. a\n1. b\n2. c\n1. 1. d\n2. f");
    const [outside, inside] = renderCellSegments(root, { selection: selectedRanges(root, all()) });
    expect(outside!.slice(0, 2).map(({ text, selected }) => [text, selected])).toEqual([
      ["1. ", undefined],
      ["a", true],
    ]);
    expect(inside!.slice(0, 2).map(({ text, selected }) => [text, selected])).toEqual([
      ["1. ", undefined],
      ["b", true],
    ]);
  });

  it("copies only the markers the grid shows", () => {
    const root = lay(`<ol><li>past the edge</li></ol>
      <ol style="padding-left: 12px"><li style="overflow: hidden">clipped</li><li>shown</li></ol>`);
    expect(serializeSelection(root, all())).toBe("past the edge\nclipped\n2. shown");
  });

  it("copies none with a word, part of the first line, or a later line alone", () => {
    const root = lay(
      `<ol style="padding-left: 12px">
        <li data-test="a">one two three four</li>
        <li><p data-test="b">first</p><p data-test="c">second</p></li>
      </ol>`,
      12,
    );
    expect(serializeSelection(root, between("a", 0, "a", 3))).toBe("one");
    expect(serializeSelection(root, between("a", 4))).toBe("two three four");
    expect(serializeSelection(root, between("a", 0, "a", 5))).toBe("one t");
    // The first line whole ("one two" at 12 cells), and past it, as a
    // drag or a paragraph takes it.
    expect(serializeSelection(root, between("a", 0, "a", 7))).toBe("1. one two");
    expect(serializeSelection(root, between("a", 0, "a", 13))).toBe("1. one two three");
    expect(serializeSelection(root, between("c", 0))).toBe("second");
    expect(serializeSelection(root, between("b", 0, "c"))).toBe("2. first\n\nsecond");
  });
});

describe("the light DOM", () => {
  it("indents an inside marker's native first line by its cells and their justified spread", () => {
    const root = lay(
      `<ol class="inside">
      <li data-test="a" style="text-indent: 4px">a</li>
      <li data-test="b"><div>b</div></li>
      <li data-test="c" style="text-align: justify">aa bb cc dd</li>
    </ol>`,
      10,
    );
    render(root);
    const indent = (name: string) =>
      (document.querySelector(`[data-test="${name}"]`) as HTMLElement).style.getPropertyValue(
        "--mw-ti",
      );
    expect(indent("a")).toBe("4");
    expect(indent("b")).toBe("3");
    expect(indent("c")).toBe("4");
  });

  it("moves a leading block below its item's own marker line natively too", () => {
    const root = lay(`<ol class="inside"><li><div data-test="block">x</div></li></ol>`);
    const block = nodeOf(root, "block");
    expect(block.localRect.y).toBe(1);
    expect(block.flow?.top).toBe(1);
  });

  it("flags an item whose marker content holds an image", () => {
    // happy-dom reads an element's own style for its `::marker`.
    const root = lay(`<ol>
      <li data-test="image" style="content: url(dot.png) 'x'">a</li>
      <li data-test="plain">b</li>
    </ol>`);
    render(root);
    const flagged = (name: string) =>
      document.querySelector(`[data-test="${name}"]`)!.hasAttribute("data-mw-marker-image");
    expect(nodeOf(root, "image").marker!.text).toBe("x");
    expect(flagged("image")).toBe(true);
    expect(flagged("plain")).toBe(false);
  });
});

describe("bullets", () => {
  const rows = (html: string) => renderPlainText(lay(html)).split("\n");
  // Each item names its set: happy-dom inherits no custom property.
  const list = (style: string) =>
    `<ul style="padding-left: 8px">${[
      "disc",
      "circle",
      "square",
      "disclosure-open",
      "disclosure-closed",
      "'• '",
    ]
      .map((type, i) => `<li style="${style}; list-style-type: ${type}">${"abcdef"[i]}</li>`)
      .join("")}</ul>`;

  it("draw through the item's glyph set, a string as written", () => {
    expect(rows(list(""))).toEqual(["• a", "◦ b", "▪ c", "▼ d", "▶ e", "• f"]);
    expect(rows(list("--mw-border-glyphs: ascii"))).toEqual([
      "* a",
      "o b",
      "# c",
      "v d",
      "> e",
      "• f",
    ]);
    expect(rows(list("--mw-border-glyphs: cp437"))).toEqual([
      "• a",
      "○ b",
      "■ c",
      "▼ d",
      "► e",
      "• f",
    ]);
  });

  it("fall back per glyph past one the font has not got", () => {
    expect(rows(list("--mw-border-glyphs: cp437; --mw-missing-glyphs: '■'"))[2]).toBe("▪ c");
  });

  it("draw a rule extending one through the set too", () => {
    const styles = withBullets(
      counterStyles((name) =>
        name === "dash-disc"
          ? styleOfRule(rule({ system: "extends disc", suffix: '"-"' }), counterStyles())
          : undefined,
      ),
      (bullet) => (bullet === "disc" ? "*" : "?"),
    );
    expect(markerText(1, "dash-disc", styles)).toBe("*-");
    expect(markerText(1, "circle", styles)).toBe("? ");
    expect(markerText(1, "decimal", styles)).toBe("1. ");
  });
});

describe("marker placement, further", () => {
  const rows = (html: string, cols = 20) => renderPlainText(lay(html, cols)).split("\n");

  it("find the first line through a flex row, a scroll container and a table, past out-of-flow boxes", () => {
    const root = lay(`<ol>
      <li data-test="flex"><div style="display: flex; padding-top: 4px"><span>x</span></div></li>
      <li data-test="scroll"><div style="overflow: auto; padding-top: 4px">x</div></li>
      <li data-test="table"><table style="padding-top: 4px"><tr><td>x</td></tr></table></li>
      <li data-test="abs"><div style="position: absolute">a</div><div style="padding-top: 4px">x</div></li>
    </ol>`);
    for (const name of ["flex", "scroll", "table", "abs"]) {
      expect(markerOf(nodeOf(root, name)).y, name).toBe(1);
    }
  });

  it("move with the item's margin, and drop past the host's edge", () => {
    expect(rows(`<ol><li style="margin-left: 12px">a</li><li>b</li></ol>`)).toEqual(["1. a", "b"]);
  });

  it("are cut by an ancestor's clip", () => {
    expect(
      rows(`<div style="overflow: hidden"><ol style="padding-left: 8px"><li>a</li></ol></div>`),
    ).toEqual([". a"]);
    expect(
      rows(
        `<div style="padding-left: 4px"><ol style="overflow: hidden; padding-left: 8px"><li>a</li></ol></div>`,
      ),
    ).toEqual([" . a"]);
  });

  it("balance an inside marker's lines as an equal indent's", () => {
    const words = "one two three four five six";
    const marked = lay(
      `<ol class="inside"><li data-test="a" style="text-wrap: balance">${words}</li></ol>`,
      16,
    );
    const spans = nodeOf(marked, "a").lines!.spans;
    const indented = lay(
      `<p data-test="b" style="text-indent: 12px; text-wrap: balance">${words}</p>`,
      16,
    );
    expect(spans).toEqual(nodeOf(indented, "b").lines!.spans);
  });

  it("take the item's tracking inside too", () => {
    const root = lay(
      `<ol class="inside"><li data-test="a" style="letter-spacing: 0.4px">a</li></ol>`,
    );
    expect(nodeOf(root, "a").indent).toBe(6);
  });

  it("paint none for a hidden item, over a later block's fill and under a positioned box", () => {
    expect(
      rows(`<ol style="padding-left: 12px"><li style="visibility: hidden">a</li><li>b</li></ol>`),
    ).toEqual(["", "2. b"]);
    const root = lay(`<ol style="padding-left: 12px"><li>a</li></ol>
      <div style="margin-top: -4px; height: 4px; background-color: rgb(0, 0, 255)"></div>
      <div style="position: relative"><div style="position: absolute; top: -4px; width: 4px; height: 4px; background-color: rgb(255, 0, 0)"></div></div>`);
    const [row] = renderCellSegments(root);
    expect(row![0]).toMatchObject({ text: " ", backgroundColor: "rgb(255, 0, 0)" });
    expect(row![1]).toMatchObject({
      text: expect.stringMatching(/^\. a/),
      backgroundColor: "rgb(0, 0, 255)",
    });
  });
});

describe("markers in edge cases", () => {
  const rows = (html: string, cols = 24) => renderPlainText(lay(html, cols)).split("\n");

  it("hang outside a multi-column list's items, each at its first line", () => {
    expect(
      rows(`<ol style="column-count: 2; column-gap: 0; padding-left: 12px">
        <li>aaa</li><li>bbb</li><li>ccc</li><li>ddd</li>
      </ol>`),
    ).toEqual(["1. aaa    3. ccc", "2. bbb    4. ddd"]);
  });

  it("hang outside a flex or grid list's items, over the gap", () => {
    expect(
      rows(
        `<ol style="display: flex; column-gap: 12px; padding-left: 12px"><li>a</li><li>b</li></ol>`,
      ),
    ).toEqual(["1. a2. b"]);
    expect(
      rows(`<ol style="display: grid; grid-template-columns: 4px 4px; column-gap: 12px; padding-left: 12px">
        <li>a</li><li>b</li>
      </ol>`),
    ).toEqual(["1. a2. b"]);
  });

  it("read a name an object's prototype holds as no style", () => {
    expect(markerText(4, "constructor")).toBe("4. ");
    expect(counterText(4, "__proto__")).toBe("4");
  });

  it("cut an inside marker with no ellipsis under text-overflow: clip", () => {
    expect(
      rows(
        `<ol class="inside"><li style="white-space: nowrap; overflow: hidden; width: 8px">abcdef</li></ol>`,
      ),
    ).toEqual(["1."]);
  });

  it("draw nothing of an image-set in content", () => {
    expect(contentParts('image-set(url("http://x/a.png") 1x, url("b.png") 2x) "» "')).toEqual([
      "» ",
    ]);
  });

  it("hang an outer marker on a nested inside marker's own line", () => {
    expect(
      rows(
        `<ol style="padding-left: 12px"><li><ol class="inside"><li><div>x</div></li></ol></li></ol>`,
      ),
    ).toEqual(["1. 1.", "   x"]);
  });

  it("copy a marker whose first line is in a table", () => {
    const root = lay(`<ol style="padding-left: 12px">
      <li><table><tr><td>x</td></tr></table></li><li>y</li>
    </ol>`);
    const host = document.querySelector('[data-test="host"]')!;
    const all = {
      startContainer: host,
      startOffset: 0,
      endContainer: host,
      endOffset: host.childNodes.length,
    };
    expect(serializeSelection(root, all)).toBe("1. x\n2. y");
  });

  it("take the system's own range for an extended style's auto one", () => {
    const counter = styleOfRule(
      rule({ system: "extends lower-roman", range: "auto" }),
      counterStyles(),
    );
    expect(counter!.range).toBeNull();
  });
});
