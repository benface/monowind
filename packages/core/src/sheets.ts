/**
 * The page's style sheets as the engine reads them: the `@counter-style`
 * rules (specs/lists.md "Counter styles") and the selectors of the rules
 * that give a `::before` or `::after` content (specs/generated-content.md
 * "What the engine reads"), each sheet walked once.
 */

import type { CounterStyleDescriptors } from "./counters.ts";
import type { Pseudo } from "./generated.ts";

/** A `@counter-style` rule and the condition rules it sits under. */
export interface CounterStyleRule {
  rule: CounterStyleDescriptors & { name: string };
  conditions: readonly CSSRule[];
}

/** What a sheet holds for the engine. */
export interface SheetRules {
  counterStyles: CounterStyleRule[];
  /** The elements' part of each selector a `content`-setting rule on a
   * `::before` or `::after` names, by pseudo-element, its nesting
   * resolved. */
  generated: Record<Pseudo, string[]>;
}

/** Each sheet's rules, read again when its top-level rules change — a
 * count, or a first rule that `replaceSync` makes anew; one inserted
 * deeper waits for that (specs/lists.md deviation 7). */
const rulesBySheet = new WeakMap<
  CSSStyleSheet,
  { count: number; first: CSSRule | undefined; rules: SheetRules }
>();

export function sheetRules(sheet: CSSStyleSheet): SheetRules {
  const list = cssRulesOf(sheet);
  const cached = rulesBySheet.get(sheet);
  if (cached?.count === list.length && cached.first === list[0]) return cached.rules;
  const rules: SheetRules = { counterStyles: [], generated: { "::before": [], "::after": [] } };
  const visit = (
    group: ArrayLike<CSSRule>,
    conditions: readonly CSSRule[],
    nest?: string,
    contained = false,
  ) => {
    for (const rule of Array.from(group)) {
      if ("additiveSymbols" in rule) {
        // A container's condition is no page's: a name it defines, none.
        if (!contained) {
          rules.counterStyles.push({
            rule: rule as unknown as CounterStyleRule["rule"],
            conditions,
          });
        }
      } else if ("styleSheet" in rule) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) visit(cssRulesOf(imported), [...conditions, rule]);
      } else if ("selectorText" in rule) {
        // A selector serializes anew each read: read only one that counts.
        const style = rule as CSSStyleRule;
        const content = style.style.getPropertyValue("content") !== "";
        const children = style.cssRules?.length > 0;
        if (!content && !children) continue;
        const selector = nest ? nested(style.selectorText, nest) : style.selectorText;
        if (content) generatedSelectors(selector, rules.generated);
        if (children) visit(style.cssRules, conditions, selector, contained);
      } else if ("containerName" in rule) {
        visit((rule as unknown as CSSGroupingRule).cssRules, conditions, nest, true);
      } else if ("cssRules" in rule) {
        const within = "conditionText" in rule ? [...conditions, rule] : conditions;
        visit((rule as CSSGroupingRule).cssRules, within, nest, contained);
      }
    }
  };
  visit(list, []);
  rulesBySheet.set(sheet, { count: list.length, first: list[0], rules });
  return rules;
}

/** The sheets that apply to a node now: its root's and its document's,
 * the document's first, each's adopted ones after its own, but a
 * disabled one and one whose media fails. */
export function pageSheets(node: Node): CSSStyleSheet[] {
  const root = node.getRootNode();
  // A detached node's root is no document or shadow root.
  return [node.ownerDocument, root === node.ownerDocument ? null : root]
    .filter((at): at is Document | ShadowRoot => at !== null && "styleSheets" in at)
    .flatMap((at) => [...Array.from(at.styleSheets), ...(at.adoptedStyleSheets ?? [])])
    .filter((sheet) => !sheet.disabled && matches(sheet.media));
}

/** A sheet's rules; none for a cross-origin one, which hides them
 * (specs/lists.md deviation 1). */
function cssRulesOf(sheet: CSSStyleSheet): ArrayLike<CSSRule> {
  try {
    return sheet.cssRules;
  } catch {
    return [];
  }
}

/** Whether a media list matches, an empty one always. */
const matches = (media: MediaList | undefined): boolean =>
  !media?.mediaText || matchMedia(media.mediaText).matches;

/** Whether a condition rule holds now: an `@media`'s or `@import`'s
 * media, an `@supports`'s condition. */
export function holds(rule: CSSRule): boolean {
  if ("media" in rule) return matches((rule as CSSMediaRule).media);
  return CSS.supports((rule as CSSSupportsRule).conditionText);
}

/** A nested rule's selectors against its parent's (`&` standing for
 * it, a relative one after it). */
const nested = (selector: string, parent: string): string =>
  splitSelectors(selector)
    .map((part) =>
      part.includes("&") ? part.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${part}`,
    )
    .join(", ");

/** A `::before` or `::after`, as the CSSOM serializes it: lowercase, and
 * no class name's escaped `\:before` (`.md\:before\:mr-1`). */
const PSEUDO = /(?<!\\)::?(before|after)\b/gu;
/** A pseudo-element no compound precedes, any element's. */
const BARE_PSEUDO = /(^|[\s>+~])::?(?:before|after)\b/gu;

/** Each selector in a list that names a `::before` or `::after`, as the
 * elements it matches — the pseudo-element stripped, any element where
 * none is left — into its pseudo-element's list, but the engine's own,
 * keyed on its flags, and one no engine parses. */
function generatedSelectors(list: string, into: Record<Pseudo, string[]>): void {
  for (const part of splitSelectors(list)) {
    const name = part.includes("[data-mw-") ? undefined : [...part.matchAll(PSEUDO)][0]?.[1];
    if (!name) continue;
    const selector = part.replace(BARE_PSEUDO, "$1*").replace(PSEUDO, "").trim();
    if (parses(selector)) into[`::${name}` as Pseudo].push(selector);
  }
}

function parses(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** A selector list's selectors, split at its top-level commas. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}
