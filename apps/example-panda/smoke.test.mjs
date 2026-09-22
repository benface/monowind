/**
 * Smoke test for Panda CSS: the grid lays out what its generated
 * classes styled, and monowind's own border glyphs come from a custom
 * property a style object set.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runStylingSmoke } from "../../scripts/styling-smoke.mjs";

await runStylingSmoke({ name: "Panda CSS", dir: import.meta.dirname, chromium, createServer });
