import { collectBorderRuns, paintOrderedChildren, zIndexApplies } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import type { LayoutNode, PerSide } from "./types.ts";

/**
 * Write geometry custom properties on each source element and (re)paint the
 * decoration layer. Coordinates on LayoutNode are parent-relative; borders
 * are painted in absolute coordinates so we accumulate the parent origin as
 * we walk.
 */
export function render(root: LayoutNode, decorationLayer: HTMLElement): void {
  const borderRuns: BorderRun[] = [];
  const inlineInsetElements = new Set<Element>();
  walk(root, 0, 0, borderRuns, true, inlineInsetElements);
  paintDecorations(decorationLayer, borderRuns);
  // Clear engine-written inset vars from inline elements that no longer
  // carry authored relative insets.
  for (const el of Array.from(root.source.querySelectorAll("[data-mw-inline-inset]"))) {
    if (!inlineInsetElements.has(el)) {
      el.removeAttribute("data-mw-inline-inset");
      const style = (el as HTMLElement).style;
      for (const prop of ["--mw-it", "--mw-ir", "--mw-ib", "--mw-il"]) style.removeProperty(prop);
    }
  }
}

function walk(
  node: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  borderRuns: BorderRun[],
  isRoot: boolean,
  inlineInsetElements: Set<Element>,
): void {
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;

  if (node.inlineElements) {
    for (const { element, tracking, padLeft, padRight, insets } of node.inlineElements) {
      const el = element as HTMLElement;
      el.style.setProperty("--mw-ls", String(tracking));
      // Quantized horizontal padding (specs/cell-model.md): the companion
      // stylesheet applies these cells as the element's real padding —
      // its typography lock zeroes any authored value, so browser padding
      // always equals the cells the run reserved.
      if (padLeft > 0) el.style.setProperty("--mw-ipl", String(padLeft));
      else el.style.removeProperty("--mw-ipl");
      if (padRight > 0) el.style.setProperty("--mw-ipr", String(padRight));
      else el.style.removeProperty("--mw-ipr");
      if (insets) {
        inlineInsetElements.add(element);
        applyInlineInsets(el, insets);
      }
    }
  }

  if (!isRoot) positionElement(node);
  // A hidden table box (misparented content, <col>) hides its whole
  // subtree browser-side; nothing to paint or recurse into.
  if (node.tableHidden) return;

  collectBorderRuns(
    node.style,
    { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height },
    borderRuns,
  );
  if (node.decorationRuns) {
    for (const run of node.decorationRuns)
      borderRuns.push({ ...run, x: absX + run.x, y: absY + run.y });
  }

  for (const child of paintOrderedChildren(node)) {
    // Absolutization would otherwise activate z-index on static block
    // children too (CSS keeps it inert there): the companion reads
    // `--mw-z`, written only where CSS applies it.
    const el = child.source as HTMLElement;
    if (child.style.zIndex !== null && zIndexApplies(child, node) && !child.inlineBox)
      el.style.setProperty("--mw-z", String(child.style.zIndex));
    else el.style.removeProperty("--mw-z");
    walk(child, absX, absY, borderRuns, false, inlineInsetElements);
  }
}

/**
 * Rewrite an inline element's authored relative insets to whole-cell
 * offsets (specs/positioning.md). The values go into engine-owned custom
 * properties consumed by a `:not([measuring])`-gated companion rule —
 * writing `top` etc. directly would be read back as the authored value on
 * the next measure pass and compound (a feedback loop). Sides the author
 * left `auto` get no var: the companion declaration is then invalid at
 * computed-value time and the inset falls back to `auto`.
 */
function applyInlineInsets(el: HTMLElement, insets: PerSide<number | null>): void {
  el.setAttribute("data-mw-inline-inset", "");
  const write = (prop: string, cells: number | null) => {
    if (cells === null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, String(cells));
  };
  write("--mw-it", insets.top);
  write("--mw-ir", insets.right);
  write("--mw-ib", insets.bottom);
  write("--mw-il", insets.left);
}

function positionElement(node: LayoutNode): void {
  const el = node.source as HTMLElement;
  const rect = node.localRect;
  const padding = node.resolvedPadding;
  const { border, textAlignBlocked, overflow, whiteSpace, tracking, lineGap } = node.style;
  // Atomic inline boxes stay IN FLOW (the browser's line layout places
  // them); everything else is engine-positioned. Same geometry vars, a
  // different companion rule (see styles.css).
  el.setAttribute(node.inlineBox ? "data-mw-inline-box" : "data-mw-laid-out", "");
  el.removeAttribute(node.inlineBox ? "data-mw-laid-out" : "data-mw-inline-box");
  // Bottom-aligned atomic boxes keep their browser alignment (grid-exact,
  // probed); everything else is pinned top by the companion rule.
  if (node.inlineBox && node.style.verticalAlign === "end") el.setAttribute("data-mw-vbottom", "");
  else el.removeAttribute("data-mw-vbottom");
  // Grid typography (specs/cell-model.md): extra cells per character, rows
  // per wrapped line, and the half-leading cancellation shift.
  el.style.setProperty("--mw-ls", String(tracking));
  el.style.setProperty("--mw-lh", String(lineGap + 1));
  el.style.setProperty("--mw-lhs", String(-lineGap / 2));
  if (whiteSpace !== "normal") el.setAttribute("data-mw-nowrap", "");
  else el.removeAttribute("data-mw-nowrap");
  // `white-space: pre` leaves also keep their preserved spaces
  // browser-side (the tree builder kept them in the run) — see styles.css.
  if (whiteSpace === "pre") el.setAttribute("data-mw-pre", "");
  else el.removeAttribute("data-mw-pre");
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
  // Un-laid-out direct text (mixed with block children) would otherwise
  // paint unpositioned over the children — hide it (see styles.css).
  if (node.droppedText) el.setAttribute("data-mw-dropped-text", "");
  else el.removeAttribute("data-mw-dropped-text");
  if (node.tableHidden) el.setAttribute("data-mw-table-hidden", "");
  else el.removeAttribute("data-mw-table-hidden");
}

function paintDecorations(layer: HTMLElement, runs: BorderRun[]): void {
  layer.replaceChildren();
  // Later runs win per cell (junction tees over border edges, lattice
  // crossings) — the same overwrite semantics as renderAscii's grid;
  // overlapping glyph spans would BOTH paint (visible under mismatched
  // ink, e.g. `╦` over `═`).
  const cells = new Map<string, { x: number; y: number; glyph: string; color?: string }>();
  for (const run of runs)
    for (let i = 0; i < run.length; i++) {
      const x = run.x + i;
      const cell: { x: number; y: number; glyph: string; color?: string } = {
        x,
        y: run.y,
        glyph: run.glyph,
      };
      if (run.color) cell.color = run.color;
      cells.set(`${x},${run.y}`, cell);
    }
  // One span PER CELL, not per run: box-drawing glyphs may come from a
  // fallback font with a different advance width than the measured cell
  // (e.g. Google Fonts subsets that omit box-drawing characters), so a
  // multi-glyph run would drift off the grid. Positioning every glyph
  // from the grid keeps borders aligned regardless of which font supplies
  // the glyph. Revisit as a perf optimization once we can detect that the
  // active font covers the glyphs (or when painting to canvas).
  for (const cell of cells.values()) {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.position = "absolute";
    span.style.left = `calc(${cell.x} * var(--mw-cw))`;
    span.style.top = `calc(${cell.y} * var(--mw-ch))`;
    span.style.font = "inherit";
    span.style.lineHeight = "inherit";
    span.style.whiteSpace = "pre";
    span.style.pointerEvents = "none";
    span.style.userSelect = "none";
    if (cell.color) span.style.color = cell.color;
    span.textContent = cell.glyph;
    layer.appendChild(span);
  }
}
