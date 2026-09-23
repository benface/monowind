/**
 * Smoke test for Alpine: the page is attributes alone — a
 * `<mono-menu>` mounts itself, and Alpine stores the value its
 * `itemselect` event carries.
 */
import { chromium } from "playwright";
import { build, createServer } from "vite";
import { runEnhancerSmoke } from "../../scripts/enhancer-smoke.mjs";

const picked = "picked next";

await runEnhancerSmoke({
  name: "Alpine",
  dir: import.meta.dirname,
  chromium,
  createServer,
  build,
  drive: async ({ gridText, logText, waitForGrid }) => {
    await waitForGrid(picked);
    return {
      alpineStored: (await logText()).includes("next"),
      // What Alpine wrote is laid out on the grid like any text.
      valueOnGrid: (await gridText()).includes(picked),
    };
  },
});
