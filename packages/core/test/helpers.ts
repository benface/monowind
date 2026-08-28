import { defaultCellStyle, zeroInsets } from "../src/types.ts";
import type { CellStyle, LayoutNode } from "../src/types.ts";

const stubElement = {} as unknown as Element;

/** Build a LayoutNode for headless layout tests — no DOM required. */
export function makeNode(overrides: {
  style?: Partial<CellStyle>;
  children?: LayoutNode[];
  text?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}): LayoutNode {
  const text = overrides.text ?? "";
  return {
    source: stubElement,
    style: { ...defaultCellStyle(), ...overrides.style },
    children: overrides.children ?? [],
    text,
    intrinsicWidth: overrides.intrinsicWidth ?? text.length,
    intrinsicHeight: overrides.intrinsicHeight ?? (text.length > 0 ? 1 : 0),
    localRect: { x: 0, y: 0, width: 0, height: 0 },
    unclampedHeight: 0,
    resolvedPadding: zeroInsets(),
  };
}
