/**
 * Smoke test for StyleX: the grid lays out what its atomic classes
 * styled, and monowind's own border glyphs come from a custom
 * property a style object set.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runStylingSmoke } from "../../scripts/styling-smoke.mjs";

await runStylingSmoke({ name: "StyleX", dir: import.meta.dirname, chromium, createServer });
