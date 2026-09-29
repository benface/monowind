/**
 * Counters (css-lists-3, specs/lists.md "Numbering"), quotes
 * (specs/generated-content.md "Counters and quotes") and counter styles
 * (css-counter-styles-3, "Counter styles"): each element's counter
 * values and quotes from the walk of its tree, and how a value reads
 * as text — a style's system over its symbols, its range, pad and
 * negative sign, and its fallback — over the simple predefined styles
 * and the page's `@counter-style` rules.
 */

import { BULLET_GLYPHS } from "./glyphs.ts";
import { holds, pageSheets, sheetRules } from "./sheets.ts";
import type { GeneratedNode } from "./generated.ts";
import type { ContentPart, QuotePart } from "./types.ts";
import { graphemes } from "./width.ts";

type System = "cyclic" | "numeric" | "alphabetic" | "symbolic" | "additive" | "fixed";

export const LIST_ITEM = "list-item";

export interface CounterStyle {
  system: System;
  /** `fixed`'s first symbol's value. */
  first: number;
  symbols: readonly string[];
  /** `additive-symbols`, weights descending. */
  additive: readonly (readonly [number, string])[];
  negative: readonly [string, string];
  prefix: string;
  suffix: string;
  /** Inclusive bounds; `null` is `auto`, the system's own. */
  range: readonly (readonly [number, number])[] | null;
  pad: readonly [number, string];
  fallback: string;
}

/** The styles a name reads in: the page's rules over the predefined. */
export type CounterStyles = (name: string) => CounterStyle | undefined;

const style = (
  system: System,
  symbols: readonly string[],
  descriptors: Partial<CounterStyle> = {},
): CounterStyle => ({
  system,
  first: 1,
  symbols,
  additive: [],
  negative: ["-", ""],
  prefix: "",
  suffix: ". ",
  range: null,
  pad: [0, ""],
  fallback: "decimal",
  ...descriptors,
});

/** Ten digits from `zero`'s code point on. */
const digitsFrom = (zero: number): string[] =>
  Array.from({ length: 10 }, (_, i) => String.fromCodePoint(zero + i));

const ROMAN = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
const ROMAN_SYMBOLS = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
const roman = (upper: boolean) =>
  style("additive", [], {
    additive: ROMAN.map((weight, i) => {
      const symbol = ROMAN_SYMBOLS[i]!;
      return [weight, upper ? symbol.toUpperCase() : symbol] as const;
    }),
    range: [[1, 3999]],
  });

/** Armenian and Georgian letters, one per weight, descending. */
const lettered = (letters: string, weights: number[], range: number) =>
  style("additive", [], {
    additive: weights.map((weight, i) => [weight, [...letters][i]!] as const),
    range: [[1, range]],
  });

const ARMENIAN_WEIGHTS = [
  9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100,
  90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];
const GEORGIAN_WEIGHTS = [10000, ...ARMENIAN_WEIGHTS];

const HEBREW = style("additive", [], {
  additive: [
    ...[..."יטחזוהדגבא"].map((letter, i) => [10000 - 1000 * i, `${letter}׳`] as const),
    ...[..."תשרק"].map((letter, i) => [400 - 100 * i, letter] as const),
    ...[..."צפעסנמלכ"].map((letter, i) => [90 - 10 * i, letter] as const),
    [19, "יט"],
    [18, "יח"],
    [17, "יז"],
    [16, "טז"],
    [15, "טו"],
    ...[..."יטחזוהדגבא"].map((letter, i) => [10 - i, letter] as const),
  ],
  range: [[1, 10999]],
});

const CJK = { suffix: "、" };

/** The simple predefined counter styles (css-counter-styles-3 §6). */
const PREDEFINED: Record<string, CounterStyle> = {
  decimal: style("numeric", digitsFrom(0x30)),
  "decimal-leading-zero": style("numeric", digitsFrom(0x30), { pad: [2, "0"] }),
  "arabic-indic": style("numeric", digitsFrom(0x660)),
  armenian: lettered("ՔՓՒՑՐՏՎՍՌՋՊՉՈՇՆՅՄՃՂՁՀԿԾԽԼԻԺԹԸԷԶԵԴԳԲԱ", ARMENIAN_WEIGHTS, 9999),
  "lower-armenian": lettered("քփւցրտվսռջպչոշնյմճղձհկծխլիժթըէզեդգբա", ARMENIAN_WEIGHTS, 9999),
  bengali: style("numeric", digitsFrom(0x9e6)),
  cambodian: style("numeric", digitsFrom(0x17e0)),
  "cjk-decimal": style("numeric", [..."〇一二三四五六七八九"], { ...CJK, range: [[0, Infinity]] }),
  devanagari: style("numeric", digitsFrom(0x966)),
  georgian: lettered("ჵჰჯჴხჭწძცჩშყღქფჳტსრჟპოჲნმლკითჱზვედგბა", GEORGIAN_WEIGHTS, 19999),
  gujarati: style("numeric", digitsFrom(0xae6)),
  gurmukhi: style("numeric", digitsFrom(0xa66)),
  hebrew: HEBREW,
  kannada: style("numeric", digitsFrom(0xce6)),
  lao: style("numeric", digitsFrom(0xed0)),
  malayalam: style("numeric", digitsFrom(0xd66)),
  mongolian: style("numeric", digitsFrom(0x1810)),
  myanmar: style("numeric", digitsFrom(0x1040)),
  oriya: style("numeric", digitsFrom(0xb66)),
  persian: style("numeric", digitsFrom(0x6f0)),
  "lower-roman": roman(false),
  "upper-roman": roman(true),
  tamil: style("numeric", digitsFrom(0xbe6)),
  telugu: style("numeric", digitsFrom(0xc66)),
  thai: style("numeric", digitsFrom(0xe50)),
  tibetan: style("numeric", digitsFrom(0xf20)),
  "lower-alpha": style("alphabetic", [..."abcdefghijklmnopqrstuvwxyz"]),
  "upper-alpha": style("alphabetic", [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]),
  "lower-greek": style("alphabetic", [..."αβγδεζηθικλμνξοπρστυφχψω"]),
  hiragana: style(
    "alphabetic",
    [
      ..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわゐゑをん",
    ],
    CJK,
  ),
  "hiragana-iroha": style(
    "alphabetic",
    [
      ..."いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす",
    ],
    CJK,
  ),
  katakana: style(
    "alphabetic",
    [
      ..."アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲン",
    ],
    CJK,
  ),
  "katakana-iroha": style(
    "alphabetic",
    [
      ..."イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス",
    ],
    CJK,
  ),
  "cjk-earthly-branch": style("fixed", [..."子丑寅卯辰巳午未申酉戌亥"], {
    ...CJK,
    fallback: "cjk-decimal",
  }),
  "cjk-heavenly-stem": style("fixed", [..."甲乙丙丁戊己庚辛壬癸"], {
    ...CJK,
    fallback: "cjk-decimal",
  }),
  disc: style("cyclic", ["•"], { suffix: " " }),
  circle: style("cyclic", ["◦"], { suffix: " " }),
  square: style("cyclic", ["▪"], { suffix: " " }),
  "disclosure-open": style("cyclic", ["▾"], { suffix: " " }),
  "disclosure-closed": style("cyclic", ["▸"], { suffix: " " }),
};
PREDEFINED["upper-armenian"] = PREDEFINED.armenian!;
PREDEFINED.khmer = PREDEFINED.cambodian!;
PREDEFINED["lower-latin"] = PREDEFINED["lower-alpha"]!;
PREDEFINED["upper-latin"] = PREDEFINED["upper-alpha"]!;

/** The bullets, which draw the same at every value. */
const BULLETS = new Set(Object.keys(BULLET_GLYPHS));

/** The names no `@counter-style` rule redefines. */
const FIXED_NAMES = new Set(["decimal", ...BULLETS]);

/** The predefined styles under the page's `rules` (none by default). */
export function counterStyles(rules: CounterStyles = () => undefined): CounterStyles {
  return (name) =>
    (FIXED_NAMES.has(name) ? undefined : rules(name)) ??
    (Object.hasOwn(PREDEFINED, name) ? PREDEFINED[name] : undefined);
}

const PREDEFINED_ONLY = counterStyles();

/** Whether a system writes a negative value's sign (css-counter-styles-3 §3.1). */
const signed = (system: System): boolean => system !== "cyclic" && system !== "fixed";

/** The range a style takes when its own is `auto`. */
function autoRange(system: System): readonly (readonly [number, number])[] {
  if (system === "alphabetic" || system === "symbolic") return [[1, Infinity]];
  if (system === "additive") return [[0, Infinity]];
  return [[-Infinity, Infinity]];
}

/** The longest representation a style writes, past which it falls back
 * (css-counter-styles-3's 60 code points). */
const MAX_LENGTH = 60;

/** A value's initial representation by a style's system, undefined
 * where the system has none for it or it runs past `MAX_LENGTH`. */
function initial(value: number, { system, symbols, additive, first }: CounterStyle) {
  const n = symbols.length;
  switch (system) {
    case "cyclic":
      return symbols[(((value - 1) % n) + n) % n];
    case "fixed":
      return symbols[value - first];
    case "symbolic": {
      const times = Math.ceil(value / n);
      const symbol = symbols[(value - 1) % n]!;
      return value < 1 || times * symbol.length > MAX_LENGTH ? undefined : symbol.repeat(times);
    }
    case "alphabetic": {
      if (value < 1 || n < 2) return undefined;
      let text = "";
      for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / n)) {
        text = symbols[(rest - 1) % n] + text;
      }
      return text;
    }
    case "numeric": {
      if (n < 2) return undefined;
      let text = "";
      let rest = value;
      do {
        text = symbols[rest % n] + text;
        rest = Math.floor(rest / n);
      } while (rest > 0);
      return text;
    }
    case "additive": {
      if (value === 0) return additive.find(([weight]) => weight === 0)?.[1];
      let text = "";
      let rest = value;
      for (const [weight, symbol] of additive) {
        if (weight === 0 || weight > rest) continue;
        const times = Math.floor(rest / weight);
        if (text.length + times * symbol.length > MAX_LENGTH) return undefined;
        text += symbol.repeat(times);
        rest -= times * weight;
        if (rest === 0) return text;
      }
      return undefined;
    }
  }
}

/** A counter value's representation in the style `name` names — the
 * text `counter()` writes (css-counter-styles-3 §4.3), no prefix or
 * suffix — its fallback's where the style has none for it, `decimal`
 * for a name no style has. */
export function counterText(
  value: number,
  name: string,
  styles: CounterStyles = PREDEFINED_ONLY,
): string {
  return represent(value, resolve(name, styles), styles, new Set());
}

/** A marker's text: its style's prefix, the representation, and its
 * suffix. */
export function markerText(
  value: number,
  name: string,
  styles: CounterStyles = PREDEFINED_ONLY,
): string {
  const counter = resolve(name, styles);
  return counter.prefix + represent(value, counter, styles, new Set()) + counter.suffix;
}

const resolve = (name: string, styles: CounterStyles): CounterStyle =>
  styles(name) ?? PREDEFINED.decimal!;

function represent(
  value: number,
  counter: CounterStyle,
  styles: CounterStyles,
  seen: Set<CounterStyle>,
): string {
  const fallback = (): string => {
    seen.add(counter);
    const next = resolve(counter.fallback, styles);
    return represent(value, seen.has(next) ? PREDEFINED.decimal! : next, styles, seen);
  };
  const range = counter.range ?? autoRange(counter.system);
  if (!range.some(([low, high]) => value >= low && value <= high)) return fallback();
  const negative = value < 0 && signed(counter.system);
  const text = initial(negative ? -value : value, counter);
  if (text === undefined) return fallback();
  const width = Math.min(counter.pad[0], MAX_LENGTH);
  const sign = negative ? graphemes(counter.negative.join("")).length : 0;
  const padded = counter.pad[1].repeat(Math.max(0, width - graphemes(text).length - sign)) + text;
  return negative ? counter.negative[0] + padded + counter.negative[1] : padded;
}

/** A `@counter-style` rule's descriptors as the CSSOM serializes them
 * (`CSSCounterStyleRule`), each empty where the rule leaves it out. */
export interface CounterStyleDescriptors {
  system: string;
  symbols: string;
  additiveSymbols: string;
  negative: string;
  prefix: string;
  suffix: string;
  range: string;
  pad: string;
  fallback: string;
}

/** A descriptor's symbols: CSS strings (their escapes decoded) and
 * identifiers, split at white space and commas; an image, a function,
 * is no symbol the grid draws, an empty one (specs/lists.md deviation 3). */
export function symbolsOf(text: string): string[] {
  return Array.from(text.matchAll(SYMBOL_TOKEN), ([match, quoted]) =>
    quoted !== undefined
      ? decodeEscapes(quoted.slice(1, -1))
      : match.includes("(")
        ? ""
        : decodeEscapes(match),
  );
}

const STRING = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
/** A function's arguments, one nested function's included (`image-set(url(…) 1x)`). */
const ARGUMENTS = String.raw`\(((?:${STRING}|\((?:${STRING}|[^()"'])*\)|[^()"'])*)\)`;
const SYMBOL_TOKEN = new RegExp(String.raw`(${STRING})|[\w-]+${ARGUMENTS}|[^\s,]+`, "gsu");
/** An `additive-symbols` tuple, up to the comma past it. */
const PAIR = new RegExp(String.raw`(?:${STRING}|[^,"'])+`, "gsu");

/** A CSS string's escapes: a hex code point (and its one space), or
 * the character itself. */
const decodeEscapes = (text: string): string =>
  text.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(.))/gsu, (_, hex: string | undefined, char: string) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
  );

const integer = (text: string | undefined): number | undefined => {
  const value = text === undefined ? NaN : Number(text);
  return Number.isInteger(value) ? value : undefined;
};

/** A rule's style, CSS's defaults where it leaves a descriptor out and
 * its base's where it `extends` one; none for a rule CSS drops. */
export function styleOfRule(
  rule: CounterStyleDescriptors,
  styles: CounterStyles,
): CounterStyle | undefined {
  const [kind = "symbolic", argument] = rule.system.trim().split(/\s+/).filter(Boolean);
  const own: Partial<CounterStyle> = {};
  if (rule.negative) {
    const [before = "-", after = ""] = symbolsOf(rule.negative);
    own.negative = [before, after];
  }
  if (rule.prefix) own.prefix = symbolsOf(rule.prefix)[0] ?? "";
  if (rule.suffix) own.suffix = symbolsOf(rule.suffix)[0] ?? "";
  if (rule.range.trim() === "auto") own.range = null;
  else if (rule.range) {
    const bound = (text: string | undefined, infinite: number) =>
      text === "infinite" ? infinite : (integer(text) ?? NaN);
    own.range = rule.range.split(",").map((pair) => {
      const [low, high] = pair.trim().split(/\s+/);
      return [bound(low, -Infinity), bound(high, Infinity)] as const;
    });
    if (own.range.some(([low, high]) => !(low <= high))) return undefined;
  }
  if (rule.pad) {
    const [width, padding = ""] = symbolsOf(rule.pad);
    const count = integer(width);
    if (count === undefined || count < 0) return undefined;
    own.pad = [count, padding];
  }
  if (rule.fallback) own.fallback = rule.fallback.trim();
  if (kind === "extends") {
    if (!argument) return undefined;
    const base = styles(argument) ?? PREDEFINED.decimal!;
    return { ...base, ...own };
  }
  const symbols = symbolsOf(rule.symbols);
  const additiveSymbols = Array.from(rule.additiveSymbols.matchAll(PAIR), ([pair]) => {
    const [weight, symbol = ""] = symbolsOf(pair);
    return [integer(weight) ?? -1, symbol] as const;
  });
  const system = kind as System;
  switch (system) {
    case "cyclic":
    case "fixed":
    case "symbolic":
      if (symbols.length < 1) return undefined;
      break;
    case "alphabetic":
    case "numeric":
      if (symbols.length < 2) return undefined;
      break;
    case "additive":
      if (additiveSymbols.length < 1 || additiveSymbols.some(([weight]) => weight < 0)) {
        return undefined;
      }
      break;
    default:
      return undefined;
  }
  const first = system === "fixed" ? (integer(argument) ?? 1) : 1;
  return style(system, symbols, { first, additive: additiveSymbols, ...own });
}

/** The counter styles a node's markers read in: the `@counter-style`
 * rules of its root and the document that apply now, a later sheet's
 * winning, over the predefined styles — the sheets read on the first
 * name a rule may define. */
export function pageCounterStyles(node: Node): CounterStyles {
  let named: Map<string, CounterStyleDescriptors> | undefined;
  const read = () => {
    const rules = new Map<string, CounterStyleDescriptors>();
    for (const sheet of pageSheets(node)) {
      for (const { rule, conditions } of sheetRules(sheet).counterStyles) {
        if (conditions.every(holds)) rules.set(rule.name, rule);
      }
    }
    return rules;
  };
  const built = new Map<string, CounterStyle | undefined>();
  const extendsOf = (rule: CounterStyleDescriptors | undefined) => {
    const [kind, base] = rule?.system.trim().split(/\s+/) ?? [];
    return kind === "extends" && base && !FIXED_NAMES.has(base) ? base : undefined;
  };
  // Every style of an `extends` cycle extends `decimal` (css-counter-styles-3).
  const loops = (name: string) => {
    const seen = new Set<string>();
    for (let base = extendsOf(named!.get(name)); base && !seen.has(base);) {
      if (base === name) return true;
      seen.add(base);
      base = extendsOf(named!.get(base));
    }
    return false;
  };
  const styles = counterStyles((name) => {
    if (built.has(name)) return built.get(name);
    const rule = (named ??= read()).get(name);
    const counter = rule && styleOfRule(rule, loops(name) ? () => undefined : styles);
    built.set(name, counter);
    return counter;
  });
  return styles;
}

/** A marker's parts (specs/lists.md "Marker text"): its `::marker`'s
 * `content`, or where that is `normal` (or unread, ""),
 * `list-style-type`'s string or counter style; none for `none`. */
export function markerParts(content: string, listStyleType: string): ContentPart[] {
  if (content && content !== "normal") return contentParts(content);
  if (listStyleType === "none") return [];
  return /^["']/.test(listStyleType)
    ? symbolsOf(listStyleType).slice(0, 1)
    : [{ listStyle: listStyleType }];
}

/** A `content` value's strings, counters and quotes; an image and
 * alternative text (after `/`) draw nothing (specs/lists.md deviation
 * 3). */
export function contentParts(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const [token, name, args = ""] of content.matchAll(CONTENT_TOKEN)) {
    if (token === "/") break;
    if (/^["']/.test(token)) {
      parts.push(decodeEscapes(token.slice(1, -1)));
    } else if (name === "counter") {
      const [counter = "", style = "decimal"] = symbolsOf(args);
      parts.push({ counter, style });
    } else if (name === "counters") {
      const [counter = "", separator = "", style = "decimal"] = symbolsOf(args);
      parts.push({ counter, style, separator });
    } else if (QUOTES.has(token)) {
      parts.push({ quote: token.slice(0, -"-quote".length) as QuotePart["quote"] });
    }
  }
  return parts;
}

const QUOTES = new Set(["open-quote", "close-quote", "no-open-quote", "no-close-quote"]);

/** Whether a `content` holds an image, which the grid draws as nothing
 * (specs/lists.md deviation 3, specs/generated-content.md deviation 1). */
export const holdsImage = (content: string): boolean =>
  /url\(|image(?:-set)?\(|gradient\(/.test(content);

export const isQuote = (part: ContentPart): part is QuotePart =>
  typeof part === "object" && "quote" in part;

const CONTENT_TOKEN = new RegExp(String.raw`${STRING}|([\w-]+)${ARGUMENTS}|/|[^\s"'/]+`, "gsu");

/** Whether a part reads a counter's value: all but a string, a quote
 * and a bullet. */
export const readsCounter = (part: ContentPart): boolean =>
  typeof part !== "string" &&
  !isQuote(part) &&
  !("listStyle" in part && BULLETS.has(part.listStyle));

/** Each bullet's symbols, which a rule extending it shares. */
const BULLET_OF = new Map([...BULLETS].map((name) => [PREDEFINED[name]!.symbols, name]));

/** `styles` drawing each bullet — its predefined style, or a rule
 * extending it — in `glyph`'s symbol for it, the item's glyph set's
 * (specs/lists.md "Counter styles"). */
export function withBullets(
  styles: CounterStyles,
  glyph: (bullet: string) => string,
): CounterStyles {
  return (name) => {
    const style = styles(name);
    const bullet = style && BULLET_OF.get(style.symbols);
    return bullet ? { ...style, symbols: [glyph(bullet)] } : style;
  };
}

/** A part's text, from the counter values the walk gave its writer; a
 * quote's the build writes (tree.ts `withQuotes`). */
export function partText(
  part: ContentPart,
  values: ReadonlyMap<string, readonly number[]>,
  styles: CounterStyles,
): string {
  if (typeof part === "string") return part;
  if ("quote" in part) return "";
  // A counter read out of scope is the reader's own, at 0.
  const counters = values.get("listStyle" in part ? LIST_ITEM : part.counter) ?? [0];
  if ("listStyle" in part) return markerText(counters.at(-1)!, part.listStyle, styles);
  // `none` writes nothing, where an unknown name writes `decimal`.
  if (part.style === "none") return "";
  if (part.separator === undefined) return counterText(counters.at(-1)!, part.style, styles);
  return counters.map((value) => counterText(value, part.style, styles)).join(part.separator);
}

/** An element or pseudo-element as the counter walk reads it: its
 * counter properties, HTML's list hints folded in. */
export interface CounterNode {
  source: Element | GeneratedNode;
  resets: CounterReset[];
  increments: ReadonlyMap<string, number>;
  sets: Map<string, number>;
  /** Increments `list-item` unless `increments` names it. */
  listItem: boolean;
  /** Writes a counter's value: its content, or its marker's. */
  reads: boolean;
  children: CounterNode[];
}

/** The value of each counter in scope, the outermost first. */
export type Counters = ReadonlyMap<string, readonly number[]>;

export interface CounterReset {
  name: string;
  /** Undefined for a `reversed()` one that counts back from its scope's end. */
  value: number | undefined;
  reversed: boolean;
}

/** A `counter-reset`, as computed or specified: each name and its
 * integer, 0 where it has none, the last of a name winning. */
export function parseResets(text: string): CounterReset[] {
  const resets = new Map<string, CounterReset>();
  let last: CounterReset | undefined;
  for (const [, reversed, integer, name] of text.matchAll(COUNTER_TOKEN)) {
    if (integer !== undefined) {
      if (last) last.value = Number(integer);
    } else if (name === "none") {
      return [];
    } else {
      last = { name: (reversed ?? name)!, value: reversed ? undefined : 0, reversed: !!reversed };
      resets.delete(last.name);
      resets.set(last.name, last);
    }
  }
  return [...resets.values()];
}

/** A `counter-increment` (`sum`, a name given twice counting twice) or
 * a `counter-set` (the last of a name winning): each name and its
 * integer, `fallback` where it has none. */
export function parseChanges(text: string, fallback: number, sum: boolean): Map<string, number> {
  const changes = new Map<string, number>();
  let last: string | undefined;
  for (const [, , integer, name] of text.matchAll(COUNTER_TOKEN)) {
    if (integer !== undefined && last !== undefined) {
      changes.set(last, changes.get(last)! - fallback + Number(integer));
    } else if (name === "none") {
      return new Map();
    } else if (name !== undefined) {
      changes.set(name, (sum ? (changes.get(name) ?? 0) : 0) + fallback);
      last = name;
    }
  }
  return changes;
}

const COUNTER_TOKEN = /reversed\(\s*([^\s)]+)\s*\)|([+-]?\d+)|([^\s()]+)/gu;

/** A counter in scope: its value, and for a `reversed()` one counting
 * back from its scope's end, the changes to it read so far. */
interface Instance {
  value: number;
  reversed: boolean;
  changes?: Change[];
}

/** What one element does to a counter. */
interface Change {
  increment: number;
  set: number | undefined;
}

/**
 * The counters in scope at each node that reads one (css-lists-3
 * "Counters"). A `reversed()` counter with no value starts from the
 * changes a first walk records, hence a second walk.
 */
export function countersOf(root: CounterNode): Map<Element | GeneratedNode, Counters> {
  const first = walk(root, undefined);
  return first.reversed.length
    ? walk(root, first.reversed.map(reversedStart)).values
    : first.values;
}

function walk(root: CounterNode, starts: readonly number[] | undefined) {
  const values = new Map<Element | GeneratedNode, Counters>();
  const reversed: Change[][] = [];
  const stacks = new Map<string, Instance[]>();
  const visit = (nodes: readonly CounterNode[]): void => {
    // Each counter a node of this level made, in scope to its end.
    const made = new Map<string, Instance>();
    const instantiate = (name: string, instance: Instance) => {
      let stack = stacks.get(name);
      if (!stack) stacks.set(name, (stack = []));
      // A later sibling's counter of a name replaces an earlier one's.
      if (made.has(name)) stack.pop();
      stack.push(instance);
      made.set(name, instance);
      return instance;
    };
    for (const node of nodes) {
      for (const { name, value, reversed: isReversed } of node.resets) {
        if (value !== undefined) {
          instantiate(name, { value, reversed: isReversed });
        } else {
          const start = starts?.[reversed.length];
          const changes: Change[] = [];
          reversed.push(changes);
          instantiate(name, { value: start ?? 0, reversed: true, changes });
        }
      }
      const changed = new Map<Instance, Change>();
      const change = (name: string) => {
        const instance =
          stacks.get(name)?.at(-1) ?? instantiate(name, { value: 0, reversed: false });
        let entry = changed.get(instance);
        if (!entry) changed.set(instance, (entry = { increment: 0, set: undefined }));
        return [instance, entry] as const;
      };
      const increments =
        node.listItem && !node.increments.has(LIST_ITEM)
          ? [
              ...node.increments,
              [LIST_ITEM, stacks.get(LIST_ITEM)?.at(-1)?.reversed ? -1 : 1] as const,
            ]
          : node.increments;
      for (const [name, by] of increments) {
        const [instance, entry] = change(name);
        instance.value += by;
        entry.increment += by;
      }
      for (const [name, to] of node.sets) {
        const [instance, entry] = change(name);
        instance.value = to;
        entry.set = to;
      }
      for (const [instance, entry] of changed) instance.changes?.push(entry);
      if (node.reads) {
        const counters = new Map<string, number[]>();
        for (const [name, stack] of stacks) {
          if (stack.length === 0) continue;
          counters.set(
            name,
            stack.map((instance) => instance.value),
          );
        }
        values.set(node.source, counters);
      }
      visit(node.children);
    }
    for (const name of made.keys()) stacks.get(name)!.pop();
  };
  visit([root]);
  return { values, reversed };
}

/** A reversed counter's start: its last change's increment negated,
 * then each change's back to the last `counter-set`, which it starts
 * from (css-lists-3 "Calculating the initial value"). */
function reversedStart(changes: readonly Change[]): number {
  let start = -(changes.at(-1)?.increment ?? 0);
  for (let i = changes.length - 1; i >= 0; i--) {
    const { increment, set } = changes[i]!;
    if (set !== undefined) return start + set;
    start -= increment;
  }
  return start;
}
