/**
 * Greedy word-wrap for monospace text.
 *
 * Words are runs of non-whitespace; whitespace runs collapse to single spaces
 * between fitting words. Browsers also treat a hyphen inside a word as a
 * break opportunity (break after `-`, no hyphen added) — except before a
 * digit, per UAX #14 (`2026-08` doesn't break) — so words are further split
 * into breakable segments. A segment longer than `width` breaks at cell
 * boundaries. `\n` in the input is a HARD line break — the wrap restarts on
 * a new line (the source of these is `<br>` elements, converted to `\n` by
 * the tree builder). A blank hard line still occupies one row.
 *
 * Matches how a browser wraps `white-space: normal; overflow-wrap: anywhere`
 * text in a fixed-width monospace container — we set that in styles.css so
 * the two agree.
 */
export function wrapLines(text: string, width: number): string[] {
  if (text.trim() === "") return [];
  return text.split("\n").flatMap((hardLine) => wrapHardLine(hardLine, width));
}

/** Number of rows `text` occupies at `width` (see wrapLines). */
export function wrapLineCount(text: string, width: number): number {
  return wrapLines(text, width).length;
}

/**
 * Split a word at its internal break opportunities: after each hyphen run,
 * unless the next character is a digit (UAX #14: no break between a hyphen
 * and a following number). `"mx-auto"` → `["mx-", "auto"]`;
 * `"2026-08"` → `["2026-08"]`. Also the unit of min-content width.
 */
export function breakableSegments(word: string): string[] {
  const segments: string[] = [];
  let start = 0;
  const hyphenRun = /-+/g;
  let match: RegExpExecArray | null;
  while ((match = hyphenRun.exec(word)) !== null) {
    const end = match.index + match[0].length;
    if (end < word.length && !/[0-9]/.test(word[end]!)) {
      segments.push(word.slice(start, end));
      start = end;
    }
  }
  segments.push(word.slice(start));
  return segments;
}

function wrapHardLine(text: string, width: number): string[] {
  // CSS "document white space" only: space, tab, CR, LF, FF. Notably NOT
  // NBSP (U+00A0) — JS `\s` would match it, but the browser neither
  // collapses nor breaks at it, so it must stay inside its word.
  const words = text.split(/[ \t\r\n\f]+/).filter(Boolean);
  if (words.length === 0) return [""];
  if (width <= 0) return [words.join(" ")];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    let joinsPrevious = false; // segments after the first attach with no space
    for (let segment of breakableSegments(word)) {
      const separator = !joinsPrevious && current !== "" ? 1 : 0;
      if (current !== "" && current.length + separator + segment.length <= width) {
        current += separator ? ` ${segment}` : segment;
      } else {
        if (current !== "") lines.push(current);
        // Break a too-long segment at cell boundaries; a chunk of exactly
        // `width` stays as the current line (matching browser overflow-wrap).
        while (segment.length > width) {
          lines.push(segment.slice(0, width));
          segment = segment.slice(width);
        }
        current = segment;
      }
      joinsPrevious = true;
    }
  }
  lines.push(current);
  return lines;
}
