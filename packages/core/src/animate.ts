/**
 * Engine-synthesized transitions for lock-owned properties
 * (specs/cell-model.md "Animation"). `background-color` has no native
 * timeline to sample — the companion locks the light DOM's bg
 * transparent so it can't cover the grid, so the authored value only
 * exists in measuring snapshots. When a read sees the value change on
 * an element whose authored `transition` covers background-color, the
 * engine runs the fade itself: a target-less `Animation` with the
 * authored duration, delay, and easing gives the browser's own eased
 * progress, and the colors interpolate in OKLAB (CSS's interpolation
 * space for non-legacy pairs; legacy rgb pairs interpolate in sRGB,
 * per css-color-4).
 *
 * In two phases: a read under the mask records the change
 * (`trackBackground`), and the pass's end, where the authored
 * `transition-property` reads again, arms the fade
 * (`resolvePendingTransitions`).
 */

import { animatedProperties } from "./animation.ts";
import {
  isLegacyColor,
  mixColors,
  parseColor,
  prepareColor,
  serializeColor,
  splitTopLevel,
} from "./color.ts";
import type { Prepared, Rgba } from "./color.ts";

interface SynthesizedTransition {
  from: Prepared;
  to: Prepared;
  space: "srgb" | "oklab";
  toValue: string;
  timing: Animation;
}

const lastBackground = new WeakMap<Element, string>();
/** The changes the reads found, each element's from its first read. */
const pending = new Map<Element, { from: string; to: string }>();
/** A Map, which hasSynthesizedTransitions sweeps of entries whose
 * element left the tree or whose fade expired unsampled (hidden
 * mid-fade): a stray entry would keep the sampling loop running. */
const active = new Map<Element, SynthesizedTransition>();

/**
 * Called from the style reader with the freshly read background-color
 * (empty string when unset). Returns the value layout should USE: the
 * in-flight interpolation when a synthesized transition is running,
 * the previous value when a change was just detected on an element
 * that MIGHT transition (the fade or a corrective repaint follows next
 * frame — see resolvePendingTransitions), or the value itself. The
 * might-transition check reads `transition-duration`, which the
 * measuring override does NOT mask — an element with no transition at
 * all must paint its new background THIS pass, never a stale one.
 */
export function trackBackground(el: Element, value: string, cs: CSSStyleDeclaration): string {
  const previous = lastBackground.get(el);
  lastBackground.set(el, value);
  // A keyframe animation's value is the browser's, read as it is
  // (specs/animations.md): a fade of the engine's ends under it.
  if (animatedProperties(el).has("backgroundColor")) {
    active.delete(el);
    return value;
  }
  const running = active.get(el);
  if (running) {
    if (value !== running.toValue) {
      // Retargeted mid-flight: restart from the current interpolated
      // color on the next resolve.
      const from = sampleColor(running);
      active.delete(el);
      pending.set(el, { from, to: value });
      return from;
    }
    const sampled = sampleColor(running);
    if (sampled === running.toValue) active.delete(el);
    return sampled;
  }
  if (
    previous !== undefined &&
    previous !== value &&
    cs.transitionDuration.split(",").some((duration) => parseFloat(duration) > 0)
  ) {
    pending.set(el, { from: previous, to: value });
    return previous;
  }
  // A second read in one layout (the anchors' re-read, element.ts)
  // answers as the first did.
  const change = pending.get(el);
  return change?.to === value ? change.from : value;
}

/** Arm this host's pending fades, once its pass has unmasked
 * (styles.css "Lock toggles must never…"). A change no authored
 * transition covers snaps, painted stale this pass: true asks the
 * caller for one more layout. Another host's changes wait for its own
 * layout. */
export function resolvePendingTransitions(host: Element): boolean {
  let hadPending = false;
  for (const [el, { from, to }] of pending) {
    // A removed element's change is nobody's to arm.
    if (!el.isConnected) {
      pending.delete(el);
      continue;
    }
    if (!host.contains(el)) continue;
    pending.delete(el);
    hadPending = true;
    const config = transitionConfigFor(getComputedStyle(el), "background-color");
    const fromColor = readColor(from);
    const toColor = readColor(to);
    if (!config || !fromColor || !toColor) continue;
    const legacy = isLegacyColor(from || "transparent") && isLegacyColor(to || "transparent");
    const space = legacy ? "srgb" : "oklab";
    // Backwards-filling as a CSS transition is: the delay shows the
    // easing's start, and the progress is null only past the end.
    const timing = new Animation(new KeyframeEffect(null, null, { ...config, fill: "backwards" }));
    timing.play();
    active.set(el, {
      from: prepareColor(fromColor, space),
      to: prepareColor(toColor, space),
      space,
      toValue: to,
      timing,
    });
  }
  return hadPending;
}

export function hasSynthesizedTransitions(): boolean {
  // Sweep entries no read will ever finish: gone elements, and ended
  // fades on elements no longer laid out (a raw read equals toValue by
  // now, so dropping them changes nothing a future read would paint).
  for (const [el, { timing }] of active) {
    if (!el.isConnected || timing.playState === "finished") active.delete(el);
  }
  return active.size > 0;
}

function sampleColor(transition: SynthesizedTransition): string {
  const { progress } = transition.timing.effect!.getComputedTiming();
  if (typeof progress !== "number") return transition.toValue;
  return serializeColor(mixColors(transition.from, transition.to, progress, transition.space));
}

/* === Transition config ================================================ */

function transitionConfigFor(cs: CSSStyleDeclaration, property: string): EffectTiming | null {
  const properties = cs.transitionProperty.split(",").map((p) => p.trim());
  // Per css-transitions, the LAST matching entry wins; shorter value
  // lists repeat to the property list's length.
  let index = -1;
  for (let i = 0; i < properties.length; i++) {
    if (properties[i] === property || properties[i] === "all") index = i;
  }
  if (index < 0) return null;
  const nth = (list: string): string => {
    const values = splitTopLevel(list, ",").map((v) => v.trim());
    return values[index % values.length] ?? "";
  };
  const duration = parseSeconds(nth(cs.transitionDuration));
  if (duration <= 0) return null;
  return {
    duration: duration * 1000,
    delay: parseSeconds(nth(cs.transitionDelay)) * 1000,
    easing: nth(cs.transitionTimingFunction),
  };
}

function parseSeconds(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.endsWith("ms") ? parsed / 1000 : parsed;
}

/* === Color ============================================================ */

/** A read background as a color: unset is transparent. */
function readColor(value: string): Rgba | null {
  return value === "" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(value);
}
