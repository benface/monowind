/**
 * Smoke test for Svelte integration: the ownership loop (click → the
 * rune rewrites the text → monowind observes the mutation and relayouts,
 * without Svelte noticing) plus the menu and dialog from
 * @monowind/ui-svelte. Shared body in scripts/framework-smoke.mjs.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runFrameworkSmoke } from "../../scripts/framework-smoke.mjs";

await runFrameworkSmoke({
  name: "Svelte",
  dir: import.meta.dirname,
  chromium,
  createServer,
});
