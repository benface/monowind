/**
 * Keyframe animations sampled like transitions (specs/animations.md):
 * a light element's running CSS animations, read through
 * `getAnimations()`, classified by the properties their keyframes
 * touch into what a frame must do to show them.
 */

import type { LayoutNode } from "./types.ts";

/** What a frame does for an element's running animations: `box`
 * places its layer's box again from the computed effects; `paint`
 * resamples its live paint-only properties into its node and
 * repaints the last layout; `layout` re-lays-out, which reads every
 * animated value under `[measuring]`. */
export type AnimationPath = "box" | "paint" | "layout";

/** The layer effects a box copies live (specs/layers.md), as keyframes
 * name them; a `backdrop-filter`, locked on the light element, reads
 * through the relayout. */
const EFFECTS = new Set(["transform", "translate", "rotate", "scale", "filter"]);

/** The properties a repaint samples live: the walk reads them off the
 * node, and nothing locks them on the light element. */
const PAINT_ONLY = new Set([
  "color",
  "opacity",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
]);

const KEYFRAME_META = new Set(["offset", "computedOffset", "easing", "composite"]);

/** The elements a measure pass found animating, for their host to
 * sample (specs/animations.md): a read is the one sure sighting of an
 * animation resumed from a pause, or begun before the host listened.
 * Drained per layout pass. */
const found = new Set<Element>();

/** The properties of `el`'s running CSS animations, camel-cased as
 * keyframes name them; empty without one, or where the platform has
 * no `getAnimations`. With the computed style at hand — a measure
 * pass's read — an `animation-name` of none skips the call, and an
 * animating element is noted for its host. */
export function animatedProperties(el: Element, cs?: CSSStyleDeclaration): Set<string> {
  const properties = new Set<string>();
  if (cs && (cs.animationName === "" || cs.animationName === "none")) return properties;
  for (const animation of el.getAnimations?.() ?? []) {
    if (!("animationName" in animation) || animation.playState !== "running") continue;
    const effect = animation.effect as { getKeyframes?: () => Keyframe[] } | null;
    if (!effect?.getKeyframes) continue;
    for (const keyframe of effect.getKeyframes()) {
      for (const key of Object.keys(keyframe)) if (!KEYFRAME_META.has(key)) properties.add(key);
    }
  }
  if (cs && properties.size > 0) found.add(el);
  return properties;
}

/** The elements a pass found animating inside `host`, once each. */
export function drainAnimated(host: Element): Element[] {
  const own: Element[] = [];
  for (const el of found) {
    const owned = host.contains(el);
    if (owned || !el.isConnected) found.delete(el);
    if (owned) own.push(el);
  }
  return own;
}

/** The path for a set of animated properties on an element's layout
 * node (null for an inline element); null with nothing animated. A
 * `color` repaints only on a leaf without inline elements, since the
 * children's and the inline runs' colors are snapshots of what they
 * inherited; a border color only off a collapsed table, whose lattice
 * took its colors at layout. */
export function animationPath(
  properties: Set<string>,
  node: LayoutNode | null,
): AnimationPath | null {
  if (properties.size === 0) return null;
  const leaf = node !== null && node.children.length === 0 && !node.inlineElements?.length;
  const latticed = node !== null && node.style.latticeBorder !== null;
  let effectsOnly = true;
  for (const property of properties) {
    if (EFFECTS.has(property)) continue;
    effectsOnly = false;
    if (node === null || !PAINT_ONLY.has(property)) return "layout";
    if (property === "color" ? !leaf : latticed) return "layout";
  }
  return effectsOnly ? "box" : "paint";
}

/** Whether `el` animates a layer effect, for the read: a running
 * animation or transition of one keeps the element a layer root
 * through its identity frames, a transition's first among them. A
 * `transition-duration` of zero skips the call. */
export function animatesEffect(el: Element, cs: CSSStyleDeclaration): boolean {
  for (const property of animatedProperties(el, cs)) if (EFFECTS.has(property)) return true;
  if (!/[1-9]/.test(cs.transitionDuration)) return false;
  for (const animation of el.getAnimations?.() ?? []) {
    if (!("transitionProperty" in animation) || animation.playState !== "running") continue;
    if (EFFECTS.has(animation.transitionProperty as string)) return true;
  }
  return false;
}

/** Whether `el` animates its background: its value is the browser's,
 * read as it is. */
export function animatesBackground(el: Element, cs: CSSStyleDeclaration): boolean {
  return animatedProperties(el, cs).has("backgroundColor");
}

/** The layout node of an element, found once per layout: the
 * element's own, an anonymous run of its text left to it. */
export function nodeIndex(root: LayoutNode): Map<Element, LayoutNode> {
  const index = new Map<Element, LayoutNode>();
  const visit = (node: LayoutNode): void => {
    if (!node.anonymous) index.set(node.source, node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return index;
}
