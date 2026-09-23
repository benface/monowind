/**
 * Engine-synthesized transitions for lock-owned properties
 * (specs/cell-model.md "Animation"). `background-color` has no native
 * timeline to sample — the companion locks the light DOM's bg
 * transparent so it can't cover the grid, so the authored value only
 * exists in measuring snapshots. When a read sees the value change on
 * an element whose authored `transition` covers background-color, the
 * engine runs the fade itself: same duration, delay, and easing,
 * interpolating in OKLAB (CSS's interpolation space for non-legacy
 * pairs; legacy rgb pairs interpolate in sRGB, per css-color-4).
 *
 * Two-phase because of the measuring override: reads happen under
 * `[measuring]`, where the companion forces `transition-property` to
 * the sampled set — so the CHANGE is recorded during the read
 * (`trackBackground`), and the authored config is resolved at the end
 * of the layout pass (`resolvePendingTransitions`), after the settling
 * flush restores the authored `transition-property` list.
 */

import { animatesBackground } from "./animation.ts";
import { mixColors, parseColor, prepareColor, serializeColor, splitCommas } from "./color.ts";
import type { Prepared, Rgba } from "./color.ts";

interface SynthesizedTransition {
  from: Prepared;
  to: Prepared;
  space: "srgb" | "oklab";
  toValue: string;
  start: number; // performance.now() + delay
  duration: number;
  easing: (t: number) => number;
}

const lastBackground = new WeakMap<Element, string>();
const pending: { el: Element; from: string; to: string }[] = [];
// A Map, not a WeakMap: hasSynthesizedTransitions must sweep entries
// whose element left the tree (or whose fade expired unsampled, e.g.
// hidden mid-fade) — otherwise a stray entry would pin the sampling
// loop to its 30s safety valve. The sweep bounds the strong refs.
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
  if (animatesBackground(el, cs)) {
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
      pending.push({ el, from, to: value });
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
    pending.push({ el, from: previous, to: value });
    return previous;
  }
  return value;
}

/** Arm this host's pending fades — call with `[measuring]` and
 * `[settling]` OFF (and every lock snap-back already committed under
 * the mask), so the authored `transition-property` list is readable
 * and the reads here start nothing. Changes whose config doesn't cover
 * background-color snap: they were painted STALE this pass
 * (trackBackground returned the previous value), so the caller must
 * schedule one corrective relayout whenever this returns true. Other
 * hosts' pends stay queued for their own layouts. */
export function resolvePendingTransitions(host: Element): boolean {
  let hadPending = false;
  for (let i = pending.length - 1; i >= 0; i--) {
    const { el, from, to } = pending[i]!;
    // A disconnected element's pend is dead no matter whose it was —
    // drop it here so a torn-down host can't grow the queue forever.
    if (!el.isConnected) {
      pending.splice(i, 1);
      continue;
    }
    if (!host.contains(el)) continue;
    pending.splice(i, 1);
    hadPending = true;
    const config = transitionConfigFor(getComputedStyle(el), "background-color");
    const fromColor = readColor(from);
    const toColor = readColor(to);
    if (!config || !fromColor || !toColor) continue;
    const space = isLegacy(from) && isLegacy(to) ? "srgb" : "oklab";
    active.set(el, {
      from: prepareColor(fromColor, space),
      to: prepareColor(toColor, space),
      space,
      toValue: to,
      start: performance.now() + config.delay,
      duration: config.duration,
      easing: config.easing,
    });
  }
  return hadPending;
}

export function hasSynthesizedTransitions(): boolean {
  // Sweep entries no read will ever finish: gone elements, and expired
  // fades on elements no longer laid out (a raw read equals toValue by
  // now, so dropping them changes nothing a future read would paint).
  const now = performance.now();
  for (const [el, transition] of active) {
    if (!el.isConnected || now >= transition.start + transition.duration) active.delete(el);
  }
  return active.size > 0;
}

function sampleColor(transition: SynthesizedTransition): string {
  const t = (performance.now() - transition.start) / transition.duration;
  if (t >= 1) return transition.toValue;
  const eased = t <= 0 ? 0 : transition.easing(t);
  return serializeColor(mixColors(transition.from, transition.to, eased, transition.space));
}

/* === Transition config ================================================ */

const KEYWORD_EASINGS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

function transitionConfigFor(
  cs: CSSStyleDeclaration,
  property: string,
): { duration: number; delay: number; easing: (t: number) => number } | null {
  const properties = cs.transitionProperty.split(",").map((p) => p.trim());
  // Per css-transitions, the LAST matching entry wins; shorter value
  // lists repeat to the property list's length.
  let index = -1;
  for (let i = 0; i < properties.length; i++) {
    if (properties[i] === property || properties[i] === "all") index = i;
  }
  if (index < 0) return null;
  const nth = (list: string): string => {
    const values = splitCommas(list).map((v) => v.trim());
    return values[index % values.length] ?? "";
  };
  const duration = parseSeconds(nth(cs.transitionDuration));
  if (duration <= 0) return null;
  return {
    duration: duration * 1000,
    delay: parseSeconds(nth(cs.transitionDelay)) * 1000,
    easing: parseEasing(nth(cs.transitionTimingFunction)),
  };
}

function parseSeconds(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.endsWith("ms") ? parsed / 1000 : parsed;
}

/** An easing as the computed value serializes it: every browser writes
 * `step-start`/`step-end` as steps() and each linear() point with its
 * position. */
function parseEasing(value: string): (t: number) => number {
  const keyword = KEYWORD_EASINGS[value];
  if (keyword) return cubicBezier(...keyword);
  const [, name, list = ""] = /^([\w-]+)\((.+)\)$/.exec(value) ?? [];
  const args = list.split(",").map((arg) => arg.trim());
  if (name === "cubic-bezier") {
    const [x1, y1, x2, y2] = args.map((n) => parseFloat(n));
    if ([x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
      return cubicBezier(x1!, y1!, x2!, y2!);
    }
  }
  if (name === "steps") return steps(parseInt(args[0]!, 10), args[1] ?? "end");
  if (name === "linear") return linearPoints(args);
  return (t) => t;
}

/** CSS steps(): the output holds at each level, jumping at the start,
 * the end, both, or neither of the interval. */
function steps(count: number, term: string): (t: number) => number {
  const jumps = term === "jump-none" ? count - 1 : term === "jump-both" ? count + 1 : count;
  const early = term === "start" || term === "jump-start" || term === "jump-both";
  if (!(jumps > 0)) return (t) => t;
  return (t) => Math.min(jumps, Math.floor(t * count) + (early ? 1 : 0)) / jumps;
}

/** CSS linear(): straight segments through the points, a position below
 * an earlier one raised to it, the first and last segments extended. */
function linearPoints(args: string[]): (t: number) => number {
  let floor = -Infinity;
  const points = args.map((arg) => {
    const [output = "", position = ""] = arg.split(/\s+/);
    floor = Math.max(floor, parseFloat(position) / 100);
    return { at: floor, output: parseFloat(output) };
  });
  if (points.length < 2 || points.some(({ at, output }) => !Number.isFinite(at + output))) {
    return (t) => t;
  }
  return (t) => {
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.at <= t) i++;
    const [a, b] = [points[i]!, points[i + 1]!];
    return b.at === a.at
      ? b.output
      : a.output + ((t - a.at) / (b.at - a.at)) * (b.output - a.output);
  };
}

/** Standard cubic-bezier easing: solve x(u) = t for u by bisection,
 * return y(u). Whole-cell output makes sub-ms precision pointless. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const coord = (a: number, b: number, u: number): number =>
    3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  return (t) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (coord(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return coord(y1, y2, (lo + hi) / 2);
  };
}

/* === Color ============================================================ */

/** A read background as a color: unset is transparent. */
function readColor(value: string): Rgba | null {
  return value === "" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(value);
}

/** An `rgb()` or `transparent` value (unset too): a pair of these
 * mixes in sRGB, any other pair in OKLab (css-color-4). */
function isLegacy(value: string): boolean {
  return value === "" || value === "transparent" || value.startsWith("rgb");
}
