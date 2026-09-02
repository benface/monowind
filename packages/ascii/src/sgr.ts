/**
 * SGR (ANSI color escape) extraction for TLF/ANSI-art glyph data: the
 * escapes are stripped from the art and become per-cell paint. The
 * 16-color palette maps to theme-aware tokens (`--mw-ansi-*`, defined
 * with defaults in styles.css) so a font's "red" follows the theme;
 * 256-color/true-color escapes pass through as literal CSS colors.
 */

export interface CellColor {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
}

/** Per-cell color state for one line; sparse (undefined = unstyled). */
export type CellColors = (CellColor | undefined)[];

const ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

const token = (index: number): string =>
  index < 8
    ? `var(--mw-ansi-${ANSI_NAMES[index]})`
    : `var(--mw-ansi-bright-${ANSI_NAMES[index - 8]})`;

/** 256-color cube/grayscale → CSS; 0–15 use the theme tokens. */
function color256(n: number): string {
  if (n < 16) return token(n);
  if (n < 232) {
    const v = (i: number) => (i === 0 ? 0 : 55 + i * 40);
    const cube = n - 16;
    return `rgb(${v(Math.floor(cube / 36))}, ${v(Math.floor(cube / 6) % 6)}, ${v(cube % 6)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;]*)m/g;

/** Split one raw glyph line into plain characters and per-cell color
 * state. Non-SGR escapes are dropped. Returns `colors` only when any
 * cell is styled. */
export function parseSgrLine(raw: string): { chars: string; colors?: CellColors } {
  if (!raw.includes("\x1b")) return { chars: raw };
  let chars = "";
  const colors: CellColors = [];
  let state: CellColor | undefined;
  let last = 0;
  let styled = false;
  SGR.lastIndex = 0;
  for (let match = SGR.exec(raw); match; match = SGR.exec(raw)) {
    for (const ch of raw.slice(last, match.index)) {
      chars += ch;
      colors.push(state);
      if (state) styled = true;
    }
    last = match.index + match[0].length;
    state = applySgr(state, match[1]!);
  }
  for (const ch of raw.slice(last)) {
    chars += ch;
    colors.push(state);
    if (state) styled = true;
  }
  return styled ? { chars, colors } : { chars };
}

function applySgr(state: CellColor | undefined, params: string): CellColor | undefined {
  const codes = params === "" ? [0] : params.split(";").map(Number);
  let next: CellColor | undefined = state ? { ...state } : undefined;
  const ensure = (): CellColor => (next ??= {});
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) next = undefined;
    else if (code === 1) ensure().bold = true;
    else if (code === 22) delete next?.bold;
    else if (code >= 30 && code <= 37) ensure().color = token(code - 30);
    else if (code >= 90 && code <= 97) ensure().color = token(code - 90 + 8);
    else if (code === 39) delete next?.color;
    else if (code >= 40 && code <= 47) ensure().backgroundColor = token(code - 40);
    else if (code >= 100 && code <= 107) ensure().backgroundColor = token(code - 100 + 8);
    else if (code === 49) delete next?.backgroundColor;
    else if (code === 38 || code === 48) {
      const target = code === 38 ? "color" : "backgroundColor";
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        ensure()[target] = color256(codes[i + 2]!);
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        ensure()[target] = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      }
    }
  }
  if (next && !next.bold && next.color === undefined && next.backgroundColor === undefined) {
    return undefined;
  }
  return next;
}
