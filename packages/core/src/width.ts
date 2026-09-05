/**
 * Cell widths of grapheme clusters (specs/wide-characters.md): the
 * `wcwidth` convention terminals use, from Unicode tables rather than
 * the font — East Asian Wide and Fullwidth clusters and
 * emoji-presentation clusters take two cells, default-ignorable
 * clusters none, everything else one. The layout is therefore the same
 * in every engine and font, and the Node renderer needs no font.
 */

/** East Asian Wide and Fullwidth code points other than emoji, as the
 * blocks of `EastAsianWidth.txt` (Unicode 16.0) condensed to block
 * granularity: Hangul Jamo, CJK radicals and symbols, kana, Bopomofo,
 * Hangul, Yi, the ideograph blocks and planes, compatibility and
 * fullwidth forms, Tangut, Khitan, Nushu, the enclosed ideographic
 * supplement. A few unassigned code points inside a block ride along. */
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x2fff],
  [0x3000, 0x303e],
  [0x3041, 0x3096],
  [0x3099, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x318e],
  [0x3190, 0x31e5],
  [0x31ef, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0x4dbf],
  [0x4e00, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18cff, 0x18d08],
  [0x1aff0, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
  let low = 0;
  let high = WIDE_RANGES.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const [from, to] = WIDE_RANGES[mid]!;
    if (codePoint < from) high = mid;
    else if (codePoint > to) low = mid + 1;
    else return true;
  }
  return false;
}

const PICTOGRAPHIC = /^\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
const REGIONAL = /^\p{Regional_Indicator}/u;
const REGIONAL_PAIR = /^\p{Regional_Indicator}\p{Regional_Indicator}/u;
const IGNORABLE = /^[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}]+$/u;
const VARIATION_TEXT = "︎";
const VARIATION_EMOJI = "️";
const ZERO_WIDTH_JOINER = "‍";
const KEYCAP = "⃣";

/** Cells one grapheme cluster occupies. */
export function clusterWidth(cluster: string): 0 | 1 | 2 {
  const first = cluster.codePointAt(0);
  if (first === undefined) return 0;
  if (first < 0x80 && cluster.length === 1) return first < 0x20 || first === 0x7f ? 0 : 1;
  if (PICTOGRAPHIC.test(cluster)) {
    if (cluster.includes(VARIATION_TEXT)) return 1;
    if (
      cluster.includes(VARIATION_EMOJI) ||
      cluster.includes(ZERO_WIDTH_JOINER) ||
      EMOJI_PRESENTATION.test(cluster)
    )
      return 2;
    return 1;
  }
  if (cluster.includes(KEYCAP)) return 2;
  // A flag is a pair; a lone indicator is a letter in a box.
  if (REGIONAL.test(cluster)) return REGIONAL_PAIR.test(cluster) ? 2 : 1;
  if (isWide(first) || EMOJI_PRESENTATION.test(cluster)) return 2;
  if (IGNORABLE.test(cluster)) return 0;
  return 1;
}

// oxlint-disable-next-line no-control-regex -- the ASCII range itself
const ASCII = /^[\x00-\x7f]*$/;
let graphemeSegmenter: Intl.Segmenter | null | undefined;

/** The grapheme clusters of `text`, in order. ASCII text needs no
 * segmentation; without `Intl.Segmenter` code points stand in. */
export function graphemes(text: string): string[] {
  if (ASCII.test(text)) return text.split("");
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}

/** A cluster's cells plus `tracking`; a 0-width cluster gets neither. */
export function clusterAdvance(cluster: string, tracking: number): number {
  const width = clusterWidth(cluster);
  return width === 0 ? 0 : width + tracking;
}

/** Code-unit-indexed advances for `text`: a cluster's advance on its
 * first unit, 0 on the rest — the shape every per-character array
 * takes (specs/wide-characters.md). */
export function clusterAdvances(text: string, tracking = 0): number[] {
  const advances: number[] = [];
  for (const cluster of graphemes(text)) {
    advances.push(clusterAdvance(cluster, tracking));
    for (let i = 1; i < cluster.length; i++) advances.push(0);
  }
  return advances;
}

/** Cells `text` occupies on one line. */
export function textCells(text: string): number {
  let cells = 0;
  for (const cluster of graphemes(text)) cells += clusterWidth(cluster);
  return cells;
}
