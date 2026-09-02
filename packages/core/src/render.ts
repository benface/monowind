import { paintOrderedChildren, paintsInPositionedStep } from "./borders.ts";
import { leafLineSpans } from "./layout.ts";
import type { LayoutNode, PerSide } from "./types.ts";
import { lineAdvance } from "./wrap.ts";

/**
 * Write geometry custom properties, quantized inline padding, and z-index
 * markers on each source element in the light DOM. Coordinates on
 * LayoutNode are parent-relative; the companion stylesheet turns them
 * into px via the measured cell size. No painting: decoration and text
 * glyphs land in the shadow grid via `paint.ts`.
 *
 * Every write is change-checked: a relayout that computes the same
 * result mutates nothing. Chrome dismisses an open <select> popup on
 * style mutations near it, and the dynamic-state listeners relayout on
 * the very events that open one (focusin/pointerover) — idempotent
 * writes keep the popup up.
 */
export function render(root: LayoutNode): void {
  const inlineInsetElements = new Set<Element>();
  walk(root, true, inlineInsetElements);
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

/** setProperty, skipped when the value is already there. */
function setVar(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/** removeProperty, skipped when the property isn't set. */
function clearVar(el: HTMLElement, prop: string): void {
  if (el.style.getPropertyValue(prop) !== "") el.style.removeProperty(prop);
}

/** Boolean attribute toggle, skipped when already in the target state. */
function setFlag(el: Element, name: string, on: boolean): void {
  if (el.hasAttribute(name) === on) return;
  if (on) el.setAttribute(name, "");
  else el.removeAttribute(name);
}

function walk(node: LayoutNode, isRoot: boolean, inlineInsetElements: Set<Element>): void {
  if (node.inlineElements) {
    for (const { element, tracking, padLeft, padRight, insets } of node.inlineElements) {
      const el = element as HTMLElement;
      setVar(el, "--mw-ls", String(tracking));
      // Quantized horizontal padding (specs/cell-model.md): the companion
      // stylesheet applies these cells as the element's real padding —
      // its typography lock zeroes any authored value, so browser padding
      // always equals the cells the run reserved.
      if (padLeft > 0) setVar(el, "--mw-ipl", String(padLeft));
      else clearVar(el, "--mw-ipl");
      if (padRight > 0) setVar(el, "--mw-ipr", String(padRight));
      else clearVar(el, "--mw-ipr");
      if (insets) {
        inlineInsetElements.add(element);
        applyInlineInsets(el, insets);
      }
    }
  }

  if (!isRoot) positionElement(node);
  // A hidden table box (misparented content, <col>) hides its whole
  // subtree browser-side; nothing to recurse into.
  if (node.tableHidden) return;

  for (const child of paintOrderedChildren(node)) {
    // Absolutization would otherwise activate z-index on static block
    // children too (CSS keeps it inert there): the companion reads
    // `--mw-z`, written only where CSS applies it.
    const el = child.source as HTMLElement;
    if (child.style.zIndex !== null && paintsInPositionedStep(child, node) && !child.inlineBox)
      setVar(el, "--mw-z", String(child.style.zIndex));
    else clearVar(el, "--mw-z");
    walk(child, false, inlineInsetElements);
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
  setFlag(el, "data-mw-inline-inset", true);
  const write = (prop: string, cells: number | null) => {
    if (cells === null) clearVar(el, prop);
    else setVar(el, prop, String(cells));
  };
  write("--mw-it", insets.top);
  write("--mw-ir", insets.right);
  write("--mw-ib", insets.bottom);
  write("--mw-il", insets.left);
}

/** Centered text: the grid paints `floor(leftover / 2)` whole cells,
 * the browser centers the native copy fractionally — half a cell apart
 * on odd-leftover lines (specs/cell-model.md "Text alignment"). When
 * EVERY line shares the odd-parity drift (a single-line heading, most
 * commonly), the companion nudges the native copy half a cell left so
 * selection sits on the glyphs. CHILDLESS text leaves only: the nudge
 * would also shift an embedded atomic box's visible native ink and an
 * absolutized child's selectable text, and an inline box's own
 * form-control ink keeps browser centering per the spec. The leftover
 * math mirrors the paint's alignOffset (plain-text.ts). */
function needsCenterNudge(node: LayoutNode): boolean {
  const style = node.style;
  if (style.textAlign !== "center" || !node.text) return false;
  if (node.inlineBox || node.children.length > 0) return false;
  const multicol = node.multicolGeometry;
  const padding = node.resolvedPadding;
  const contentWidth =
    node.localRect.width - style.border.left - style.border.right - padding.left - padding.right;
  const alignWidth = multicol ? Math.max(1, multicol.columnWidth - style.tracking) : contentWidth;
  const spans = multicol?.spans ?? leafLineSpans(node, contentWidth);
  if (spans.length === 0) return false;
  return spans.every((span, i) => {
    const indent = i === 0 ? style.textIndent : 0;
    const leftover =
      alignWidth - indent - lineAdvance(span.start, span.end, node.advances, style.tracking);
    return leftover > 0 && leftover % 2 === 1;
  });
}

function positionElement(node: LayoutNode): void {
  const el = node.source as HTMLElement;
  const rect = node.localRect;
  const padding = node.resolvedPadding;
  const { border, textAlignBlocked, overflow, whiteSpace, tracking, lineGap } = node.style;
  // Atomic inline boxes and paragraph-flow multicol children stay IN
  // FLOW (the browser's own line layout / column fragmentation places
  // them); everything else is engine-positioned. Same geometry vars, a
  // different companion rule each (see styles.css).
  const flow = node.multicolFlow;
  const flowSpan = node.multicolFlowSpan;
  setFlag(el, "data-mw-laid-out", !node.inlineBox && !flow && !flowSpan);
  setFlag(el, "data-mw-inline-box", Boolean(node.inlineBox));
  setFlag(el, "data-mw-multicol-flow", Boolean(flow));
  setFlag(el, "data-mw-multicol-flow-span", Boolean(flowSpan));
  const flowMargins = flow ?? flowSpan;
  if (flowMargins) {
    setVar(el, "--mw-mt", String(flowMargins.top ?? 0));
    setVar(el, "--mw-mr", String(flowMargins.right ?? 0));
    setVar(el, "--mw-mb", String(flowMargins.bottom ?? 0));
    setVar(el, "--mw-ml", String(flowMargins.left ?? 0));
  } else {
    clearVar(el, "--mw-mt");
    clearVar(el, "--mw-mr");
    clearVar(el, "--mw-mb");
    clearVar(el, "--mw-ml");
  }
  // Bottom-aligned atomic boxes keep their browser alignment (grid-exact,
  // probed); everything else is pinned top by the companion rule.
  setFlag(el, "data-mw-vbottom", Boolean(node.inlineBox) && node.style.verticalAlign === "end");
  // Grid typography (specs/cell-model.md): extra cells per character, rows
  // per wrapped line, and the half-leading cancellation shift.
  setVar(el, "--mw-ls", String(tracking));
  setVar(el, "--mw-lh", String(lineGap + 1));
  setVar(el, "--mw-lhs", String(-lineGap / 2));
  setFlag(el, "data-mw-nowrap", whiteSpace !== "normal");
  // A multicol TEXT LEAF or paragraph-flow container keeps native
  // columns, driven by the engine's used values so the browser
  // fragments on the same lines (specs/multicol.md "Browser
  // agreement"); a spanner-split flow additionally trusts the NATIVE
  // balancer per segment (probed exact). Atomic element-children
  // containers get no flag: their light DOM has nothing in flow.
  // Flow CHILDREN carry a geometry too (their line maps) but must never
  // get native columns themselves — only the container fragments.
  const multicol = flow || flowSpan ? undefined : node.multicolGeometry;
  setFlag(el, "data-mw-multicol", Boolean(multicol));
  setFlag(el, "data-mw-multicol-balance", Boolean(multicol?.nativeBalance));
  if (multicol) {
    setVar(el, "--mw-colc", String(multicol.columnCount));
    setVar(el, "--mw-colg", String(multicol.gap));
  } else {
    clearVar(el, "--mw-colc");
    clearVar(el, "--mw-colg");
  }
  // `white-space: pre` leaves also keep their preserved spaces
  // browser-side (the tree builder kept them in the run) — see styles.css.
  setFlag(el, "data-mw-pre", whiteSpace === "pre");
  setVar(el, "--mw-x", String(rect.x));
  setVar(el, "--mw-y", String(rect.y));
  setVar(el, "--mw-w", String(rect.width));
  setVar(el, "--mw-h", String(rect.height));
  setFlag(el, "data-mw-clip", overflow === "clip");
  // The browser insets content by border + padding; the engine has already
  // allocated cells for both. We expose them separately so the companion CSS
  // reads naturally, and the CSS sums them into the actual `padding` (since
  // engine border is painted as glyphs, native border-width stays 0).
  setVar(el, "--mw-pt", String(padding.top));
  setVar(el, "--mw-pr", String(padding.right));
  setVar(el, "--mw-pb", String(padding.bottom));
  setVar(el, "--mw-pl", String(padding.left));
  setVar(el, "--mw-bt", String(border.top));
  setVar(el, "--mw-br", String(border.right));
  setVar(el, "--mw-bb", String(border.bottom));
  setVar(el, "--mw-bl", String(border.left));
  // Native text-indent is authored in px; overwrite it in cells so the
  // browser's own line (the selectable, transparent-locked text under
  // the grid) sits under the glyphs the engine painted. Always set —
  // custom properties inherit, so an unset var on an `indent-0` child
  // would resolve to an indented ancestor's value.
  setVar(el, "--mw-ti", String(node.style.textIndent));
  setFlag(el, "data-mw-text-align-blocked", textAlignBlocked);
  setFlag(el, "data-mw-center-nudge", needsCenterNudge(node));
  // Un-laid-out direct text (mixed with block children) would otherwise
  // paint unpositioned over the children — hide it (see styles.css).
  setFlag(el, "data-mw-dropped-text", Boolean(node.droppedText));
  setFlag(el, "data-mw-table-hidden", Boolean(node.tableHidden));
}
