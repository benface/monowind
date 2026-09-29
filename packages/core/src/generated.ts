/**
 * Generated content (specs/generated-content.md): which elements a
 * `::before` or `::after` may give content, and what it holds.
 */

import { contentParts, holdsImage, symbolsOf } from "./counters.ts";
import { pageSheets, sheetRules } from "./sheets.ts";
import type { ContentPart, QuotePart } from "./types.ts";

export type Pseudo = "::before" | "::after";

export const PSEUDOS: readonly Pseudo[] = ["::before", "::after"];

/** A pseudo-element's name in the engine's flags and variables
 * (`data-mw-before-declared`, `--mw-before-x`). */
export const nameOf = (pseudo: Pseudo): "before" | "after" =>
  pseudo === "::before" ? "before" : "after";

/** The elements under `root` each pseudo-element may give content
 * ("What the engine reads"): those the selectors of its `content`-setting
 * rules match, and each `q`, whose quotes the UA's sheet gives. */
export function generatedElements(root: Element): Record<Pseudo, ReadonlySet<Element>> {
  const selectors = { "::before": new Set(["q"]), "::after": new Set(["q"]) };
  for (const sheet of pageSheets(root)) {
    const { generated } = sheetRules(sheet);
    for (const pseudo of PSEUDOS) for (const each of generated[pseudo]) selectors[pseudo].add(each);
  }
  const before = [...selectors["::before"]].join(", ");
  const after = [...selectors["::after"]].join(", ");
  // A page with no rule of its own has `q`s alone, found without a
  // match per element.
  const found =
    before === "q" && after === "q"
      ? root.getElementsByTagName("q")
      : root.querySelectorAll(`${before}, ${after}`);
  const elements = { "::before": new Set<Element>(), "::after": new Set<Element>() };
  for (const el of found) {
    if (el.matches(before)) elements["::before"].add(el);
    if (el.matches(after)) elements["::after"].add(el);
  }
  return elements;
}

/** A `::before` or `::after` with content, among its element's child
 * nodes (tree.ts `shownChildNodes`). */
export class GeneratedNode {
  readonly parentElement: Element;
  readonly pseudo: Pseudo;
  readonly cs: CSSStyleDeclaration;
  readonly parts: readonly ContentPart[];
  /** Its `content` holds an image, which its native box must not draw. */
  readonly image: boolean;

  constructor(parentElement: Element, pseudo: Pseudo, cs: CSSStyleDeclaration, content: string) {
    this.parentElement = parentElement;
    this.pseudo = pseudo;
    this.cs = cs;
    this.parts = contentParts(content);
    this.image = holdsImage(content);
  }

  /** Its place in its element's child nodes, where its characters
   * stand: the start, or the end. */
  get offset(): number {
    return this.pseudo === "::before" ? 0 : this.parentElement.childNodes.length;
  }

  /** Its `display`, the initial `inline` where none computes. */
  get display(): string {
    return this.cs.display || "inline";
  }
}

/** A pseudo-element box's own text, its run's one node. */
export class GeneratedText {
  readonly source: GeneratedNode;
  readonly text: string;

  constructor(source: GeneratedNode, text: string) {
    this.source = source;
    this.text = text;
  }

  get parentElement(): Element {
    return this.source.parentElement;
  }
}

/** A pseudo-element with content; none where it has no content, so no
 * box. */
export function readGenerated(el: Element, pseudo: Pseudo): GeneratedNode | null {
  const cs = getComputedStyle(el, pseudo);
  const { content } = cs;
  if (!content || content === "none" || content === "normal") return null;
  return new GeneratedNode(el, pseudo, cs, content);
}

/** `quotes`' pairs, the outermost first. */
export type QuotePairs = readonly (readonly [open: string, close: string])[];

/** A build's quote depth, in the order it writes quotes, tree order
 * (css-content-3 "Quotes"): each quote's text as it moves the depth,
 * the last pair past the deepest, none below 0. */
export function quoteWriter(): (part: QuotePart, pairs: QuotePairs) => string {
  let depth = 0;
  return ({ quote }, pairs) => {
    if (quote === "open" || quote === "no-open") {
      const pair = pairs[Math.min(depth++, pairs.length - 1)];
      return quote === "open" ? (pair?.[0] ?? "") : "";
    }
    if (depth === 0) return "";
    const pair = pairs[Math.min(--depth, pairs.length - 1)];
    return quote === "close" ? (pair?.[1] ?? "") : "";
  };
}

/** `quotes`' pairs: its strings, none for `none`, and for `auto` its
 * language's ("Counters and quotes"). */
export function quotePairs(quotes: string, language: string): QuotePairs {
  if (quotes === "none") return [];
  const symbols = /^["']/.test(quotes) ? symbolsOf(quotes) : Array.from(autoQuotes(language));
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < symbols.length; i += 2) pairs.push([symbols[i]!, symbols[i + 1]!]);
  return pairs;
}

/** A language's `quotes: auto`, its tag's or the tag's first subtags',
 * English's where none has any (deviation 2). */
function autoQuotes(language: string): string {
  const subtags = language.toLowerCase().split("-");
  for (let count = subtags.length; count > 0; count--) {
    const quotes = AUTO_QUOTES.get(subtags.slice(0, count).join("-"));
    if (quotes) return quotes;
  }
  return "“”‘’";
}

/** Chromium's `quotes: auto` pairs, outer then inner (probed
 * 2026-09-28), by the languages that take them. */
const AUTO_QUOTES = new Map(
  Object.entries({
    "„“‚‘": "bs-cyrl cs de et hr sk sl",
    "„“„“": "bg lt",
    "„”«»": "pl ro",
    "„”»«": "hu",
    "„”’’": "sr",
    "«»«»": "fr",
    "«»“”": "ca el it pt-pt",
    "«»”“": "fr-ca",
    "«»„“": "ru uk",
    "«»‘’": "nb nn no",
    "«»‹›": "am az-cyrl fa fr-ch",
    "””’’": "fi he sv",
    "”“’‘": "ar ur",
    "‘’‘’": "nl",
    "「」『』": "ja zh-hant",
  }).flatMap(([quotes, languages]) => languages.split(" ").map((tag) => [tag, quotes] as const)),
);
