/**
 * Greedy word-wrap for monospace text on the cell grid.
 *
 * Text is a string plus optional per-character `advances` (cells each
 * character occupies — 1 by default, `1 + tracking` for letter-spaced text;
 * see specs/cell-model.md). Words are runs of non-whitespace; whitespace
 * runs collapse to single spaces between fitting words. Browsers also treat
 * a hyphen inside a word as a break opportunity (break after `-`, no hyphen
 * added) — except before a digit, per UAX #14 (`2026-08` doesn't break) —
 * so words are further split into breakable segments. A segment wider than
 * `width` breaks at cell boundaries. `\n` in the input is a HARD line break
 * — the wrap restarts on a new line (the source of these is `<br>`
 * elements, converted to `\n` by the tree builder). A blank hard line still
 * occupies one row.
 *
 * Matches how a browser wraps `white-space: normal; overflow-wrap: anywhere`
 * text in a fixed-width monospace container — we set that in styles.css so
 * the two agree.
 */

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
export interface WrapOptions {
  advances?: number[] | undefined;
  tracking?: number;
}

export function wrapLines(text: string, width: number, options: WrapOptions = {}): string[] {
  return wrapLineSpans(text, width, options).map((span) => text.slice(span.start, span.end));
}

/** Number of rows `text` occupies at `width` (see wrapLines). */
export function wrapLineCount(text: string, width: number, options: WrapOptions = {}): number {
  return wrapLineSpans(text, width, options).length;
}

export function wrapLineSpans(text: string, width: number, options: WrapOptions = {}): LineSpan[] {
  // Empty = nothing but collapsible white space. NOT `trim()`, which would
  // also eat NBSP — an NBSP-only leaf still renders a line in the browser.
  if (!/[^ \t\r\n\f]/.test(text)) return [];
  const spans: LineSpan[] = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      spans.push(...wrapHardLine(text, lineStart, i, width, options));
      lineStart = i + 1;
    }
  }
  return spans;
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
export function lineAdvance(start: number, end: number, advances?: number[], tracking = 0): number {
  if (end <= start) return 0;
  return advanceOf(start, end, advances) - Math.min(tracking, trailingGap(end - 1, advances));
}

function trailingGap(index: number, advances?: number[]): number {
  return advances ? (advances[index] ?? 1) - 1 : 0;
}

/** Widest unbreakable unit (breakable segment) in the text — the
 * min-content width of a wrapping leaf. */
export function longestSegmentAdvance(text: string, options: WrapOptions = {}): number {
  const { advances, tracking = 0 } = options;
  let longest = 0;
  for (const word of wordRanges(text, 0, text.length)) {
    for (const segment of breakableSegmentRanges(text, word.start, word.end)) {
      longest = Math.max(longest, lineAdvance(segment.start, segment.end, advances, tracking));
    }
  }
  return longest;
}

/**
 * Split a word at its internal break opportunities: after each hyphen run,
 * unless the next character is a digit (UAX #14: no break between a hyphen
 * and a following number). `"mx-auto"` → `["mx-", "auto"]`;
 * `"2026-08"` → `["2026-08"]`.
 */
export function breakableSegments(word: string): string[] {
  return breakableSegmentRanges(word, 0, word.length).map((r) => word.slice(r.start, r.end));
}

function breakableSegmentRanges(text: string, start: number, end: number): LineSpan[] {
  const segments: LineSpan[] = [];
  let segmentStart = start;
  for (let i = start; i < end; i++) {
    if (text[i] !== "-") continue;
    while (i + 1 < end && text[i + 1] === "-") i++;
    const next = i + 1;
    if (next < end && !/[0-9]/.test(text[next]!)) {
      segments.push({ start: segmentStart, end: next });
      segmentStart = next;
    }
  }
  segments.push({ start: segmentStart, end });
  return segments;
}

// CSS "document white space" only: space, tab, CR, LF, FF. Notably NOT NBSP
// (U+00A0) — JS `\s` would match it, but the browser neither collapses nor
// breaks at it, so it must stay inside its word.
const COLLAPSIBLE = /[ \t\r\n\f]/;

function wordRanges(text: string, start: number, end: number): LineSpan[] {
  const words: LineSpan[] = [];
  let i = start;
  while (i < end) {
    while (i < end && COLLAPSIBLE.test(text[i]!)) i++;
    if (i >= end) break;
    const wordStart = i;
    while (i < end && !COLLAPSIBLE.test(text[i]!)) i++;
    words.push({ start: wordStart, end: i });
  }
  return words;
}

function wrapHardLine(
  text: string,
  start: number,
  end: number,
  width: number,
  { advances, tracking = 0 }: WrapOptions,
): LineSpan[] {
  const words = wordRanges(text, start, end);
  if (words.length === 0) return [{ start, end: start }];
  if (width <= 0) return [{ start: words[0]!.start, end: words[words.length - 1]!.end }];

  const lines: LineSpan[] = [];
  let current: LineSpan | null = null;
  // Advances accumulated over the current line, with words joined by ONE
  // space each regardless of the source whitespace run (collapsing).
  let advancesSum = 0;

  for (const word of words) {
    let joinsPrevious = false; // segments after the first attach with no space
    for (const segment of breakableSegmentRanges(text, word.start, word.end)) {
      let segStart = segment.start;
      const segEnd = segment.end;
      const separatorStart = current !== null && !joinsPrevious ? segStart - 1 : segStart;
      const candidate = advancesSum + advanceOf(separatorStart, segEnd, advances);
      const trailing = Math.min(tracking, trailingGap(segEnd - 1, advances));
      if (current !== null && candidate - trailing <= width) {
        current.end = segEnd;
        advancesSum = candidate;
      } else {
        if (current !== null) lines.push(current);
        // Break a too-wide segment at cell boundaries: a chunk of exactly
        // `width` stays as the current line (matching browser overflow-wrap).
        for (;;) {
          let fit = segStart;
          while (fit < segEnd && lineAdvance(segStart, fit + 1, advances, tracking) <= width) fit++;
          if (fit === segEnd || fit === segStart) break;
          lines.push({ start: segStart, end: fit });
          segStart = fit;
        }
        current = { start: segStart, end: segEnd };
        advancesSum = advanceOf(segStart, segEnd, advances);
      }
      joinsPrevious = true;
    }
  }
  if (current !== null) lines.push(current);
  return lines;
}
