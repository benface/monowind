import { inlineElementRects } from "./plain-text.ts";
import { isInert } from "./pointer.ts";
import type { LayoutNode, Rect } from "./types.ts";

/**
 * Arrow-key focus navigation (specs/focus-navigation.md): the pure
 * part. From the focused element's painted cells, an arrow moves to
 * the nearest focusable element entirely beyond that edge; the element
 * side (`focus="arrows"`) is plumbing around `nextFocus`.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface Focusable {
  element: Element;
  rect: Rect;
}

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** The direction an arrow key names; null for any other key. */
export function directionOf(key: string): Direction | null {
  return DIRECTIONS[key] ?? null;
}

/** The candidate to focus for an arrow from `current`: entirely beyond
 * the edge in that direction; one overlapping `current` across the
 * other axis (aligned) before any that does not; then the nearest
 * along the axis; then the smaller cross-axis gap; then the first in
 * `candidates` (document order). null when nothing lies beyond the
 * edge — no wrap. */
export function nextFocus(
  direction: Direction,
  current: Rect,
  candidates: Focusable[],
): Element | null {
  let best: Focusable | null = null;
  let bestKey: Rank | null = null;
  for (const candidate of candidates) {
    const key = rank(direction, current, candidate.rect);
    if (key && (!bestKey || ranksBefore(key, bestKey))) {
      best = candidate;
      bestKey = key;
    }
  }
  return best?.element ?? null;
}

/** [0 when overlapping across the other axis else 1, axis distance,
 * cross-axis gap] — compared lexicographically. */
type Rank = [number, number, number];

function ranksBefore(a: Rank, b: Rank): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

/** A candidate's rank; null when `rect` is not beyond `current`'s edge. */
function rank(direction: Direction, current: Rect, rect: Rect): Rank | null {
  const vertical = direction === "up" || direction === "down";
  const [start, end, size] = vertical
    ? (["y", "x", "height"] as const)
    : (["x", "y", "width"] as const);
  const currentEnd = current[start] + current[size];
  const rectEnd = rect[start] + rect[size];
  const forward = direction === "down" || direction === "right";
  const distance = forward ? rect[start] - currentEnd : current[start] - rectEnd;
  if (distance < 0) return null;
  const crossSize = vertical ? "width" : "height";
  const overlap =
    Math.min(current[end] + current[crossSize], rect[end] + rect[crossSize]) -
    Math.max(current[end], rect[end]);
  return overlap > 0 ? [0, distance, 0] : [1, distance, -overlap];
}

/** Every focusable element the layout knows, with its painted cells
 * (ancestor scroll offsets applied, as the paint walk descends), in
 * tree order: laid-out boxes and atomic inline boxes at their border
 * boxes, a text leaf's inline elements one rect per line they cover
 * (a wrapped link is reachable from each of its lines). The root
 * itself — the host — is the navigation's container, never a
 * candidate. */
export function focusableRects(root: LayoutNode): Focusable[] {
  const out: Focusable[] = [];
  const walk = (node: LayoutNode, parentX: number, parentY: number, isRoot: boolean) => {
    if (node.tableHidden) return;
    const x = parentX + node.localRect.x;
    const y = parentY + node.localRect.y;
    if (!isRoot && isFocusable(node.source)) {
      out.push({
        element: node.source,
        rect: { x, y, width: node.localRect.width, height: node.localRect.height },
      });
    }
    for (const inline of inlineElementRects(node, x, y)) {
      if (isFocusable(inline.element)) out.push(inline);
    }
    const scrollX = node.scroll?.x ?? 0;
    const scrollY = node.scroll?.y ?? 0;
    for (const child of node.children) walk(child, x - scrollX, y - scrollY, false);
  };
  walk(root, 0, 0, true);
  return out;
}

/** An element's own extent: the union of its rects (a wrapped inline
 * element has one per line); null when it has none. */
export function extentOf(rects: Focusable[], element: Element): Rect | null {
  let extent: Rect | null = null;
  for (const { element: candidate, rect } of rects) {
    if (candidate !== element) continue;
    if (!extent) extent = { ...rect };
    else {
      const x1 = Math.max(extent.x + extent.width, rect.x + rect.width);
      const y1 = Math.max(extent.y + extent.height, rect.y + rect.height);
      extent.x = Math.min(extent.x, rect.x);
      extent.y = Math.min(extent.y, rect.y);
      extent.width = x1 - extent.x;
      extent.height = y1 - extent.y;
    }
  }
  return extent;
}

/** The browser's own answer: a non-negative tabIndex, not disabled, not
 * inert. */
function isFocusable(element: Element): boolean {
  const tabIndex = (element as HTMLElement).tabIndex;
  if (typeof tabIndex !== "number" || tabIndex < 0) return false;
  return !element.matches(":disabled") && !isInert(element);
}

const TEXTUAL_INPUTS = new Set(["text", "search", "url", "tel", "email", "password"]);
/** Inputs whose arrows mean nothing natively: navigation takes them. */
const BUTTON_INPUTS = new Set(["checkbox", "button", "submit", "reset", "image", "file"]);

/** Whether an arrow key pressed on `element` belongs to the control:
 * caret movement in text fields (Left/Right in a single-line input,
 * all four in a textarea or contenteditable), a radio group's own
 * selection, a listbox select's, a value change on a stepped input
 * (number, range, dates, color), and a single select's open picker. */
export function arrowIsNative(element: Element, key: string, pickerOpen = false): boolean {
  const tag = element.tagName;
  if (tag === "TEXTAREA") return true;
  if (element.closest("[contenteditable]:not([contenteditable='false'])")) return true;
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    if (type === "radio") return true;
    if (TEXTUAL_INPUTS.has(type)) return key === "ArrowLeft" || key === "ArrowRight";
    return !BUTTON_INPUTS.has(type);
  }
  if (tag === "SELECT") {
    const select = element as HTMLSelectElement;
    // The attribute fallback: happy-dom (tests) leaves `size` unset.
    const size = Number(select.size) || Number(select.getAttribute("size")) || 0;
    return select.multiple || size > 1 || pickerOpen;
  }
  return false;
}
