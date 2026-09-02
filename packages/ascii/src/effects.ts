/**
 * TOIlet-style render filters as the `effect` attribute — per-cell
 * color mapping defined against the theme tokens (styles.css), so
 * effects are themeable by construction, never hardcoded RGB. An
 * effect replaces any font-embedded colors (it's a whole-banner look).
 */

import type { LeafRun } from "monowind";

const EFFECTS = {
  // Column stripes through the six ANSI hues (toilet --gay).
  rainbow: ["red", "yellow", "green", "cyan", "blue", "magenta"],
  // Row bands from bright to dark (toilet --metal's shine).
  metal: ["bright-white", "white", "bright-cyan", "bright-blue", "blue"],
} as const;

export type Effect = keyof typeof EFFECTS;

export function isEffect(name: string): name is Effect {
  return name in EFFECTS;
}

export function effectRuns(effect: Effect, lines: string[]): LeafRun[] {
  const palette = EFFECTS[effect];
  const color = (index: number) => `var(--mw-ansi-${palette[index % palette.length]})`;
  const runs: LeafRun[] = [];
  if (effect === "metal") {
    lines.forEach((line, y) => {
      if (line.length > 0) {
        runs.push({
          line: y,
          start: 0,
          end: line.length,
          paint: { color: color(Math.floor((y * palette.length) / Math.max(1, lines.length))) },
        });
      }
    });
    return runs;
  }
  // Column-striped effects: one run per stripe per line.
  const stripe = 2; // two cells per hue reads better than one
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x += stripe) {
      runs.push({
        line: y,
        start: x,
        end: Math.min(line.length, x + stripe),
        paint: { color: color(Math.floor(x / stripe)) },
      });
    }
  });
  return runs;
}
