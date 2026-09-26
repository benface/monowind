/**
 * The running animations and transitions under a host, classified by
 * the properties they touch into what a frame does (specs/animations.md).
 */

import type { LayoutNode } from "./types.ts";

/** What a frame does for an element's running animations: `box`
 * places its layer's box again from the computed effects and opacity;
 * `paint` resamples its live paint-only properties into its node and
 * repaints the last layout; `layout` re-lays-out, which reads every
 * animated value under `[measuring]`. */
export type AnimationPath = "box" | "paint" | "layout";

/** The layer effects a box copies live (specs/layers.md), named alike
 * in keyframes and CSS; a `backdrop-filter`, locked on the light
 * element, reads through the relayout. */
export const EFFECTS = new Set(["transform", "translate", "rotate", "scale", "filter"]);

/** The properties a repaint samples live: the walk reads them off the
 * node, and nothing locks them on the light element. */
export const PAINT_ONLY = new Set([
  "color",
  "opacity",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
]);

const KEYFRAME_META = new Set(["offset", "computedOffset", "easing", "composite"]);

const camelCased = (property: string): string =>
  property.replaceAll(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());

/** How the frames sample a running transition of `property`, as CSS
 * names it (specs/animations.md): `element` as its keyframe animation
 * would be, `relayout` each frame, or null — the host's own are the
 * browser's, and any other shows at the next layout. */
export function transitionSampling(
  property: string,
  target: Element,
  pseudo: boolean,
  host: Element,
): "element" | "relayout" | null {
  if (property === "color") return "relayout";
  const paintOnly = PAINT_ONLY.has(camelCased(property));
  if (pseudo) return paintOnly ? "relayout" : null;
  if (target === host) return null;
  return paintOnly || EFFECTS.has(property) ? "element" : null;
}

/** What runs under a host (specs/animations.md): each light element's
 * animated properties — its running CSS animations' keyframes and its
 * transitions sampled as them, camel-cased as keyframes name them —
 * and whether a running transition relays out each frame. */
export interface Running {
  elements: Map<Element, Set<string>>;
  relayout: boolean;
}

/** `Running` from the animations under the host, a removed element's
 * among them left out: the host's own keyframe animations are the
 * browser's, and a pseudo-element's shows at the next layout. */
export function runningUnder(
  host: Element,
  animations: readonly Animation[] = host.getAnimations?.({ subtree: true }) ?? [],
): Running {
  const elements = new Map<Element, Set<string>>();
  let relayout = false;
  const add = (target: Element, property: string): void => {
    let properties = elements.get(target);
    if (!properties) elements.set(target, (properties = new Set()));
    properties.add(property);
  };
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (animation.playState !== "running" || !target || !target.isConnected) continue;
    const pseudo = Boolean(effect.pseudoElement);
    if ("transitionProperty" in animation) {
      const property = animation.transitionProperty as string;
      const sampling = transitionSampling(property, target, pseudo, host);
      if (sampling === "relayout") relayout = true;
      else if (sampling === "element") add(target, camelCased(property));
    } else if ("animationName" in animation && !pseudo && target !== host) {
      const keys = effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe));
      for (const key of keys) if (!KEYFRAME_META.has(key)) add(target, key);
    }
  }
  return { elements, relayout };
}

/** What runs under the host a layout pass reads, handed to its reads
 * (`readingAnimations`); null outside a pass. */
let reading: Running | null = null;

const NONE: ReadonlySet<string> = new Set();

/** Hands a layout pass's reads what runs under its host, null outside
 * one, and returns what it replaces: a pass run inside another's reads
 * (another host's plain text a leaf renderer asks for) hands it back. */
export function readingAnimations(running: Running | null): Running | null {
  const outer = reading;
  reading = running;
  return outer;
}

/** The properties `el` animates, as the pass's query found them. */
export function animatedProperties(el: Element): ReadonlySet<string> {
  return reading?.elements.get(el) ?? NONE;
}

/** Whether `el` animates a layer effect, for the read: a running
 * animation or transition of one keeps the element a layer root
 * through its identity frames, a transition's first among them. */
export function animatesEffect(el: Element): boolean {
  for (const property of animatedProperties(el)) if (EFFECTS.has(property)) return true;
  return false;
}

/** The path for an element's animated properties on its layout node
 * (null for an inline element): a `color` repaints a leaf of no inline
 * elements alone, and a border color a box off a collapsed table, the
 * others' colors being snapshots a layout took. */
export function animationPath(
  properties: ReadonlySet<string>,
  node: LayoutNode | null,
): AnimationPath | null {
  if (properties.size === 0) return null;
  const leaf = node !== null && node.children.length === 0 && !node.inlineElements?.length;
  const latticed = node !== null && node.style.latticeBorder !== null;
  let boxOnly = true;
  for (const property of properties) {
    if (EFFECTS.has(property) || (property === "opacity" && node?.style.layer)) continue;
    boxOnly = false;
    if (node === null || !PAINT_ONLY.has(property)) return "layout";
    if (property === "color" ? !leaf : property !== "opacity" && latticed) return "layout";
  }
  return boxOnly ? "box" : "paint";
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
