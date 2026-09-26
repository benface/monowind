import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EFFECTS, PAINT_ONLY } from "../src/animation.ts";
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
        for (const declaration of css.slice(bodyStart, i).split(";")) {
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

/** The flags of a box a mixed container's flow places (render.ts). */
const FLOW = [
  "data-mw-flow",
  "data-mw-float",
  "data-mw-multicol-flow",
  "data-mw-multicol-flow-span",
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
  selector.split(",").every((part) => flag.test(part));

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
  const masks = all.filter((d) => d.property === "transition-property" && d.important);
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
  const opening = ":where(:not(";
  const start = lock.selector.indexOf(opening) + opening.length;
  let end = start;
  for (let depth = 1; depth > 0; end++) {
    if (lock.selector[end] === "(") depth++;
    else if (lock.selector[end] === ")") depth--;
  }
  // Alike but for their quotes, the formatter's in CSS.
  const exempt = (list: string) => new Set(selectorList(list.replaceAll("'", '"')));
  expect(exempt(lock.selector.slice(start, end - 1))).toEqual(exempt(OWN_HIGHLIGHT));
});
