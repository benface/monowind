import { placePainted } from "../src/paint-origin.ts";
import { createNode, defaultCellStyle } from "../src/types.ts";
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

/** A layer root's layer (specs/layers.md): no backdrop filter, its cells
 * drawn resampled or not. */
export const layered = (resampled = false): Layer => ({ backdropFilter: "none", resampled });

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
