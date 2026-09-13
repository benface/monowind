/**
 * Computed colors as numbers (specs/gradients.md): the forms engines
 * serialize — `rgb()`/`rgba()`, `oklab()`, `oklch()`, `color(srgb …)`,
 * `transparent` — read to sRGB with alpha, mixed in oklab, oklch,
 * srgb, srgb-linear, or hsl as CSS interpolates gradients (alpha
 * premultiplied, a polar hue turned the named way), and written back
 * as `rgb()`.
 */

/** Gamma-encoded sRGB components and alpha, each 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ColorSpace = "oklab" | "oklch" | "srgb" | "srgb-linear" | "hsl";
export type HueMode = "shorter" | "longer" | "increasing" | "decreasing";
/** The hue's index among a polar space's coordinates, −1 elsewhere. */
const hueIndex = (space: ColorSpace): number => (space === "oklch" ? 2 : space === "hsl" ? 0 : -1);

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** A component: a number, a percentage of `scale`, or `none` (0). */
const component = (token: string, scale = 1): number => {
  if (token === "none") return 0;
  const amount = parseFloat(token);
  if (!Number.isFinite(amount)) return NaN;
  return token.endsWith("%") ? (amount / 100) * scale : amount;
};

/** A color function's arguments as tokens, the `/ alpha` split off;
 * `legacy` takes a fourth comma-separated token as the alpha too. */
function args(inner: string, legacy: boolean): { tokens: string[]; alpha: number } {
  const [body, alphaText] = inner.split("/");
  const tokens = body!
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  let alpha = alphaText === undefined ? 1 : component(alphaText.trim());
  if (legacy && alphaText === undefined && tokens.length === 4) alpha = component(tokens.pop()!);
  return { tokens, alpha: Number.isFinite(alpha) ? clamp01(alpha) : 1 };
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** OKLab from linear-light sRGB (Ottosson's matrices). */
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const fromOklab = (L: number, a: number, b: number, alpha: number): Rgba => {
  const [r, g, bl] = oklabToLinear(L, a, b);
  return {
    r: clamp01(linearToSrgb(r)),
    g: clamp01(linearToSrgb(g)),
    b: clamp01(linearToSrgb(bl)),
    a: alpha,
  };
};

/** Parse a computed color; null for a form outside the ones engines
 * serialize (a `var()`, a name, a keyword), `hsl()` among them: engines
 * serialize it as `rgb()`. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const match = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (!match) return null;
  const [, fn, inner] = match;
  const { tokens, alpha } = args(inner!, fn === "rgb" || fn === "rgba");
  switch (fn) {
    case "rgb":
    case "rgba": {
      const [r, g, b] = tokens.map((t) => component(t, 255) / 255);
      return r === undefined || [r, g, b].some((c) => !Number.isFinite(c))
        ? null
        : { r: clamp01(r), g: clamp01(g!), b: clamp01(b!), a: alpha };
    }
    case "oklab": {
      const [L, a, b] = [
        component(tokens[0] ?? ""),
        component(tokens[1] ?? "", 0.4),
        component(tokens[2] ?? "", 0.4),
      ];
      return [L, a, b].some((c) => !Number.isFinite(c)) ? null : fromOklab(L, a, b, alpha);
    }
    case "oklch": {
      const [L, C, H] = [
        component(tokens[0] ?? ""),
        component(tokens[1] ?? "", 0.4),
        component(tokens[2] ?? ""),
      ];
      if ([L, C, H].some((c) => !Number.isFinite(c))) return null;
      const rad = (H * Math.PI) / 180;
      return fromOklab(L, C * Math.cos(rad), C * Math.sin(rad), alpha);
    }
    case "color": {
      const [space, ...rest] = tokens;
      const [r, g, b] = rest.map((t) => component(t));
      if (r === undefined || [r, g, b].some((c) => !Number.isFinite(c))) return null;
      if (space === "srgb-linear")
        return {
          r: clamp01(linearToSrgb(r)),
          g: clamp01(linearToSrgb(g!)),
          b: clamp01(linearToSrgb(b!)),
          a: alpha,
        };
      // srgb; the wider spaces read by their srgb-like coordinates.
      return { r: clamp01(r), g: clamp01(g!), b: clamp01(b!), a: alpha };
    }
    default:
      return null;
  }
}

/** Whether a color is written in a legacy syntax: CSS interpolates a
 * gradient of legacy colors alone in srgb, anything else in oklab. */
export const isLegacyColor = (value: string): boolean =>
  /^(?:rgba?|hsla?)\(|^transparent$|^#|^[a-z]+$/i.test(value.trim());

/** A color in its interpolation space: three coordinates and alpha;
 * NaN where CSS calls a component missing — a polar hue without
 * chroma, hsl's saturation at black or white. */
export interface Prepared {
  c: [number, number, number];
  a: number;
}

const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [NaN, l <= 1e-9 || l >= 1 - 1e-9 ? NaN : 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(((h * 60) % 360) + 360) % 360, s, l];
};

const fromHsl = (h: number, s: number, l: number, a: number): Rgba => {
  const hue = (((Number.isNaN(h) ? 0 : h) % 360) + 360) % 360;
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: clamp01(f(0)), g: clamp01(f(8)), b: clamp01(f(4)), a };
};

/** A color ready to mix in a space — once per stop, since a gradient
 * mixes its stops at every cell. */
export function prepareColor({ r, g, b, a }: Rgba, space: ColorSpace): Prepared {
  if (space === "srgb") return { c: [r, g, b], a };
  if (space === "hsl") return { c: toHsl(r, g, b), a };
  const linear: [number, number, number] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  if (space === "srgb-linear") return { c: linear, a };
  const [L, A, B] = linearToOklab(...linear);
  if (space === "oklab") return { c: [L, A, B], a };
  const chroma = Math.hypot(A, B);
  const hue = chroma < 1e-6 ? NaN : ((((Math.atan2(B, A) * 180) / Math.PI) % 360) + 360) % 360;
  return { c: [L, chroma, hue], a };
}

/** Ready a pair of stops to mix, as CSS readies each pair on its own:
 * a missing component takes the other stop's, and `to`'s hue turns
 * the named way round from `from`'s. Both are changed in place. */
export function alignPair(from: Prepared, to: Prepared, space: ColorSpace, mode: HueMode): void {
  for (let i = 0; i < 3; i++) {
    if (Number.isNaN(from.c[i]!)) from.c[i] = Number.isNaN(to.c[i]!) ? 0 : to.c[i]!;
    if (Number.isNaN(to.c[i]!)) to.c[i] = from.c[i]!;
  }
  const i = hueIndex(space);
  if (i < 0) return;
  const turn = (hue: number): number => ((hue % 360) + 360) % 360;
  let delta = turn(to.c[i]!) - turn(from.c[i]!);
  if (mode === "shorter") {
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
  } else if (mode === "longer") {
    if (delta > 0 && delta < 180) delta -= 360;
    else if (delta > -180 && delta <= 0) delta += 360;
  } else if (mode === "increasing") {
    if (delta < 0) delta += 360;
  } else if (delta > 0) delta -= 360;
  to.c[i] = from.c[i]! + delta;
}

/** Mix two prepared colors at `t` (0 → `from`, 1 → `to`), alpha
 * premultiplied as CSS interpolates, a hue turned as the stops were
 * aligned. */
export function mixColors(from: Prepared, to: Prepared, t: number, space: ColorSpace): Rgba {
  const a = from.a + (to.a - from.a) * t;
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const hue = hueIndex(space);
  // A component still missing (a lone stop, never paired) reads 0.
  const at = (p: Prepared, i: number): number => p.c[i]! || 0;
  const lerp = (i: number): number =>
    i === hue
      ? at(from, i) + (at(to, i) - at(from, i)) * t
      : (at(from, i) * from.a * (1 - t) + at(to, i) * to.a * t) / a;
  const [x, y, z] = [lerp(0), lerp(1), lerp(2)];
  switch (space) {
    case "srgb":
      return { r: x, g: y, b: z, a };
    case "srgb-linear":
      return {
        r: clamp01(linearToSrgb(x)),
        g: clamp01(linearToSrgb(y)),
        b: clamp01(linearToSrgb(z)),
        a,
      };
    case "hsl":
      return fromHsl(x, y, z, a);
    case "oklab":
      return fromOklab(x, y, z, a);
    default: {
      const rad = (z * Math.PI) / 180;
      return fromOklab(x, y * Math.cos(rad), y * Math.sin(rad), a);
    }
  }
}

/** `over` composited onto `under` (source-over). */
export function compositeColors(over: Rgba, under: Rgba): Rgba {
  const a = over.a + under.a * (1 - over.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (x: number, y: number): number => (x * over.a + y * under.a * (1 - over.a)) / a;
  return {
    r: channel(over.r, under.r),
    g: channel(over.g, under.g),
    b: channel(over.b, under.b),
    a,
  };
}

/** A color as `rgb()`, the alpha written only when it is not 1. */
export function serializeColor({ r, g, b, a }: Rgba): string {
  const channel = (c: number): number => Math.round(clamp01(c) * 255);
  const rgb = `${channel(r)} ${channel(g)} ${channel(b)}`;
  return a >= 1 ? `rgb(${rgb})` : `rgb(${rgb} / ${Math.round(a * 1000) / 1000})`;
}

/** A computed color's alpha: its parsed one; for a form the parser
 * leaves alone, its `/ a` when written, else 1. */
export function colorAlpha(color: string): number {
  const parsed = parseColor(color);
  if (parsed) return parsed.a;
  const slash = /\/\s*([\d.]+%?)\s*\)$/.exec(color.trim());
  const alpha = slash ? component(slash[1]!) : 1;
  return Number.isFinite(alpha) ? clamp01(alpha) : 1;
}
