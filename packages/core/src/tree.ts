import { readCellStyle } from "./style.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Build a LayoutNode tree from an element subtree.
 *
 * Rules:
 * - Elements with computed `display: none` are skipped entirely.
 * - An element becomes a **leaf** if it has no element children, or if all
 *   its element children have computed `display: inline`/`inline-*`/`contents`
 *   (they're part of the inline text flow, not laid out separately). The
 *   leaf's `text` is the element's combined `textContent`, so text nodes
 *   interleaved with inline elements (`<div>hello <span>world</span></div>`)
 *   participate in the wrap calculation and render correctly.
 * - Elements with at least one block-level element child become **containers**
 *   and recurse. Direct text nodes on containers (uncommon in utility-first
 *   markup) are not laid out — CSS creates anonymous inline boxes for them,
 *   but our absolutely-positioned children escape that flow. This is
 *   documented as a deviation in specs/cell-model.md.
 */
export function buildTree(root: Element, rootFontSizePx: number): LayoutNode | null {
  const style = readCellStyle(root, rootFontSizePx);
  if (style.display === "none") return null;

  const elementChildren = Array.from(root.children);
  const isInlineOnly = elementChildren.every(hasInlineDisplay);

  if (isInlineOnly) {
    const text = extractLeafText(root).trim();
    const intrinsicWidth = longestLine(text);
    const intrinsicHeight = text.length > 0 ? countHardLines(text) : 0;
    return {
      source: root,
      style,
      children: [],
      text,
      intrinsicWidth,
      intrinsicHeight,
      localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
    };
  }

  const children: LayoutNode[] = [];
  for (const child of elementChildren) {
    const node = buildTree(child, rootFontSizePx);
    if (node) children.push(node);
  }
  return {
    source: root,
    style,
    children,
    text: "",
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    localRect: { x: 0, y: 0, width: 0, height: 0 },
  };
}

/**
 * HTML tags whose default display is inline. Checked BEFORE computed display
 * because a flex/grid parent "blockifies" its direct children (per CSS), so
 * `<br>`/`<span>`/etc. inside a `display: flex` element compute to "block".
 * For our purposes those are still semantically inline text-flow markers
 * and shouldn't force their parent into container mode.
 */
const INLINE_BY_DEFAULT_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "I",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

function hasInlineDisplay(el: Element): boolean {
  if (INLINE_BY_DEFAULT_TAGS.has(el.tagName)) return true;
  const display = getComputedStyle(el).display;
  return display.startsWith("inline") || display === "contents";
}

/**
 * Walk childNodes and produce the leaf's text — with `<br>` emitted as `\n`
 * so the wrap calculation counts the line break the browser will honor.
 * Recurses into inline elements (`<span>`, `<a>`, `<b>`, …).
 */
function extractLeafText(el: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === "BR") parts.push("\n");
      else parts.push(extractLeafText(child));
    }
  }
  return parts.join("");
}

function longestLine(text: string): number {
  let max = 0;
  for (const line of text.split("\n")) if (line.length > max) max = line.length;
  return max;
}

function countHardLines(text: string): number {
  return text.split("\n").length;
}
