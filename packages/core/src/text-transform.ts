import { INLINE_PAD } from "./wrap.ts";

/** The case `text-transform` puts text in (specs/cell-model.md
 * "Typography"). */
export type TextCase = "none" | "uppercase" | "lowercase" | "capitalize";

const TEXT_CASES = ["uppercase", "lowercase", "capitalize"] as const;

/** A computed `text-transform`'s case, its leading keyword. */
export function readTextCase(value: string): TextCase {
  return TEXT_CASES.find((textCase) => value.startsWith(textCase)) ?? "none";
}

/** A text node's clusters as `textCase` shows them, one string for each
 * of `text`'s `clusters`, in the node's content language `lang`;
 * `before` is the run's clusters before it, as a word runs across
 * elements. */
export function casedClusters(
  text: string,
  clusters: string[],
  textCase: Exclude<TextCase, "none">,
  lang: string,
  before: readonly string[],
): string[] {
  if (textCase === "capitalize") return capitalized(clusters, lang, before);
  const upper = textCase === "uppercase";
  // The node maps as a whole, as a final sigma takes its context; where
  // that changes its length (`ß` to `SS`), each cluster maps alone.
  const cased = caseMapped(text, upper, lang);
  if (cased.length !== text.length) {
    return clusters.map((cluster) => caseMapped(cluster, upper, lang));
  }
  let offset = 0;
  return clusters.map((cluster) => cased.slice(offset, (offset += cluster.length)));
}

function caseMapped(text: string, upper: boolean, lang: string): string {
  if (lang) {
    try {
      return upper ? text.toLocaleUpperCase(lang) : text.toLocaleLowerCase(lang);
    } catch {
      // A malformed tag (`en_US`) throws; it maps as no language.
    }
  }
  return upper ? text.toUpperCase() : text.toLowerCase();
}

/** A word's clusters: letters, marks, digits and connectors (`_`). */
const WORD = /^[\p{L}\p{M}\p{N}\p{Pc}]/u;

/** Marks a word holds between two of its clusters (`don't`, `a·b`). */
const WORD_INNER = new Set(["'", "’", "·"]);

type WordState = "outside" | "inside" | "inner";

function capitalized(clusters: string[], lang: string, before: readonly string[]): string[] {
  let state = wordState(before);
  return clusters.map((cluster) => {
    if (!WORD.test(cluster)) {
      state = state === "inside" && WORD_INNER.has(cluster) ? "inner" : "outside";
      return cluster;
    }
    const starts = state === "outside" && cluster === cluster.toLowerCase();
    state = "inside";
    return starts ? titlecase(cluster, lang) : cluster;
  });
}

/** Where `before` leaves off, its padding cells aside. */
function wordState(before: readonly string[]): WordState {
  const tail: string[] = [];
  for (let i = before.length - 1; i >= 0 && tail.length < 2; i--) {
    if (before[i] !== INLINE_PAD) tail.push(before[i]!);
  }
  const [last = "", previous = ""] = tail;
  if (WORD.test(last)) return "inside";
  return WORD_INNER.has(last) && WORD.test(previous) ? "inner" : "outside";
}

/** The digraphs whose titlecase is not their uppercase. */
const DIGRAPH_TITLES: Readonly<Record<string, string>> = {
  ǆ: "ǅ",
  ǉ: "ǈ",
  ǌ: "ǋ",
  ǳ: "ǲ",
};

/** A cluster's titlecase: its letter's uppercase, lowered past the
 * first letter (`ß` to `Ss`, `ﬁ` to `Fi`). */
function titlecase(cluster: string, lang: string): string {
  const [letter = "", ...marks] = cluster;
  const [head = "", ...tail] = DIGRAPH_TITLES[letter] ?? caseMapped(letter, true, lang);
  return head + tail.join("").toLowerCase() + marks.join("");
}
