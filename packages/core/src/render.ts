import { collectBorderRuns } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import type { Insets, LayoutNode, Rect } from "./types.ts";

/**
 * Write geometry custom properties on each source element and (re)paint the
 * decoration layer. Coordinates on LayoutNode are parent-relative; borders
 * are painted in absolute coordinates so we accumulate the parent origin as
 * we walk.
 */
export function render(root: LayoutNode, decorationLayer: HTMLElement): void {
  const borderRuns: BorderRun[] = [];
  walk(root, 0, 0, borderRuns, true);
  paintDecorations(decorationLayer, borderRuns);
}

function walk(
  node: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  borderRuns: BorderRun[],
  isRoot: boolean,
): void {
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;

  if (!isRoot) {
    positionElement(
      node.source as HTMLElement,
      node.localRect,
      node.resolvedPadding,
      node.style.border,
      node.style.textAlignBlocked,
      node.style.overflow,
      node.style.whiteSpace,
    );
  }

  collectBorderRuns(
    node.style,
    { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height },
    borderRuns,
  );

  for (const child of node.children) {
    walk(child, absX, absY, borderRuns, false);
  }
}

function positionElement(
  el: HTMLElement,
  rect: Rect,
  padding: Insets,
  border: Insets,
  textAlignBlocked: boolean,
  overflow: "visible" | "clip",
  whiteSpace: "normal" | "nowrap",
): void {
  el.setAttribute("data-mw-laid-out", "");
  if (whiteSpace === "nowrap") el.setAttribute("data-mw-nowrap", "");
  else el.removeAttribute("data-mw-nowrap");
  el.style.setProperty("--mw-x", String(rect.x));
  el.style.setProperty("--mw-y", String(rect.y));
  el.style.setProperty("--mw-w", String(rect.width));
  el.style.setProperty("--mw-h", String(rect.height));
  if (overflow === "clip") el.setAttribute("data-mw-clip", "");
  else el.removeAttribute("data-mw-clip");
  // The browser insets content by border + padding; the engine has already
  // allocated cells for both. We expose them separately so the companion CSS
  // reads naturally, and the CSS sums them into the actual `padding` (since
  // engine border is painted as glyphs, native border-width stays 0).
  el.style.setProperty("--mw-pt", String(padding.top));
  el.style.setProperty("--mw-pr", String(padding.right));
  el.style.setProperty("--mw-pb", String(padding.bottom));
  el.style.setProperty("--mw-pl", String(padding.left));
  el.style.setProperty("--mw-bt", String(border.top));
  el.style.setProperty("--mw-br", String(border.right));
  el.style.setProperty("--mw-bb", String(border.bottom));
  el.style.setProperty("--mw-bl", String(border.left));
  if (textAlignBlocked) el.setAttribute("data-mw-text-align-blocked", "");
  else el.removeAttribute("data-mw-text-align-blocked");
}

function paintDecorations(layer: HTMLElement, runs: BorderRun[]): void {
  layer.replaceChildren();
  for (const run of runs) {
    // One span PER CELL, not per run: box-drawing glyphs may come from a
    // fallback font with a different advance width than the measured cell
    // (e.g. Google Fonts subsets that omit box-drawing characters), so a
    // multi-glyph run would drift off the grid. Positioning every glyph
    // from the grid keeps borders aligned regardless of which font supplies
    // the glyph. Revisit as a perf optimization once we can detect that the
    // active font covers the glyphs (or when painting to canvas).
    for (let i = 0; i < run.length; i++) {
      const span = document.createElement("span");
      span.setAttribute("aria-hidden", "true");
      span.style.position = "absolute";
      span.style.left = `calc(${run.x + i} * var(--mw-cw))`;
      span.style.top = `calc(${run.y} * var(--mw-ch))`;
      span.style.font = "inherit";
      span.style.lineHeight = "inherit";
      span.style.whiteSpace = "pre";
      span.style.pointerEvents = "none";
      span.style.userSelect = "none";
      if (run.color) span.style.color = run.color;
      span.textContent = run.glyph;
      layer.appendChild(span);
    }
  }
}
