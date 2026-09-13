import { describe, expect, it } from "vitest";
import { trackBackground } from "../src/animate.ts";
import {
  animatedProperties,
  animatesEffect,
  animationPath,
  drainAnimated,
  nodeIndex,
} from "../src/animation.ts";
import { layoutRoot } from "../src/layout.ts";
import { readCellStyle, readPaintStyle } from "../src/style.ts";
import { makeNode } from "./helpers.ts";

/** Animations (specs/animations.md): the running animations' keyframe
 * properties, the path a frame takes for them, and the read that keeps
 * an animating effect a layer root. */

/** An element whose `getAnimations` reports the given keyframes, as
 * the platform would: happy-dom runs no CSS animations. */
const animating = (
  keyframes: Record<string, string>[][],
  style = "",
  playState: AnimationPlayState = "running",
): HTMLElement => {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  document.body.appendChild(el);
  el.getAnimations = () =>
    keyframes.map(
      (frames) =>
        ({
          animationName: "spin",
          playState,
          effect: Object.assign(Object.create(KeyframeEffect.prototype), {
            getKeyframes: () => frames.map((frame) => ({ offset: 0, easing: "linear", ...frame })),
          }),
        }) as unknown as Animation,
    );
  return el;
};

describe("animated properties", () => {
  it("collects the keyframes' properties of the running animations", () => {
    const el = animating([
      [{ transform: "none" }, { transform: "rotate(1turn)" }],
      [{ opacity: "1" }, { opacity: "0.5" }, { opacity: "1" }],
    ]);
    expect([...animatedProperties(el)].sort()).toEqual(["opacity", "transform"]);
  });

  it("leaves out a paused animation, and an element with no animations", () => {
    expect(animatedProperties(animating([[{ opacity: "0" }]], "", "paused")).size).toBe(0);
    expect(animatedProperties(document.createElement("div")).size).toBe(0);
  });

  it("skips the call where the computed style names no animation, and notes a find", () => {
    const el = animating([[{ opacity: "0" }]]);
    let calls = 0;
    const list = el.getAnimations;
    el.getAnimations = () => (calls++, list.call(el));
    expect(animatedProperties(el, getComputedStyle(el)).size).toBe(0);
    expect(calls).toBe(0);
    expect(drainAnimated(document.body)).toEqual([]);
    el.style.animationName = "spin";
    expect(animatedProperties(el, getComputedStyle(el)).size).toBe(1);
    expect(calls).toBe(1);
    // A read's find waits for the host that holds the element, once.
    expect(drainAnimated(document.createElement("div"))).toEqual([]);
    expect(drainAnimated(document.body)).toEqual([el]);
    expect(drainAnimated(document.body)).toEqual([]);
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

  it("repaints for live paint-only properties on a node, effects beside them too", () => {
    expect(animationPath(new Set(["opacity"]), parent)).toBe("paint");
    expect(animationPath(new Set(["color", "borderTopColor"]), leaf)).toBe("paint");
    expect(animationPath(new Set(["opacity", "transform"]), leaf)).toBe("paint");
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
  it("keeps an element animating an effect a layer root through an identity", () => {
    const el = animating(
      [[{ transform: "none" }, { transform: "rotate(1turn)" }]],
      "animation-name: spin; transform: matrix(1, 0, 0, 1, 0, 0)",
    );
    expect(animatesEffect(el, getComputedStyle(el))).toBe(true);
    expect(readCellStyle(el, 16).layer).toEqual({ backdropFilter: "none" });
  });

  it("keeps an element whose effect is in transition a layer root, from the identity", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "transition-duration: 1s; scale: 1");
    document.body.appendChild(el);
    let calls = 0;
    el.getAnimations = () => (
      calls++,
      [
        { transitionProperty: "scale", playState: "running" },
        { transitionProperty: "color", playState: "running" },
      ] as unknown as Animation[]
    );
    expect(animatesEffect(el, getComputedStyle(el))).toBe(true);
    expect(readCellStyle(el, 16).layer).toEqual({ backdropFilter: "none" });
    el.getAnimations = () => [
      { transitionProperty: "color", playState: "running" } as unknown as Animation,
    ];
    expect(readCellStyle(el, 16).layer).toBeNull();
    // Without a duration there is no transition to ask for.
    el.style.transitionDuration = "0s";
    calls = 0;
    expect(readCellStyle(el, 16).layer).toBeNull();
    expect(calls).toBe(0);
  });

  it("leaves an element animating its opacity off the layers", () => {
    const el = animating([[{ opacity: "1" }, { opacity: "0.5" }]], "animation-name: spin");
    expect(animatesEffect(el, getComputedStyle(el))).toBe(false);
    expect(readCellStyle(el, 16).layer).toBeNull();
  });

  it("samples the live paint-only properties", () => {
    const el = animating([], "color: rgb(1, 2, 3); opacity: 0.5; border-top-color: rgb(4, 5, 6)");
    expect(readPaintStyle(getComputedStyle(el))).toMatchObject({
      color: "rgb(1, 2, 3)",
      opacity: 0.5,
      borderColor: { top: "rgb(4, 5, 6)" },
    });
  });
});

describe("the background tracker under an animation", () => {
  it("reads the animated value as it is", () => {
    const el = animating(
      [[{ backgroundColor: "red" }]],
      "animation-name: spin; transition-duration: 1s",
    );
    const cs = getComputedStyle(el);
    expect(trackBackground(el, "rgb(255, 0, 0)", cs)).toBe("rgb(255, 0, 0)");
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(0, 0, 255)");
  });

  it("still synthesizes a fade beside an animation of something else", () => {
    const el = animating(
      [[{ transform: "none" }]],
      "animation-name: spin; transition-duration: 1s",
    );
    const cs = getComputedStyle(el);
    expect(trackBackground(el, "rgb(255, 0, 0)", cs)).toBe("rgb(255, 0, 0)");
    expect(trackBackground(el, "rgb(0, 0, 255)", cs)).toBe("rgb(255, 0, 0)");
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
