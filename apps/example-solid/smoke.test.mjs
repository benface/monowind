/**
 * Smoke test for Solid integration: the ownership loop (click → the
 * signal rewrites the text node, batched on a microtask in 2.0 →
 * monowind observes the mutation and relayouts, without Solid
 * noticing). Shared body in scripts/framework-smoke.mjs; the ui steps
 * wait for a Zag adapter that runs on Solid 2.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runFrameworkSmoke } from "../../scripts/framework-smoke.mjs";

await runFrameworkSmoke({
  name: "Solid",
  dir: import.meta.dirname,
  chromium,
  createServer,
});
