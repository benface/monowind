/**
 * Greedy word-wrap for monospace text.
 *
 * Words are runs of non-whitespace; whitespace runs collapse to single spaces
 * between fitting words. A word longer than `width` breaks at cell
 * boundaries. `\n` in the input is a HARD line break — the wrap restarts on
 * a new line (the source of these is `<br>` elements, converted to `\n` by
 * the tree builder). Returns the total number of rows the text occupies.
 *
 * Matches how a browser wraps `white-space: normal; overflow-wrap: anywhere`
 * text in a fixed-width monospace container — we set that in styles.css so
 * the two agree.
 */
export function wrapLineCount(text: string, width: number): number {
  if (text.trim() === "") return 0;
  const hardLines = text.split("\n");
  let total = 0;
  for (const hardLine of hardLines) {
    total += Math.max(1, wrapSingleLine(hardLine, width));
  }
  return total;
}

function wrapSingleLine(text: string, width: number): number {
  if (width <= 0) return text.trim().length > 0 ? 1 : 0;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let lines = 1;
  let col = 0;

  const startWord = (len: number) => {
    if (len <= width) {
      col = len;
      return;
    }
    // Break the long word: how many full lines it consumes plus the remainder.
    const full = Math.floor(len / width);
    const rem = len - full * width;
    lines += full - (rem === 0 ? 1 : 0);
    col = rem === 0 ? width : rem;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (i === 0 || col === 0) {
      startWord(word.length);
    } else if (col + 1 + word.length <= width) {
      col += 1 + word.length;
    } else {
      lines += 1;
      col = 0;
      startWord(word.length);
    }
  }
  return lines;
}
