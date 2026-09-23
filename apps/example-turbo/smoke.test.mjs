/**
 * Smoke test for Turbo: the page is attributes alone — a `<mono-menu>`
 * mounts itself, and Turbo navigates the frame when the link inside a
 * menu item is followed.
 */
import { chromium } from "playwright";
import { build, createServer } from "vite";
import { runEnhancerSmoke } from "../../scripts/enhancer-smoke.mjs";

const navigated = "navigated by Turbo";

await runEnhancerSmoke({
  name: "Turbo",
  dir: import.meta.dirname,
  chromium,
  createServer,
  build,
  // A Turbo menu item holds an ordinary anchor, which is what it
  // follows.
  pick: '[role="menuitem"][data-value="next"] a',
  drive: async ({ gridText, logText, waitForGrid }) => {
    await waitForGrid(navigated);
    return {
      turboNavigated: (await logText()).includes(navigated),
      frameOnGrid: (await gridText()).includes(navigated),
    };
  },
});
