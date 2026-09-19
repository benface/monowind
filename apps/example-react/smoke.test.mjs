/**
 * Smoke test for React integration: the ownership loop (click → React
 * re-renders the text → monowind observes the mutation and relayouts,
 * without React noticing) plus the menu and dialog from
 * @monowind/ui-react. Shared body in scripts/framework-smoke.mjs.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runFrameworkSmoke } from "../../scripts/framework-smoke.mjs";

await runFrameworkSmoke({
  name: "React",
  dir: import.meta.dirname,
  chromium,
  createServer,
});
