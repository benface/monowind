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

interface Rgba {
  r: number; // 0..1, sRGB
  g: number;
  b: number;
  a: number;
  legacy: boolean; // rgb()/transparent — pairs of these lerp in sRGB
}

interface SynthesizedTransition {
  from: Rgba;
  to: Rgba;
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
    const fromColor = parseColor(from);
    const toColor = parseColor(to);
    if (!config || !fromColor || !toColor) continue;
    active.set(el, {
      from: fromColor,
      to: toColor,
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
  return serialize(mix(transition.from, transition.to, eased));
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
    const values = list.split(",").map((v) => v.trim());
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

function parseEasing(value: string): (t: number) => number {
  if (value === "linear") return (t) => t;
  const keyword = KEYWORD_EASINGS[value];
  if (keyword) return cubicBezier(...keyword);
  const bezier = value.match(/^cubic-bezier\(([^)]+)\)$/);
  if (bezier) {
    const [x1, y1, x2, y2] = bezier[1]!.split(",").map((n) => parseFloat(n));
    if ([x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
      return cubicBezier(x1!, y1!, x2!, y2!);
    }
  }
  // steps() and anything unrecognized: linear is the closest snap-free
  // stand-in.
  return (t) => t;
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

/* === Color math ======================================================= */

function parseColor(value: string): Rgba | null {
  if (value === "" || value === "transparent") return { r: 0, g: 0, b: 0, a: 0, legacy: true };
  let match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1]!.split(/[\s,/]+/).map((n) => parseFloat(n));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return {
      r: parts[0]! / 255,
      g: parts[1]! / 255,
      b: parts[2]! / 255,
      a: parts[3] ?? 1,
      legacy: true,
    };
  }
  match = value.match(/^color\(srgb ([^)]+)\)$/);
  if (match) {
    const parts = match[1]!.split(/[\s/]+/).map((n) => parseFloat(n));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1, legacy: false };
  }
  match = value.match(/^okl(ch|ab)\(([^)]+)\)$/);
  if (match) {
    const polar = match[1] === "ch";
    const parts = match[2]!
      .replaceAll("none", "0")
      .split(/[\s/]+/)
      .map((n) => parseFloat(n));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [l, c1, c2] = parts as [number, number, number];
    const a = polar ? c1 * Math.cos((c2 * Math.PI) / 180) : c1;
    const b = polar ? c1 * Math.sin((c2 * Math.PI) / 180) : c2;
    return { ...oklabToSrgb(l, a, b), a: parts[3] ?? 1, legacy: false };
  }
  return null;
}

function mix(from: Rgba, to: Rgba, t: number): Rgba {
  // Premultiplied-alpha interpolation (a transparent endpoint keeps the
  // other's chromaticity), in OKLAB unless both endpoints are legacy
  // sRGB (css-color-4 interpolation rules).
  const a = from.a + (to.a - from.a) * t;
  const lerp = (x: number, y: number): number => {
    const premixed = x * from.a + (y * to.a - x * from.a) * t;
    return a === 0 ? 0 : premixed / a;
  };
  if (from.legacy && to.legacy) {
    return { r: lerp(from.r, to.r), g: lerp(from.g, to.g), b: lerp(from.b, to.b), a, legacy: true };
  }
  const f = srgbToOklab(from.r, from.g, from.b);
  const o = srgbToOklab(to.r, to.g, to.b);
  const rgb = oklabToSrgb(lerp(f.l, o.l), lerp(f.a, o.a), lerp(f.b, o.b));
  return { ...rgb, a, legacy: false };
}

function serialize(color: Rgba): string {
  const channel = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 255);
  const alpha = Math.round(Math.min(1, Math.max(0, color.a)) * 1000) / 1000;
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function delinearize(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function srgbToOklab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToSrgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  const l3 = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m3 = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s3 = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  return {
    r: delinearize(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: delinearize(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: delinearize(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  };
}
