/**
 * Greedy word-wrap for monospace text on the cell grid, as a browser
 * wraps text under `overflow-wrap: anywhere` (styles.css sets that):
 * white space collapsing or kept (`preserve`), UAX #14's subset of break
 * opportunities, a hyphen's break after it past a word's start, and
 * `\n` hard breaks, per specs/cell-model.md "Whitespace collapsing" and
 * "Line breaking". Text is a string plus optional per-character
 * `advances` (cells each character occupies, `1 + tracking` for
 * letter-spaced text).
 */

import { clusterWidth } from "./width.ts";

/** A wrapped line as an index range into the text (`end` exclusive). */
export interface LineSpan {
  start: number;
  end: number;
}

/**
 * Wrap options: per-character `advances` for tracked text (cells each
 * character occupies, `1 + tracking` of its innermost element), and the
 * leaf's own `tracking` — the trailing gap it absorbs at line ends (see
 * `lineAdvance`). Defaults: plain 1-cell characters, no tracking.
 */
interface WrapOptions {
  advances?: number[] | undefined;
  tracking?: number;
  /** `text-indent` in cells: reduces the first hard line's usable width
   * (the paint layer offsets that line's x by the same amount). Per CSS,
   * subsequent hard lines (`<br>`-separated) don't re-indent. */
  firstLineIndent?: number | undefined;
  /** Opens line box `index`, given the lines closed before it, and
   * returns the cells it may use (specs/float.md): the caller picks the
   * line's row and the band floats leave there. Absent, every line has
   * the full width. */
  openLine?: ((index: number, closed: readonly LineSpan[]) => number) | undefined;
  /** Preserved white space (specs/cell-model.md "White-space and
   * truncation"): `hang`, `pre-wrap`'s, whose spaces at a soft break
   * hang; `break`, `break-spaces`', whose every space takes its cell with
   * a break after it. Either keeps a hard line's leading spaces. */
  preserve?: "hang" | "break" | undefined;
  /** `word-break` (specs/cell-model.md "Line breaking"): `break-all`
   * breaks between any two letters, `keep-all` keeps CJK runs whole. */
  wordBreak?: "normal" | "break-all" | "keep-all" | undefined;
}

export function wrapLines(text: string, width: number, options: WrapOptions = {}): string[] {
  return wrapLineSpans(text, width, options).map((span) => text.slice(span.start, span.end));
}

/** Number of rows `text` occupies at `width` (see wrapLines). */
export function wrapLineCount(text: string, width: number, options: WrapOptions = {}): number {
  return wrapLineSpans(text, width, options).length;
}

/** A final `\n` produces no last line box (probed, all engines: `a<br>`
 * is one line, `a<br><br>` two, `<br>` alone one) — drop the empty span
 * it would otherwise create. */
function dropFinalBreakSpan(spans: LineSpan[], text: string): LineSpan[] {
  if (text.endsWith("\n")) spans.pop();
  return spans;
}

/** Split at hard `\n` breaks only (the `white-space: nowrap` line model). */
export function hardLineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  return dropFinalBreakSpan(spans, text);
}

export function wrapLineSpans(text: string, width: number, options: WrapOptions = {}): LineSpan[] {
  // Nothing but collapsible white space is empty; a `\n` is a hard
  // break (a `<br>`), never collapsible.
  if (!options.preserve && !/[^ \t\r\f]/.test(text)) return [];
  const spans: LineSpan[] = [];
  let lineStart = 0;
  let indent = options.firstLineIndent ?? 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      wrapHardLine(text, lineStart, i, width, options, indent, spans);
      indent = 0; // Only the very first hard line gets the indent.
      lineStart = i + 1;
    }
  }
  return dropFinalBreakSpan(spans, text);
}

/** Cells spanned by `text[start, end)`, every character's gap included. */
export function advanceOf(start: number, end: number, advances?: number[]): number {
  if (!advances) return end - start;
  let sum = 0;
  for (let i = start; i < end; i++) sum += advances[i] ?? 1;
  return sum;
}

/**
 * Cells `text[start, end)` occupies AS A LINE (specs/cell-model.md): up to
 * `tracking` (the leaf's own tracking) cells of the last character's gap
 * are trailing and don't count — the leaf's box reserves that room. A
 * tracked inline element's larger gap stays counted: browsers keep it at a
 * line end, and the engine doesn't cancel it (uniform across engines).
 */
export function lineAdvance(
  text: string,
  start: number,
  end: number,
  advances?: number[],
  tracking = 0,
): number {
  if (end <= start) return 0;
  return advanceOf(start, end, advances) - Math.min(tracking, trailingGap(text, end - 1, advances));
}

/** The gap after the cluster ending at `index`: its advance beyond its
 * cells, read from its first unit (continuation units carry 0,
 * specs/wide-characters.md). A marker counts as one cell. */
function trailingGap(text: string, index: number, advances?: number[]): number {
  if (!advances) return 0;
  let first = index;
  while (first > 0 && advances[first] === 0) first--;
  const cells = Math.max(1, clusterWidth(text.slice(first, index + 1)));
  return Math.max(0, (advances[first] ?? 1) - cells);
}

/** Widest unbreakable unit (breakable segment) in the text, the first
 * past the first line's indent — the min-content width of a wrapping
 * leaf. */
export function longestSegmentAdvance(text: string, options: WrapOptions = {}): number {
  const { advances, tracking = 0 } = options;
  let longest = 0;
  let indent = options.firstLineIndent ?? 0;
  for (const unit of lineUnits(text, 0, text.length, options)) {
    const cells = lineCells(text, unit.start, unit.end, advances, tracking);
    longest = Math.max(longest, indent + cells);
    indent = 0;
  }
  return longest;
}

/** A soft hyphen shows at a line's end, a cell past its text. */
export const SOFT_HYPHEN = "\u00ad";

/** `<wbr>` in a run: a break opportunity standing for no text. */
export const WBR_MARKER = "\u2063";

/** Whether a line ending at `end` shows its soft hyphen, a cell past
 * its text: not where its hard line ends. */
export function showsHyphen(text: string, end: number): boolean {
  return text[end - 1] === SOFT_HYPHEN && end < text.length && text[end] !== "\n";
}

/** The cells a line of `text[start, end)` takes (lineAdvance), a soft
 * hyphen it shows drawn past its last character's gap. */
export function lineCells(
  text: string,
  start: number,
  end: number,
  advances?: number[],
  tracking = 0,
): number {
  return showsHyphen(text, end)
    ? advanceOf(start, end, advances) + 1
    : lineAdvance(text, start, end, advances, tracking);
}

/** U+FFFC marks an embedded atomic inline box (see LayoutNode.inlineBox):
 * unbreakable itself, but with break opportunities on BOTH sides, like
 * browsers give replaced elements. */
export const OBJECT_REPLACEMENT = "\uFFFC";

/** U+2060 (word joiner) marks ONE CELL of inline-element horizontal
 * padding in a run (specs/cell-model.md): pure blank space glued to its
 * neighbors — not collapsible white space, no break opportunity — so it
 * travels with the padded element's edge across wraps exactly like the
 * browser's `box-decoration-break: slice` padding. Multi-cell padding is
 * several 1-cell markers, keeping every gap/advance invariant intact.
 * (Escape form on purpose: the character is invisible.) */
export const INLINE_PAD = "\u2060";

/** Visit each object-replacement marker in a run, pairing its character
 * index with its ordinal (= index into the leaf's box list, which is in
 * run order). */
export function eachObjectMarker(
  text: ArrayLike<string>,
  visit: (charIndex: number, boxIndex: number) => void,
): void {
  let boxIndex = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== OBJECT_REPLACEMENT) continue;
    visit(i, boxIndex);
    boxIndex++;
  }
}

/** A word's breakable segments, pushed onto `segments`. */
function breakableSegmentRanges(
  text: string,
  start: number,
  end: number,
  { advances, wordBreak }: WrapOptions,
  segments: LineSpan[],
): void {
  let segmentStart = start;
  const cut = (at: number): void => {
    if (at <= segmentStart || at >= end) return;
    segments.push({ start: segmentStart, end: at });
    segmentStart = at;
  };
  for (let i = start; i < end;) {
    if (text[i] === OBJECT_REPLACEMENT) {
      cut(i);
      cut(i + 1);
      i++;
    } else if (text[i] === "-") {
      // Word-initial runs aren't break opportunities (file header).
      const wordInitial = i === start;
      while (i + 1 < end && text[i + 1] === "-") i++;
      if (!wordInitial) cut(i + 1);
      i++;
    } else {
      const next = i + (isHighSurrogate(text.charCodeAt(i)) ? 2 : 1);
      // Never inside a cluster, whose later units take no cells.
      if (next < end && advances?.[next] !== 0 && breaksBetween(text, i, next, wordBreak)) {
        cut(next);
      }
      i = next;
    }
  }
  if (end > segmentStart) segments.push({ start: segmentStart, end });
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code < 0xdc00;

/** The subset's classes (specs/cell-model.md "Line breaking"): a
 * character with a break before and after it (CJK), none after it
 * (opening punctuation), none before it (closing punctuation, `ー`,
 * small kana, a combining mark), one after it alone (a zero-width
 * space, `<wbr>`, a soft hyphen, an en dash, an ideographic space),
 * one either side (an em dash, not between two), and none either side
 * (a no-break space, inline padding). */
type Break = "other" | "ideographic" | "opening" | "closing" | "after" | "dash" | "glue";

const OPENING = new Set("([{（［｛〔〈《「『【〘〖〝｟｢");
const CLOSING = new Set(
  ")]},.:;!?、。，．：；？！）］｝〕〉》」』】〙〗〟｠｣・ヽヾゝゞ々〻ー゛゜" +
    "ぁぃぅぇぉっゃゅょゎゕゖ" +
    "ァィゥェォッャュョヮヵヶｧｨｩｪｫｬｭｮｯｰ",
);
const AFTER = new Set(["\u200b", WBR_MARKER, SOFT_HYPHEN, "–", "\u3000"]);
const GLUE = new Set(["\u00a0", "\u202f", "\u2007", "\ufeff", INLINE_PAD]);
const MARK = /\p{M}/u;

/** The class of the character at `at`, as `word-break` has it: under
 * `break-all` a letter breaks as an ideograph does, under `keep-all` an
 * ideograph joins as a letter. */
function breakClass(text: string, at: number, wordBreak: WrapOptions["wordBreak"]): Break {
  const ch = text[at]!;
  if (GLUE.has(ch)) return "glue";
  if (AFTER.has(ch)) return "after";
  if (ch === "—") return "dash";
  if (CLOSING.has(ch) || MARK.test(ch)) return "closing";
  if (OPENING.has(ch)) return "opening";
  if (wordBreak === "break-all") return "ideographic";
  const code = text.codePointAt(at)!;
  const ideographic =
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x3ffff);
  return ideographic && wordBreak !== "keep-all" ? "ideographic" : "other";
}

/** Whether a line may break between the characters at `at` and
 * `next`: ASCII pairs only at hyphens (breakableSegmentRanges), save
 * under `break-all`, whose letters break as ideographs do, where
 * `keep-all`'s ideographs join as letters. */
function breaksBetween(
  text: string,
  at: number,
  next: number,
  wordBreak: WrapOptions["wordBreak"],
): boolean {
  const ascii = text.charCodeAt(at) < 0x80 && text.charCodeAt(next) < 0x80;
  if (ascii && wordBreak !== "break-all") return false;
  const before = breakClass(text, at, wordBreak);
  const after = breakClass(text, next, wordBreak);
  if (before === "glue" || after === "glue" || before === "opening") return false;
  if (after === "closing" || after === "after" || text[next] === "-") return false;
  if (before === "after") return true;
  if (before === "dash" || after === "dash") return before !== after;
  return before === "ideographic" || after === "ideographic";
}

/** CSS "document white space" only: space, tab, CR, LF, FF. Not NBSP
 * (U+00A0), which JS `\s` would match: the browser neither collapses nor
 * breaks at it, so it stays inside its word. */
const COLLAPSIBLE = /[ \t\r\n\f]/;

/** A hard line's units, each followed by a break opportunity: its
 * words' breakable segments, and under `break-spaces` each space. */
function lineUnits(text: string, start: number, end: number, options: WrapOptions): LineSpan[] {
  const { preserve } = options;
  const units: LineSpan[] = [];
  let i = start;
  while (i < end) {
    if (COLLAPSIBLE.test(text[i]!)) {
      if (preserve === "break") units.push({ start: i, end: i + 1 });
      i++;
      continue;
    }
    const wordStart = i;
    while (i < end && !COLLAPSIBLE.test(text[i]!)) i++;
    breakableSegmentRanges(text, wordStart, i, options, units);
  }
  return units;
}

/** Wraps one hard line, pushing its line boxes onto `lines` — the flat
 * list of the leaf's lines so far, which `openLine` sees. */
function wrapHardLine(
  text: string,
  start: number,
  end: number,
  width: number,
  options: WrapOptions,
  firstLineIndent: number,
  lines: LineSpan[],
): void {
  const { advances, tracking = 0, openLine, preserve } = options;
  // Every line box opens through the caller, an empty one included.
  let bandIndex = -1;
  let bandWidth = width;
  const band = (): number => {
    if (bandIndex !== lines.length) {
      bandIndex = lines.length;
      bandWidth = openLine?.(bandIndex, lines) ?? width;
    }
    return bandWidth;
  };
  const units = lineUnits(text, start, end, options);
  if (units.length === 0) {
    band();
    lines.push({ start, end: start });
    return;
  }
  if (width <= 0) {
    band();
    lines.push({ start: units[0]!.start, end: units[units.length - 1]!.end });
    return;
  }

  // Preserved, the line opens at the hard line's start, its leading
  // spaces taking their cells.
  let current: LineSpan | null = preserve ? { start, end: start } : null;
  // Advances accumulated over the current line, what joins a unit to it
  // included: ONE space per collapsed run, or the preserved ones.
  let advancesSum = 0;
  // Only the first line box (before the first `lines.push`) is charged
  // the text-indent — subsequent lines get the full width back.
  let lineIndent = firstLineIndent;
  const availableWidth = () => band() - lineIndent;

  for (const unit of units) {
    let segmentStart = unit.start;
    const segmentEnd = unit.end;
    if (current !== null) {
      const from = preserve || current.end === segmentStart ? current.end : segmentStart - 1;
      const candidate = advancesSum + advanceOf(from, segmentEnd, advances);
      const trailing = Math.min(tracking, trailingGap(text, segmentEnd - 1, advances));
      const cells = showsHyphen(text, segmentEnd) ? candidate + 1 : candidate - trailing;
      if (cells <= availableWidth()) {
        current.end = segmentEnd;
        advancesSum = candidate;
        continue;
      }
      // A line with text or leading spaces closes; the spaces before the
      // unit hang past it.
      if (current.end > current.start || segmentStart > current.start) {
        lines.push(current);
        lineIndent = 0;
      }
    }
    // Break a too-wide segment at cell boundaries: a chunk of exactly
    // `width` stays as the current line (matching browser overflow-wrap).
    for (;;) {
      let fit = segmentStart;
      while (
        fit < segmentEnd &&
        lineCells(text, segmentStart, fit + 1, advances, tracking) <= availableWidth()
      )
        fit++;
      if (fit === segmentEnd || fit === segmentStart) break;
      lines.push({ start: segmentStart, end: fit });
      lineIndent = 0;
      segmentStart = fit;
    }
    current = { start: segmentStart, end: segmentEnd };
    advancesSum = advanceOf(segmentStart, segmentEnd, advances);
  }
  if (current !== null) lines.push(current);
}
