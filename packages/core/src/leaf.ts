import { warnOnce } from "./warn.ts";

/**
 * Public leaf-renderer API (specs/leaf-renderers.md): a custom element
 * registers as a GRID LEAF and supplies its own cell content instead
 * of laid-out children — the generalization of what the tree builder
 * special-cases for form controls. `@monowind/ascii` is the first
 * consumer.
 *
 * Stability contract: this surface is public — every future change is
 * ADDITIVE (new optional fields/parameters), per the spec's evolution
 * policy.
 */

/** Per-cell styling for a run — an extensible subset of what the grid
 * paints. Color values are CSS `<color>` strings, vars welcome
 * (`var(--mw-ansi-red)`); they resolve at paint time against the
 * host, so themes restyle content with no re-render. */
export interface LeafPaint {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecorationLine?: string;
}

/** One painted span of a content line: cells `[start, end)` of
 * `lines[line]`. */
export interface LeafRun {
  line: number;
  start: number;
  end: number;
  paint: LeafPaint;
}

/** What a renderer returns: preformatted content lines (the leaf's
 * intrinsic width is the longest line, height the line count —
 * white-space styling does not apply to renderer content) plus
 * optional paint runs. */
export interface LeafContent {
  lines: string[];
  runs?: LeafRun[];
}

export interface LeafRegistration {
  /** Custom-element tag name (must contain a hyphen — built-ins are
   * never claimable). Stored lowercased. */
  tag: string;
  /** SYNCHRONOUS and DOM-read-only; called each layout pass (caching
   * is the renderer's own business). Asynchrony (font loading, …)
   * lives outside: finish the work, then `invalidateLeaves()`. Must
   * also run under happy-dom/Node — `renderPlainText` traverses the
   * same tree. */
  render: (el: Element) => LeafContent;
  /** Attributes whose changes re-render this leaf (merged into the
   * host's mutation-observer filter; `class`/`style` and character
   * data are always observed). */
  observedAttributes?: string[];
}

const leaves = new Map<string, LeafRegistration>();
const listeners = new Set<() => void>();

/** Register (or last-wins replace, with a warning) a leaf renderer.
 * Connected hosts relayout, so registration after first paint is
 * safe — the post-hoc-registration idiom every monowind registry
 * shares. */
export function registerLeafRenderer(registration: LeafRegistration): void {
  const tag = registration.tag.toLowerCase();
  if (!tag.includes("-")) {
    console.warn(
      `[monowind] registerLeafRenderer: "${registration.tag}" is not a custom-element tag name (needs a hyphen); ignored.`,
    );
    return;
  }
  if (leaves.has(tag)) {
    console.warn(
      `[monowind] registerLeafRenderer: replacing existing renderer for <${tag}> (last registration wins).`,
    );
  }
  leaves.set(tag, { ...registration, tag });
  notify();
}

/** Relayout every connected host — the invalidation hook for leaf
 * content whose inputs changed outside the DOM (a font finished
 * registering, …). Coalesced per frame by the hosts themselves. */
export function invalidateLeaves(): void {
  notify();
}

export function leafRendererFor(tagName: string): LeafRegistration | undefined {
  return leaves.get(tagName.toLowerCase());
}

/** The union of every registration's observed attributes — the host
 * extends its MutationObserver filter with these. */
export function leafObservedAttributes(): string[] {
  const all = new Set<string>();
  for (const leaf of leaves.values()) {
    for (const attribute of leaf.observedAttributes ?? []) all.add(attribute.toLowerCase());
  }
  return [...all];
}

/** Host subscription to registry changes (registration or
 * invalidation); returns the unsubscriber. Internal to the engine. */
export function onLeafRegistryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run a renderer with the spec's error contract: a throw must never
 * break layout — warn once per element and render nothing this pass. */
export function renderLeafContent(leaf: LeafRegistration, el: Element): LeafContent | null {
  try {
    return leaf.render(el);
  } catch (err) {
    warnOnce(el, `<${leaf.tag}> renderer threw; rendering nothing. ${String(err)}`);
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}
