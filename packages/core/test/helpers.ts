import { placePainted } from "../src/paint-origin.ts";
import { createNode, decorationOf, defaultCellStyle, NO_DECORATION } from "../src/types.ts";
import type { CellStyle, Layer, LayoutNode } from "../src/types.ts";

const stubElement = { getAttribute: () => null } as unknown as Element;

/** Build a LayoutNode for headless layout tests — no DOM required. */
export function makeNode(overrides: {
  style?: Partial<CellStyle>;
  children?: LayoutNode[];
  text?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  source?: Element;
}): LayoutNode {
  const text = overrides.text ?? "";
  return createNode(
    overrides.source ?? stubElement,
    { ...defaultCellStyle(), ...overrides.style },
    overrides.children,
    text,
    overrides.intrinsicWidth ?? text.length,
    overrides.intrinsicHeight ?? (text.length > 0 ? 1 : 0),
  );
}

/** A length of `value` cells. */
export const cells = (value: number) => ({ kind: "cells" as const, value });

/** A plain underline in the text's color. */
export const UNDERLINE = decorationOf({ ...NO_DECORATION, line: "underline" });

/** A layer root's layer (specs/layers.md): no backdrop filter, its cells
 * drawn resampled or not. */
export const layered = (resampled = false): Layer => ({ backdropFilter: "none", resampled });

/** mulberry32: a seeded generator in [0, 1), for the fuzz tests. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `box` scrolled to `x`, `y` cells and the tree placed again: the boxes
 * a sticky shift moved. */
export function scrollBox(
  root: LayoutNode,
  box: LayoutNode,
  x: number,
  y: number,
): ReturnType<typeof placePainted> {
  box.scroll = { x, y };
  return placePainted(root);
}
