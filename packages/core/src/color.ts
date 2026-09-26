/**
 * Computed colors as numbers: the forms engines serialize read to
 * extended sRGB, mixed as CSS interpolates gradients (specs/gradients.md),
 * and composited as specs/cell-model.md "Opacity and translucency" does.
 */

/** Gamma-encoded sRGB components, past 0..1 outside sRGB, and alpha. */
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

/** sRGB's transfer functions, extended to any component by its sign. */
const srgbToLinear = (c: number): number =>
  Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number): number =>
  Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);

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

const fromLinear = (r: number, g: number, b: number, a: number): Rgba => ({
  r: linearToSrgb(r),
  g: linearToSrgb(g),
  b: linearToSrgb(b),
  a,
});

const fromOklab = (L: number, a: number, b: number, alpha: number): Rgba =>
  fromLinear(...oklabToLinear(L, a, b), alpha);

type Matrix = readonly [readonly number[], readonly number[], readonly number[]];

const transform = (m: Matrix, x: number, y: number, z: number): [number, number, number] =>
  m.map((row) => row[0]! * x + row[1]! * y + row[2]! * z) as [number, number, number];

// css-color-4's conversions (its sample code).
const XYZ_TO_LINEAR_SRGB: Matrix = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
/** Bradford's adaptation of XYZ from the D50 white to D65. */
const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LINEAR_P3_TO_XYZ: Matrix = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const LINEAR_A98_TO_XYZ: Matrix = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];
/** To XYZ, its white D50's. */
const LINEAR_PROPHOTO_TO_XYZ: Matrix = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LINEAR_REC2020_TO_XYZ: Matrix = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
];
const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;

const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585] as const;

type FromSpace = (x: number, y: number, z: number, alpha: number) => Rgba;

/** From XYZ, its white D65's. */
const fromXyz: FromSpace = (x, y, z, alpha) =>
  fromLinear(...transform(XYZ_TO_LINEAR_SRGB, x, y, z), alpha);

const fromXyzD50: FromSpace = (x, y, z, alpha) => fromXyz(...transform(D50_TO_D65, x, y, z), alpha);

/** An RGB space through XYZ: its transfer to linear light, then its matrix. */
const throughXyz =
  (toLinear: (c: number) => number, matrix: Matrix, from: FromSpace): FromSpace =>
  (r, g, b, alpha) =>
    from(...transform(matrix, toLinear(r), toLinear(g), toLinear(b)), alpha);

/** Each space `color()` names. */
const COLOR_SPACES = new Map<string, FromSpace>([
  ["srgb", (r, g, b, a) => ({ r, g, b, a })],
  ["srgb-linear", fromLinear],
  ["xyz", fromXyz],
  ["xyz-d65", fromXyz],
  ["xyz-d50", fromXyzD50],
  ["display-p3", throughXyz(srgbToLinear, LINEAR_P3_TO_XYZ, fromXyz)],
  [
    "a98-rgb",
    throughXyz((c) => Math.sign(c) * Math.abs(c) ** (563 / 256), LINEAR_A98_TO_XYZ, fromXyz),
  ],
  [
    "prophoto-rgb",
    throughXyz(
      (c) => (Math.abs(c) <= 16 / 512 ? c / 16 : Math.sign(c) * Math.abs(c) ** 1.8),
      LINEAR_PROPHOTO_TO_XYZ,
      fromXyzD50,
    ),
  ],
  [
    "rec2020",
    throughXyz(
      (c) =>
        Math.abs(c) < REC2020_BETA * 4.5
          ? c / 4.5
          : Math.sign(c) * ((Math.abs(c) + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45),
      LINEAR_REC2020_TO_XYZ,
      fromXyz,
    ),
  ],
]);

/** From CIE Lab, its white D50's. */
function fromLab(L: number, a: number, b: number, alpha: number): Rgba {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (L + 16) / 116;
  const cubeOrLinear = (f: number): number => (f ** 3 > epsilon ? f ** 3 : (116 * f - 16) / kappa);
  const x = cubeOrLinear(fy + a / 500) * D50_WHITE[0];
  const y = L > kappa * epsilon ? fy ** 3 : L / kappa;
  return fromXyzD50(x, y, cubeOrLinear(fy - b / 200) * D50_WHITE[2], alpha);
}

/** Parse a computed color; null for a form engines serialize as
 * another (a `var()`, a name, `hsl()`). */
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
      // CSS clamps rgb()'s channels as it parses them.
      return r === undefined || [r, g, b].some((c) => !Number.isFinite(c))
        ? null
        : { r: clamp01(r), g: clamp01(g!), b: clamp01(b!), a: alpha };
    }
    case "oklab":
    case "oklch":
    case "lab":
    case "lch": {
      // A percentage's scale: lightness, then chroma or a, then b.
      const ok = fn.startsWith("ok");
      const polar = fn.endsWith("ch");
      const [L, second, third] = [
        component(tokens[0] ?? "", ok ? 1 : 100),
        component(tokens[1] ?? "", ok ? 0.4 : polar ? 150 : 125),
        component(tokens[2] ?? "", ok ? 0.4 : 125),
      ];
      if ([L, second, third].some((c) => !Number.isFinite(c))) return null;
      const rad = (third * Math.PI) / 180;
      const a = polar ? second * Math.cos(rad) : second;
      const b = polar ? second * Math.sin(rad) : third;
      return ok ? fromOklab(L, a, b, alpha) : fromLab(L, a, b, alpha);
    }
    case "color": {
      const [space = "", ...rest] = tokens;
      const [r, g, b] = rest.map((t) => component(t));
      const from = COLOR_SPACES.get(space);
      if (!from || r === undefined || [r, g, b].some((c) => !Number.isFinite(c))) return null;
      return from(r, g!, b!, alpha);
    }
    default:
      return null;
  }
}

/** Whether a color is written in a legacy syntax: CSS interpolates
 * legacy colors alone in srgb, anything else in oklab. */
export const isLegacyColor = (value: string): boolean =>
  /^(?:rgba?|hsla?)\(|^transparent$|^#|^[a-z]+$/i.test(value.trim());

/** A color in its interpolation space: three coordinates and alpha;
 * NaN where CSS calls a component missing — a polar hue without
 * chroma, hsl's saturation at black or white. */
export interface Prepared {
  c: [number, number, number];
  a: number;
}

/** HSL from sRGB; a color outside sRGB can take a saturation below 0,
 * kept as Chromium and Firefox keep it (specs/gradients.md, deviation 6). */
const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [NaN, l <= 1e-9 || l >= 1 - 1e-9 ? NaN : 0, l];
  const span = 1 - Math.abs(2 * l - 1);
  const s = span === 0 ? 0 : d / span;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(((h * 60) % 360) + 360) % 360, s, l];
};

const fromHsl = (h: number, s: number, l: number, a: number): Rgba => {
  const hue = (((Number.isNaN(h) ? 0 : h) % 360) + 360) % 360;
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), a };
};

/** A color ready to mix in a space, once per gradient stop. */
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

/** Ready a pair of stops to mix in place, as CSS readies each pair: a
 * missing component takes the other's, `to`'s hue turned the named way. */
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
 * premultiplied as CSS interpolates. */
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
      return fromLinear(x, y, z, a);
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

/** `over` composited onto `under` (source-over), each clipped to sRGB
 * first, as browsers blend on an sRGB screen; a zero-alpha `over` is no
 * paint. */
export function compositeColors(over: Rgba, under: Rgba): Rgba {
  if (over.a === 0) return under;
  if (over.a >= 1 || under.a === 0) return over;
  const a = over.a + under.a * (1 - over.a);
  const channel = (x: number, y: number): number =>
    (clamp01(x) * over.a + clamp01(y) * under.a * (1 - over.a)) / a;
  return {
    r: channel(over.r, under.r),
    g: channel(over.g, under.g),
    b: channel(over.b, under.b),
    a,
  };
}

/** A color as `rgb()` where its channels round into sRGB, else as
 * `color(srgb …)`, the alpha written only when it is not 1. */
export function serializeColor({ r, g, b, a }: Rgba): string {
  const alpha = a >= 1 ? "" : ` / ${Math.round(a * 1000) / 1000}`;
  const channels = [r, g, b].map((c) => Math.round(c * 255));
  if (channels.every((c) => c >= 0 && c <= 255)) return `rgb(${channels.join(" ")}${alpha})`;
  return `color(srgb ${[r, g, b].map((c) => Math.round(c * 1e5) / 1e5).join(" ")}${alpha})`;
}

/** A computed color's alpha, 1 for a form the parser cannot read. */
export const colorAlpha = (color: string): number => parseColor(color)?.a ?? 1;

/** A value's parts between top-level commas or white space, blank
 * parts dropped. */
export function splitTopLevel(value: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    const char = value[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (
      char === undefined ||
      (depth === 0 && (separator === "," ? char === "," : /\s/.test(char)))
    ) {
      const part = value.slice(start, i);
      if (part.trim() !== "") parts.push(part);
      start = i + 1;
    }
  }
  return parts;
}
