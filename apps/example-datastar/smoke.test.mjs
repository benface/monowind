/**
 * Smoke test for Datastar: the page is attributes alone — a
 * `<mono-menu>` mounts itself, and a signal takes the value its
 * `itemselect` event carries.
 */
import { chromium } from "playwright";
import { build, createServer } from "vite";
import { runEnhancerSmoke } from "../../scripts/enhancer-smoke.mjs";

const picked = "picked next";

await runEnhancerSmoke({
  name: "Datastar",
  dir: import.meta.dirname,
  chromium,
  createServer,
  build,
  drive: async ({ gridText, logText, waitForGrid }) => {
    await waitForGrid(picked);
    return {
      signalStored: (await logText()).includes("next"),
      valueOnGrid: (await gridText()).includes(picked),
    };
  },
});
