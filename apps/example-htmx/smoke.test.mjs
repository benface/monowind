/**
 * Smoke test for htmx: the page is attributes alone — a `<mono-menu>`
 * mounts itself, and htmx swaps a fragment in on the `itemselect`
 * event the element dispatches.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { runEnhancerSmoke } from "../../scripts/enhancer-smoke.mjs";

const swapped = "swapped in by htmx";

await runEnhancerSmoke({
  name: "htmx",
  dir: import.meta.dirname,
  chromium,
  createServer,
  drive: async ({ gridText, logText, waitForGrid }) => {
    await waitForGrid(swapped);
    return {
      htmxSwapped: (await logText()).includes(swapped),
      // The swapped fragment is laid out on the grid like any markup.
      swapOnGrid: (await gridText()).includes(swapped),
    };
  },
});
