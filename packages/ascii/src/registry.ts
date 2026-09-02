/**
 * The font registry: `font` attribute values resolve here. Its own
 * module so generated font modules can import it without cycling
 * through the package entry.
 */

import { invalidateLeaves } from "monowind";
import { parseFont } from "./font.ts";
import type { AsciiFont } from "./font.ts";

const fonts = new Map<string, AsciiFont>();

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.(flf|tlf)$/, "")
    .trim();

/** Register a font under a name (`font` attribute values resolve
 * here). Accepts raw `.flf`/`.tlf` text — the bring-your-own-file path
 * for fonts we don't redistribute. Last registration wins with a
 * warning; connected hosts relayout. */
export function registerAsciiFont(name: string, data: string): AsciiFont | null {
  const key = normalizeName(name);
  let font: AsciiFont;
  try {
    font = parseFont(data);
  } catch (err) {
    console.warn(`[monowind] registerAsciiFont("${name}"): ${String(err)}`);
    return null;
  }
  if (fonts.has(key)) {
    console.warn(`[monowind] registerAsciiFont: replacing "${key}" (last registration wins).`);
  }
  fonts.set(key, font);
  invalidateLeaves();
  return font;
}

export function asciiFont(name: string): AsciiFont | undefined {
  return fonts.get(normalizeName(name));
}
