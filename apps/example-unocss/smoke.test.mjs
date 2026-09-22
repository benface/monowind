/**
 * Smoke test for UnoCSS: the grid lays out what UnoCSS styled, and
 * monowind's own border glyphs come from a custom property rather
 * than a Tailwind utility.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runStylingSmoke } from "../../scripts/styling-smoke.mjs";

await runStylingSmoke({ name: "UnoCSS", dir: import.meta.dirname, chromium, createServer });
