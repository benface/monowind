import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CONTROL_STATE, OWN_TRANSITION_VARS } from "../src/animate.ts";
import { EFFECTS, PAINT_ONLY } from "../src/animation.ts";
import { CONTROL_READ_FLAG } from "../src/types.ts";
import { OWN_HIGHLIGHT } from "../src/element.ts";

/** The companion's layering (styles.css, the header): every
 * `!important` declaration is a lock in `@layer theme`, but the
 * grid-mode pointer-events rules, which an author's important utility
 * must still beat (specs/cell-model.md "Pointer states"); a plain
 * declaration in the layer would lose to a utility, so the layer holds
 * none but the engine variables' resets. */

interface Declaration {
  selector: string;
  property: string;
  value: string;
  important: boolean;
  layer: string | undefined;
}

/** The stylesheet's declarations, each with its rule's selector and its
 * innermost layer. */
function declarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const layers: (string | undefined)[] = [];
  let preludeStart = 0;
  let bodyStart = -1;
  let selector = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      selector = css.slice(preludeStart, i).trim();
      layers.push(/^@layer\s+([\w-]+)$/.exec(selector)?.[1]);
      preludeStart = bodyStart = i + 1;
    } else if (char === "}") {
      if (bodyStart !== -1) {
        const layer = layers.filter((name) => name !== undefined).pop();
        // A `;` inside a string (a data URL's) ends no declaration.
        for (const declaration of css.slice(bodyStart, i).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
          const colon = declaration.indexOf(":");
          if (colon === -1) continue;
          const value = declaration.slice(colon + 1);
          out.push({
            selector,
            property: declaration.slice(0, colon).trim(),
            value,
            important: value.includes("!important"),
            layer,
          });
        }
      }
      layers.pop();
      bodyStart = -1;
      preludeStart = i + 1;
    } else if (char === ";" && bodyStart === -1) preludeStart = i + 1;
  }
  return out;
}

const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8").replaceAll(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const all = declarations(css);
const render = readFileSync(join(import.meta.dirname, "../src/render.ts"), "utf8");

it("styles.css orders the theme layer first", () => {
  expect(css).toMatch(/^@layer theme, base;$/m);
});

it("styles.css keeps every lock in the theme layer", () => {
  const outside = all.filter((d) => d.important && d.layer !== "theme");
  expect(new Set(outside.map((d) => d.property))).toEqual(new Set(["pointer-events"]));
});

/** A selector with its parentheses' contents dropped. */
const outer = (selector: string): string => {
  let previous;
  do [previous, selector] = [selector, selector.replace(/\([^()]*\)/g, "")];
  while (selector !== previous);
  return selector;
};

/** The twins' host conditions and their subjects' exclusions (styles.css,
 * the header): a box's own lock reaches a native region, one on what a
 * box holds skips it too, and neither reaches its contents. Outside the
 * lock layer, the conditions keep the plain selector's specificity. */
const NO_REGION = "[data-mw-no-regions]";
const REGIONS = "[data-mw-regions]";
const SKIPS = {
  contents: ":where(:not([data-mw-native] *))",
  region: ":where(:not([data-mw-native], [data-mw-native] *))",
};

/** A selector's subject, its `:not()`s dropped. */
const subjectOf = (part: string): string => {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < part.length; i++) {
    if (part[i] === "(") depth++;
    else if (part[i] === ")") depth--;
    else if (depth === 0 && /[\s>+~]/.test(part[i]!)) start = i + 1;
  }
  let subject = part.slice(start);
  let previous;
  do [previous, subject] = [subject, subject.replace(/:not\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "")];
  while (subject !== previous);
  return subject;
};

/** The region's own rules: its reset, and a grid drag's sweep through
 * it, the one to reach its contents. */
const isRegions = (part: string): boolean =>
  /^mono-wind(?:\[[^\]]*\])* (?:\[data-mw-native\](?::where\(.+\))?(?:::selection)?|\[data-mw-native-drag\](?: \*)?)$/.test(
    part,
  );
const isReset = (selector: string): boolean =>
  selectorList(selector)
    .map(spelled)
    .every((part) => isRegions(part) && !part.includes("[data-mw-native-drag]"));

/** A selector part in one spelling, whatever the formatter's. */
const spelled = (part: string): string =>
  part.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");

/** What the grid draws for a region's own box, whose lock reaches the
 * region and skips its contents alone (specs/native-regions.md "The
 * locks"): a box's fill, border, shadow and outline, its marker and
 * backdrop — but a control's own look, which a region that is one keeps. */
const BOX_PAINT = new Set([
  "background-color",
  "background-image",
  "box-shadow",
  "border-width",
  "outline",
]);
const drawsBox = (part: string, properties: string[]): boolean => {
  if (/::(marker|backdrop)$/.test(part)) return true;
  if (part.includes("::")) return false;
  const control = /^(button|input|textarea|select)\b/.test(subjectOf(part));
  return !control && properties.some((property) => BOX_PAINT.has(property));
};

/** Each rule's selector, its layer and its properties. */
const rules = new Map<string, { layer: string | undefined; properties: string[] }>();
for (const d of all) {
  const rule = rules.get(d.selector) ?? { layer: d.layer, properties: [] };
  rule.properties.push(d.property);
  rules.set(d.selector, rule);
}

it("styles.css keeps every rule from a native region's contents", () => {
  for (const [selector, { layer, properties }] of rules) {
    if (selector.startsWith("@property")) continue;
    const parts = selectorList(selector).map(spelled);
    for (const part of parts) {
      // The host's own, or the region's.
      if (/^mono-wind\S*$/.test(outer(part)) || isRegions(part)) continue;
      const mark = [NO_REGION, REGIONS].find((each) => part.includes(each));
      if (!mark) {
        // Keyed on an engine flag no region's contents carry.
        expect(subjectOf(part), part).toMatch(/\[data-mw-[\w-]+/);
        continue;
      }
      expect(part.includes(`:where(${mark})`), part).toBe(layer !== "theme");
      // Its twin in the same rule, the region's half skipping, at its
      // subject, the contents — and the region, unless the lock is on
      // what the grid draws for the region's box.
      const skip = drawsBox(part, properties) ? SKIPS.contents : SKIPS.region;
      const twinOf = (first: string): string =>
        first.replace(NO_REGION, REGIONS).replace(/(::[\w-]+)?$/, (pseudo) => skip + pseudo);
      const pair =
        mark === NO_REGION
          ? parts.includes(twinOf(part))
          : parts.some((other) => other.includes(NO_REGION) && twinOf(other) === part);
      expect(pair, part).toBe(true);
    }
  }
});

/** The flags whose locks reach a region harmlessly: those a region never
 * carries, keeping its own overflow, columns and white-space, and an
 * interactive's, setting the pointer the region's own rules set. */
const REGION_SAFE = /^\[data-mw-(scroll|multicol|multicol-flow|interactive|nowrap|pre)\]/;

it("styles.css keeps every lock from setting what a native region's contents inherit", () => {
  for (const [selector, { properties }] of rules) {
    const inherited = properties.filter(
      (property) => INHERITED.has(property) && !KEPT.has(property),
    );
    if (inherited.length === 0) continue;
    for (const part of selectorList(selector).map(spelled)) {
      if (part.includes("::") || part.includes(NO_REGION) || isRegions(part)) continue;
      if (/^mono-wind\S*$/.test(outer(part)) || REGION_SAFE.test(subjectOf(part))) continue;
      // A twin's region half, or a lock keyed on a flag the region carries.
      expect(part, inherited.join()).toMatch(
        part.includes(REGIONS) ? SKIPS.region : /:not\([^)]*\[data-mw-native\][,)]/,
      );
    }
  }
});

it("styles.css keeps each subject out of `:is()`, which Chromium tries on every element", () => {
  // A selector list instead: each part bucketed by its tag or attribute,
  // tried on those elements alone (architecture/performance.md).
  for (const selector of rules.keys()) {
    for (const part of selectorList(selector).map(spelled)) {
      // A `:where()` of `:not()`s alone keys on nothing anyway.
      expect(subjectOf(part), part).not.toMatch(/^\*?(:is\(|:where\((?!:not\()[^()]*,)/);
    }
  }
});

it("styles.css restyles no host's whole subtree as a grid drag starts or ends", () => {
  // A subject keyed on no tag, attribute, class or id: the style engines
  // restyle every element under the host as its flag flips
  // (architecture/performance.md).
  // Style engines key invalidation by the attribute, whatever element
  // carries it: any compound before the subject counts.
  for (const selector of rules.keys()) {
    for (const part of selectorList(selector).map(spelled)) {
      const ancestors = part.slice(0, part.length - subjectOf(part).length);
      if (ancestors.includes("[data-mw-dragging]")) {
        expect(subjectOf(part), part).toMatch(/^[\w[.#]/);
      }
    }
  }
});

/** CSS's inherited properties ("Inherited: yes"), with `user-select`,
 * whose `auto` takes a parent's `none`. */
const INHERITED = new Set(
  (
    "accent-color border-collapse border-spacing caption-side caret-color color color-scheme " +
    "cursor direction empty-cells font font-family font-feature-settings font-kerning " +
    "font-optical-sizing font-palette font-size font-size-adjust font-stretch font-style " +
    "font-synthesis font-variant font-variation-settings font-weight hyphenate-character hyphens " +
    "image-rendering letter-spacing line-break line-height list-style list-style-image " +
    "list-style-position list-style-type orphans overflow-wrap paint-order pointer-events " +
    "print-color-adjust quotes scrollbar-color tab-size text-align text-align-last " +
    "text-decoration-skip-ink text-emphasis text-indent text-justify text-orientation " +
    "text-rendering text-shadow text-transform text-underline-offset text-underline-position " +
    "text-wrap text-wrap-mode text-wrap-style visibility white-space white-space-collapse widows " +
    "word-break word-spacing writing-mode -webkit-text-fill-color -webkit-text-stroke " +
    "user-select -webkit-user-select"
  ).split(" "),
);

/** What a region's contents take from the host, as decided: its font
 * and color; and a box's visibility, the engine's to read
 * (specs/visibility.md). */
const KEPT = new Set(["font", "font-family", "font-size", "color", "caret-color", "visibility"]);

/** The locks whose value is CSS's initial one, which a region keeps. */
const INITIAL: Record<string, string> = {
  "text-shadow": "none",
  "list-style-position": "outside",
  "list-style-image": "none",
};

it("styles.css takes each inherited lock back on a native region (specs/native-regions.md)", () => {
  const reset = new Set(
    all.flatMap((d) => (isReset(d.selector) && !d.selector.includes("::") ? d.property : [])),
  );
  for (const d of all) {
    const own = selectorList(d.selector).map(spelled).every(isRegions);
    if (own || d.selector.includes("::") || !INHERITED.has(d.property)) continue;
    const value = d.value.replace("!important", "").trim();
    if (KEPT.has(d.property) || value === "inherit" || INITIAL[d.property] === value) continue;
    expect(reset.has(d.property), `${d.property} (${d.selector})`).toBe(true);
  }
  // Chromium and WebKit hand a parent's highlight down.
  const highlight = all.filter((d) => d.selector.endsWith("[data-mw-native]::selection"));
  expect(highlight.map((d) => d.value.trim())).toEqual(["HighlightText", "Highlight"]);
});

/** The flags of a box a mixed container's flow places (render.ts). */
const FLOW = [
  "data-mw-flow",
  "data-mw-float",
  "data-mw-multicol-flow",
  "data-mw-multicol-flow-span",
  "data-mw-inline-box",
];

/** Every variable render.ts writes, by what makes a rule's read of it
 * the element's own (specs/cell-model.md "Engine variables"). */
const VARIABLES = {
  /** Reset plainly on every element: a rule reads it where the engine
   * wrote none. */
  reset: [
    "--mw-z",
    "--mw-it",
    "--mw-ir",
    "--mw-ib",
    "--mw-il",
    "--mw-ipl",
    "--mw-ipr",
    "--mw-sx",
    "--mw-sy",
    "--mw-vb",
  ],
  /** Written on every box (the host's leaf among them), and read under
   * an engine flag alone. */
  box: [
    "--mw-x",
    "--mw-y",
    "--mw-w",
    "--mw-h",
    "--mw-lh",
    "--mw-lhs",
    "--mw-ti",
    "--mw-pt",
    "--mw-pr",
    "--mw-pb",
    "--mw-pl",
    "--mw-bt",
    "--mw-br",
    "--mw-bb",
    "--mw-bl",
  ],
  /** Written with a flag, which every rule reading it keys on. */
  flagged: {
    "--mw-mt": FLOW,
    "--mw-mr": FLOW,
    "--mw-mb": FLOW,
    "--mw-ml": FLOW,
    "--mw-va": ["data-mw-vmiddle"],
    "--mw-colc": ["data-mw-multicol"],
    "--mw-colg": ["data-mw-multicol"],
    "--mw-se-x": ["data-mw-scroll"],
    "--mw-se-y": ["data-mw-scroll"],
    "--mw-gr": ["data-mw-scroll"],
    "--mw-gb": ["data-mw-scroll"],
    "--mw-spt": ["data-mw-scroll"],
    "--mw-spr": ["data-mw-scroll"],
    "--mw-spb": ["data-mw-scroll"],
    "--mw-spl": ["data-mw-scroll"],
    "--mw-ws": ["data-mw-pre"],
    "--mw-tc": ["data-mw-measuring"],
  } as Record<string, string[]>,
  /** The parent's by design: an inline element takes its block's. */
  inherited: ["--mw-ls", "--mw-ink", "--mw-ground"],
};

/** The rules reading a variable. */
const readers = (variable: string): Declaration[] =>
  all.filter((d) => d.value.includes(`var(${variable})`) || d.value.includes(`var(${variable},`));

it("sorts every variable render.ts writes into one class", () => {
  const written = new Set([...render.matchAll(/"(--mw-[\w-]+)"/g)].map((match) => match[1]!));
  const classes = [
    VARIABLES.reset,
    VARIABLES.box,
    Object.keys(VARIABLES.flagged),
    VARIABLES.inherited,
  ];
  for (const variable of written) {
    expect(
      classes.filter((names) => names.includes(variable)),
      variable,
    ).toHaveLength(1);
  }
  expect(new Set(classes.flat())).toEqual(written);
});

it("styles.css keeps the theme layer to locks and the engine variables' resets", () => {
  const plain = all.filter((d) => d.layer === "theme" && !d.important);
  expect(new Set(plain.map((d) => d.property))).toEqual(new Set(VARIABLES.reset));
});

it("styles.css reads on a pseudo-element the variables render.ts writes for its kind", () => {
  const [flow, box] = [...render.matchAll(/vars\("([\w ]+)"\)/g)].map((match) =>
    match[1]!.split(" "),
  );
  // An inline one writes a flow's first five.
  const text = flow!.slice(0, 5);
  for (const pseudo of ["before", "after"]) {
    const read = (flag: string) =>
      all.flatMap((d) =>
        d.selector.includes(flag)
          ? [...d.value.matchAll(new RegExp(`var\\(--mw-${pseudo}-([\\w-]+)`, "g"))].map(
              (match) => match[1],
            )
          : [],
      );
    expect(new Set(read(`[data-mw-${pseudo}]`)), pseudo).toEqual(new Set(text));
    // A flow reads an inline one's too.
    const flowReads = [...read(`[data-mw-${pseudo}]`), ...read(`[data-mw-${pseudo}="flow"]`)];
    expect(new Set(flowReads), pseudo).toEqual(new Set(flow));
    expect(new Set(read(`[data-mw-${pseudo}="box"]`)), pseudo).toEqual(new Set(box));
  }
});

it("styles.css reads each reset variable, plainly", () => {
  for (const variable of VARIABLES.reset) {
    const reads = readers(variable);
    expect(reads.length, variable).toBeGreaterThan(0);
    // The reset stands for the engine's missing write: no fallback.
    for (const read of reads) expect(read.value, variable).not.toContain(`var(${variable},`);
  }
});

/** Whether every part of a selector list matches `flag`. */
const keysOn = (selector: string, flag: RegExp): boolean =>
  selectorList(selector).every((part) => flag.test(part));

it("styles.css reads a box's variable under an engine flag, a flag's under that flag", () => {
  const engineFlag = /\[data-mw-(?!measuring|settling)[\w-]+/;
  for (const variable of VARIABLES.box) {
    for (const read of readers(variable))
      expect(keysOn(read.selector, engineFlag), variable).toBe(true);
  }
  for (const [variable, flags] of Object.entries(VARIABLES.flagged)) {
    const flag = new RegExp(`\\[(?:${flags.join("|")})[\\]=]`);
    const reads = readers(variable);
    expect(reads.length, variable).toBeGreaterThan(0);
    for (const read of reads) expect(keysOn(read.selector, flag), variable).toBe(true);
  }
});

/** A selector list split at its top-level commas. */
const selectorList = (list: string): string[] => {
  const parts = [""];
  let depth = 0;
  for (const char of list) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim());
};

it("styles.css masks the transitions a frame samples, and those alone", () => {
  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const sampled = new Set([...EFFECTS, ...PAINT_ONLY].map(kebab));
  // A checkbox's or a radio's lock merges its own lists, tested below.
  const masks = all.filter(
    (d) =>
      d.property === "transition-property" &&
      d.important &&
      !d.selector.includes('[type="checkbox"]'),
  );
  expect(masks).toHaveLength(2);
  for (const mask of masks) {
    const kept = new Set(selectorList(mask.value.replace("!important", "")));
    // The shorthand keeps the longhands a transition names.
    if (kept.has("border-color")) {
      for (const side of ["top", "right", "bottom", "left"]) kept.add(`border-${side}-color`);
    }
    // A popover's or a dialog's exit rides display and overlay (specs/top-layer.md).
    if (mask.selector.includes("popover"))
      for (const each of ["display", "overlay"]) kept.delete(each);
    expect(kept, mask.selector).toEqual(sampled);
  }
});

it("styles.css exempts from the selection lock the elements element.ts does", () => {
  const lock = all.find(
    (d) => d.selector.includes("[data-mw-selection]") && d.property === "background",
  )!;
  // The lock's own exemptions, past its twins' host conditions.
  const opening = ":where(:not(";
  const start = lock.selector.indexOf(`${opening}input`) + opening.length;
  let end = start;
  for (let depth = 1; depth > 0; end++) {
    if (lock.selector[end] === "(") depth++;
    else if (lock.selector[end] === ")") depth--;
  }
  // Alike but for their quotes, the formatter's in CSS.
  const exempt = (list: string) => new Set(selectorList(list.replaceAll("'", '"')));
  expect(exempt(lock.selector.slice(start, end - 1))).toEqual(exempt(OWN_HIGHLIGHT));
});

it("styles.css merges a checkbox's and a radio's own transitions through the engine's names (specs/checkboxes.md)", () => {
  const toggle = (d: Declaration) =>
    d.selector.includes('[type="checkbox"]') && d.selector.includes('[type="radio"]');
  const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  /** The state's own entry, last in each list. */
  const state = {
    transitionProperty: CONTROL_STATE,
    transitionDuration: "1ms",
    transitionTimingFunction: "linear",
    transitionDelay: "0s",
    transitionBehavior: "normal",
  };
  const locks = all.filter((d) => toggle(d) && d.property.startsWith("transition-"));
  expect(new Set(locks.map((d) => d.property))).toEqual(
    new Set(Object.keys(OWN_TRANSITION_VARS).map(kebab)),
  );
  for (const [longhand, variable] of Object.entries(OWN_TRANSITION_VARS)) {
    const [lock] = locks.filter((d) => d.property === kebab(longhand));
    expect(lock!.value, longhand).toMatch(
      new RegExp(
        `^\\s*var\\(${variable}, [^)]+\\), ${state[longhand as keyof typeof state]} !important$`,
      ),
    );
    for (const flag of [CONTROL_READ_FLAG, "data-mw-measuring", "data-mw-settling"]) {
      expect(lock!.selector, longhand).toContain(`[${flag}]`);
    }
    expect(readers(variable).every(toggle), variable).toBe(true);
  }
  expect(css).toContain(`@property ${CONTROL_STATE} {`);
  const values = all.filter((d) => d.property === CONTROL_STATE && toggle(d));
  expect(
    values.map((d) => [d.selector.match(/:(checked|indeterminate)/)?.[1], d.value.trim()]),
  ).toEqual([
    ["checked", "1"],
    ["indeterminate", "2"],
  ]);
});

it("styles.css hides a checkbox's and a radio's widget but under the engine's read of their appearance (specs/checkboxes.md)", () => {
  const locks = all.filter(
    (d) => d.property === "appearance" && d.important && d.selector.includes('[type="checkbox"]'),
  );
  expect(
    locks.map((d) => [
      d.value.replace("!important", "").trim(),
      d.selector.includes(`:not([${CONTROL_READ_FLAG}])`),
    ]),
  ).toEqual([["none", true]]);
});
