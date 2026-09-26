import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  hasSynthesizedTransitions,
  resolvePendingTransitions,
  trackBackground,
} from "../src/animate.ts";
import {
  animatedProperties,
  animatesEffect,
  animationPath,
  nodeIndex,
  readingAnimations,
  runningUnder,
  transitionSampling,
} from "../src/animation.ts";
import { mixColors, parseColor, prepareColor } from "../src/color.ts";
import type { Rgba } from "../src/color.ts";
import { layoutRoot } from "../src/layout.ts";
import { readCellStyle, readPaintStyle } from "../src/style.ts";
import { layered, makeNode } from "./helpers.ts";

/** Animations (specs/animations.md): what runs under a host, from one
 * query, the path a frame takes for it, and the read that keeps an
 * animating effect a layer root. */

/** A CSS animation of `keyframes` on `target`, as the platform lists
 * one: happy-dom runs no CSS animations. */
const keyframed = (
  target: Element,
  keyframes: Record<string, string>[],
  playState: AnimationPlayState = "running",
  pseudoElement: string | null = null,
): Animation =>
  ({
    animationName: "spin",
    playState,
    effect: {
      target,
      pseudoElement,
      getKeyframes: () => keyframes.map((frame) => ({ offset: 0, easing: "linear", ...frame })),
    },
  }) as unknown as Animation;

/** A CSS transition of `transitionProperty` on `target`. */
const transitioned = (
  target: Element,
  transitionProperty: string,
  pseudoElement: string | null = null,
  playState: AnimationPlayState = "running",
): Animation =>
  ({ transitionProperty, playState, effect: { target, pseudoElement } }) as unknown as Animation;

/** A host with three light elements. */
const hostOf = (): { host: HTMLElement; a: HTMLElement; b: HTMLElement; c: HTMLElement } => {
  const host = document.createElement("div");
  const [a, b, c] = [
    document.createElement("p"),
    document.createElement("p"),
    document.createElement("p"),
  ];
  host.append(a, b, c);
  document.body.append(host);
  return { host, a, b, c };
};

afterEach(() => readingAnimations(null));

describe("what runs under a host", () => {
  it("is every light element's animated properties, from one query", () => {
    const { host, a, b, c } = hostOf();
    let calls = 0;
    host.getAnimations = (options) => (
      calls++,
      options?.subtree
        ? [
            keyframed(a, [{ transform: "none" }, { transform: "rotate(1turn)" }]),
            keyframed(a, [{ opacity: "1" }, { opacity: "0.5" }, { opacity: "1" }]),
            transitioned(b, "opacity"),
            transitioned(b, "border-top-color"),
            transitioned(b, "scale"),
            transitioned(b, "background-color"),
            transitioned(c, "border-left-color", null, "finished"),
            keyframed(c, [{ opacity: "0" }], "paused"),
          ]
        : []
    );
    const { elements, relayout } = runningUnder(host);
    expect(calls).toBe(1);
    expect([...elements.keys()]).toEqual([a, b]);
    expect([...elements.get(a)!].sort()).toEqual(["opacity", "transform"]);
    expect([...elements.get(b)!].sort()).toEqual(["borderTopColor", "opacity", "scale"]);
    expect(relayout).toBe(false);
  });

  it("relays out for a color's transition, the host's own among them, and a pseudo-element's paint-only one", () => {
    const { host, a } = hostOf();
    const relays = (animation: Animation) => runningUnder(host, [animation]).relayout;
    expect(relays(transitioned(a, "color"))).toBe(true);
    expect(relays(transitioned(host, "color"))).toBe(true);
    expect(relays(transitioned(a, "opacity", "::before"))).toBe(true);
    expect(relays(transitioned(a, "border-top-color", "::backdrop"))).toBe(true);
    expect(relays(transitioned(a, "scale", "::before"))).toBe(false);
    expect(runningUnder(host, [transitioned(a, "color")]).elements.size).toBe(0);
  });

  it("leaves the host's own animations and other transitions to the browser, and a pseudo-element's keyframes", () => {
    const { host, a } = hostOf();
    const own = ["opacity", "border-top-color", "scale", "transform", "filter", "background-color"];
    expect(
      runningUnder(host, [
        ...own.map((property) => transitioned(host, property)),
        keyframed(host, [{ opacity: "0" }, { transform: "scale(2)" }]),
        keyframed(a, [{ opacity: "0" }], "running", "::before"),
      ]),
    ).toEqual({ elements: new Map(), relayout: false });
    expect(own.map((property) => transitionSampling(property, host, false, host))).toEqual(
      own.map(() => null),
    );
  });
});

describe("animation path", () => {
  const leaf = makeNode({ text: "x", intrinsicWidth: 1 });
  const parent = makeNode({ children: [leaf] });
  const runs = makeNode({ text: "x", intrinsicWidth: 1 });
  runs.inlineElements = [];

  it("places the box for effects alone", () => {
    expect(animationPath(new Set(["transform"]), leaf)).toBe("box");
    expect(animationPath(new Set(["rotate", "filter"]), null)).toBe("box");
  });

  it("places the box for a layer root's opacity, the box's own", () => {
    const root = makeNode({ text: "x", intrinsicWidth: 1 });
    root.style.layer = layered();
    expect(animationPath(new Set(["opacity"]), root)).toBe("box");
    expect(animationPath(new Set(["opacity", "scale"]), root)).toBe("box");
    expect(animationPath(new Set(["opacity", "color"]), root)).toBe("paint");
  });

  it("repaints for live paint-only properties on a node, effects beside them too", () => {
    expect(animationPath(new Set(["opacity"]), parent)).toBe("paint");
    expect(animationPath(new Set(["color", "borderTopColor"]), leaf)).toBe("paint");
    expect(animationPath(new Set(["opacity", "transform"]), leaf)).toBe("paint");
  });

  it("repaints a collapsed table part's opacity, which the paint applies as it resolves the lattice", () => {
    const cell = makeNode({ text: "x", intrinsicWidth: 1 });
    cell.style.latticeBorder = { top: null, right: null, bottom: null, left: null } as never;
    expect(animationPath(new Set(["opacity"]), cell)).toBe("paint");
    expect(animationPath(new Set(["opacity", "borderTopColor"]), cell)).toBe("layout");
  });

  it("re-lays-out for anything else, an inline element, an inherited color, a lattice's border, a backdrop filter", () => {
    const table = makeNode({ text: "x", intrinsicWidth: 1 });
    table.style.latticeBorder = { top: null, right: null, bottom: null, left: null } as never;
    expect(animationPath(new Set(["borderTopColor"]), table)).toBe("layout");
    expect(animationPath(new Set(["backgroundColor"]), leaf)).toBe("layout");
    expect(animationPath(new Set(["backdropFilter"]), leaf)).toBe("layout");
    expect(animationPath(new Set(["opacity", "width"]), leaf)).toBe("layout");
    expect(animationPath(new Set(["color"]), null)).toBe("layout");
    expect(animationPath(new Set(["color"]), parent)).toBe("layout");
    runs.inlineElements = [{ element: document.createElement("b") } as never];
    expect(animationPath(new Set(["color"]), runs)).toBe("layout");
    expect(animationPath(new Set(), leaf)).toBeNull();
  });
});

describe("the read", () => {
  /** A light element of a host with `style`, the pass's reads handed
   * `animations` of it, which its own `getAnimations` is never asked. */
  const reading = (style: string, animations: (el: Element) => Animation[]): HTMLElement => {
    const { host, a } = hostOf();
    a.setAttribute("style", style);
    a.getAnimations = () => {
      throw new Error("an element's own query");
    };
    readingAnimations(runningUnder(host, animations(a)));
    return a;
  };

  it("keeps an element animating an effect a layer root through an identity", () => {
    const el = reading("animation-name: spin; transform: matrix(1, 0, 0, 1, 0, 0)", (a) => [
      keyframed(a, [{ transform: "none" }, { transform: "rotate(1turn)" }]),
    ]);
    expect(animatesEffect(el)).toBe(true);
    expect(readCellStyle(el, 16).layer).toEqual(layered());
    // Outside a pass, the reads find nothing running.
    readingAnimations(null);
    expect(readCellStyle(el, 16).layer).toBeNull();
  });

  it("keeps an element whose effect is in transition a layer root, from the identity", () => {
    const el = reading("transition-duration: 1s; scale: 1", (a) => [
      transitioned(a, "scale"),
      transitioned(a, "color"),
    ]);
    expect(readCellStyle(el, 16).layer).toEqual(layered());
    const colored = reading("transition-duration: 1s; scale: 1", (a) => [transitioned(a, "color")]);
    expect(readCellStyle(colored, 16).layer).toBeNull();
  });

  it("leaves an element animating its opacity off the layers", () => {
    const el = reading("animation-name: spin", (a) => [
      keyframed(a, [{ opacity: "1" }, { opacity: "0.5" }]),
    ]);
    expect(animatedProperties(el)).toEqual(new Set(["opacity"]));
    expect(animatesEffect(el)).toBe(false);
    expect(readCellStyle(el, 16).layer).toBeNull();
  });

  it("samples the live paint-only properties", () => {
    const { a: el } = hostOf();
    el.setAttribute("style", "color: rgb(1, 2, 3); opacity: 0.5; border-top-color: rgb(4, 5, 6)");
    expect(readPaintStyle(getComputedStyle(el))).toMatchObject({
      color: "rgb(1, 2, 3)",
      opacity: 0.5,
      borderColor: { top: "rgb(4, 5, 6)" },
    });
  });
});

describe("the background tracker under an animation", () => {
  it("reads the animated value as it is", () => {
    const { host, a: el } = hostOf();
    el.setAttribute("style", "animation-name: spin; transition-duration: 1s");
    readingAnimations(runningUnder(host, [keyframed(el, [{ backgroundColor: "red" }])]));
    const cs = getComputedStyle(el);
    expect(trackBackground(el, "rgb(255, 0, 0)", cs)).toBe("rgb(255, 0, 0)");
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(0, 0, 255)");
  });

  it("still synthesizes a fade beside an animation of something else", () => {
    const { host, a: el } = hostOf();
    el.setAttribute("style", "animation-name: spin; transition-duration: 1s");
    readingAnimations(runningUnder(host, [keyframed(el, [{ transform: "none" }])]));
    const cs = getComputedStyle(el);
    expect(trackBackground(el, "rgb(255, 0, 0)", cs)).toBe("rgb(255, 0, 0)");
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(255, 0, 0)");
  });
});

describe("the synthesized background fade", () => {
  // The browser's eased progress (happy-dom computes none) and the
  // timing it was armed with; restored however a test ends.
  let progress: number | null;
  let armed: EffectTiming | undefined;
  let timing: MockInstance<() => ComputedEffectTiming>;
  let host: HTMLElement;
  beforeEach(() => {
    progress = 0;
    armed = undefined;
    timing = vi.spyOn(KeyframeEffect.prototype, "getComputedTiming").mockImplementation(function (
      this: KeyframeEffect,
    ) {
      armed = this.getTiming();
      return { progress };
    });
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    timing.mockRestore();
    host.remove();
  });
  /** An element whose background changed from `from` to `to`, its fade
   * armed: over a second, unless `style` says otherwise. */
  const fading = (
    from: string,
    to: string,
    style = "transition-property: background-color; transition-duration: 1s",
  ): HTMLElement => {
    const el = document.createElement("div");
    el.setAttribute("style", style);
    host.append(el);
    const cs = getComputedStyle(el);
    trackBackground(el, from, cs);
    trackBackground(el, to, cs);
    resolvePendingTransitions(host);
    return el;
  };
  /** The background of a fade from `from` to `to` at `eased` progress. */
  const fadeAt = (from: string, to: string, eased: number): string => {
    const el = fading(from, to);
    progress = eased;
    return trackBackground(el, to, getComputedStyle(el));
  };

  it("paints the old background until the layout's end arms a fade, and snaps where none covers it", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "transition-property: color; transition-duration: 1s");
    host.append(el);
    const cs = getComputedStyle(el);
    trackBackground(el, "rgb(255, 0, 0)", cs);
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(255, 0, 0)");
    // The stale paint asks the caller for one more layout.
    expect(resolvePendingTransitions(host)).toBe(true);
    expect(hasSynthesizedTransitions()).toBe(false);
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(0, 0, 255)");
  });

  it("arms the background's duration, delay, and easing, filled backwards as a CSS transition", () => {
    const el = fading(
      "rgb(0, 0, 0)",
      "rgb(255, 0, 0)",
      "transition-property: color, background-color; transition-duration: 2s, 1s; transition-delay: 0s, 300ms; transition-timing-function: linear(0 0%, 0.8 20%, 1 100%), steps(4)",
    );
    expect(hasSynthesizedTransitions()).toBe(true);
    trackBackground(el, "rgb(255, 0, 0)", getComputedStyle(el));
    expect(armed).toMatchObject({
      duration: 1000,
      delay: 300,
      easing: "steps(4)",
      fill: "backwards",
    });
  });

  it("reads the target past the end, which ends the fade", () => {
    const el = fading("rgb(0, 0, 0)", "rgb(255, 0, 0)");
    progress = null;
    expect(trackBackground(el, "rgb(255, 0, 0)", getComputedStyle(el))).toBe("rgb(255, 0, 0)");
    expect(hasSynthesizedTransitions()).toBe(false);
  });

  it("answers a second read in one layout as the first", () => {
    // The anchors' re-read (specs/anchor-positioning.md "Reading") reads
    // every element again before the layout's end arms its fades.
    const el = document.createElement("div");
    el.setAttribute("style", "transition-property: background-color; transition-duration: 1s");
    host.append(el);
    const cs = getComputedStyle(el);
    trackBackground(el, "rgb(255, 0, 0)", cs);
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(255, 0, 0)");
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(255, 0, 0)");
    resolvePendingTransitions(host);
  });

  it("retargets from the color it shows", () => {
    const el = fading("rgb(255, 0, 0)", "rgb(0, 0, 255)");
    const cs = getComputedStyle(el);
    progress = 0.5;
    const halfway = trackBackground(el, "rgb(0, 0, 255)", cs);
    // A second read in the layout answers as the first.
    expect(trackBackground(el, "rgb(0, 255, 0)", cs)).toBe(halfway);
    expect(trackBackground(el, "rgb(0, 255, 0)", cs)).toBe(halfway);
    resolvePendingTransitions(host);
    progress = 0;
    expect(trackBackground(el, "rgb(0, 255, 0)", cs)).toBe(halfway);
    progress = 1;
    expect(trackBackground(el, "rgb(0, 255, 0)", cs)).toBe("rgb(0 255 0)");
  });

  it("mixes a legacy pair in sRGB and any other in OKLab, alpha premultiplied", () => {
    const halfway = (from: string, to: string): Rgba => parseColor(fadeAt(from, to, 0.5))!;
    const near = (actual: Rgba, expected: Rgba) => {
      for (const key of ["r", "g", "b", "a"] as const) {
        expect(Math.abs(actual[key] - expected[key]), key).toBeLessThan(0.01);
      }
    };
    near(halfway("rgb(255, 0, 0)", "rgb(0, 0, 255)"), { r: 0.5, g: 0, b: 0.5, a: 1 });
    // A transparent end keeps the other's color, fading its alpha.
    near(halfway("rgba(0, 0, 0, 0)", "rgb(0, 0, 255)"), { r: 0, g: 0, b: 1, a: 0.5 });
    const oklab = (from: string, to: string): Rgba => {
      const [a, b] = [
        prepareColor(parseColor(from)!, "oklab"),
        prepareColor(parseColor(to)!, "oklab"),
      ];
      return mixColors(a, b, 0.5, "oklab");
    };
    near(
      halfway("color(srgb 1 0 0)", "color(srgb 0 0 1)"),
      oklab("rgb(255, 0, 0)", "rgb(0, 0, 255)"),
    );
    near(
      halfway("rgb(255, 0, 0)", "oklab(0.45 -0.03 -0.31)"),
      oklab("rgb(255, 0, 0)", "oklab(0.45 -0.03 -0.31)"),
    );
  });

  it("mixes an end outside sRGB by its own OKLab value, written as color(srgb) past it", () => {
    // Tailwind's emerald-400 to gray-800, cyan-400 to fuchsia-500,
    // lime-400 to white.
    expect([
      fadeAt("oklch(0.765 0.177 163.223)", "oklch(0.278 0.033 256.848)", 0.25),
      fadeAt("oklch(0.789 0.154 211.53)", "oklch(0.667 0.295 322.15)", 0.5),
      fadeAt("oklch(0.841 0.238 128.85)", "rgb(255, 255, 255)", 0.25),
    ]).toEqual(["color(srgb -0.00758 0.65098 0.48455)", "rgb(168 150 248)", "rgb(179 238 100)"]);
  });
});

describe("node index", () => {
  it("finds a node by its element, an anonymous run of its text left to it", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const child = makeNode({ text: "x", intrinsicWidth: 1, source: b });
    const run = makeNode({ text: "loading", intrinsicWidth: 7, source: a });
    run.anonymous = true;
    const root = makeNode({ children: [run, child], source: a });
    layoutRoot(root, 8);
    const index = nodeIndex(root);
    expect(index.get(a)).toBe(root);
    expect(index.get(b)).toBe(child);
  });
});
