/**
 * Smoke test for Vue integration: the ownership loop (click → the ref
 * rewrites the text → monowind observes the mutation and relayouts,
 * without Vue noticing) plus the menu and dialog from @monowind/ui-vue.
 * Shared body in scripts/framework-smoke.mjs.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runFrameworkSmoke } from "../../scripts/framework-smoke.mjs";

await runFrameworkSmoke({
  name: "Vue",
  dir: import.meta.dirname,
  chromium,
  createServer,
});
