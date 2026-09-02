import { defineConfig } from "@playwright/test";

/**
 * Visual regression tests — ALWAYS run inside the official Playwright Docker
 * image (see scripts/test-visual.sh) so screenshots are byte-identical
 * across machines and CI. Baselines are therefore Linux-only; the snapshot
 * path template deliberately omits the platform suffix.
 */
export default defineConfig({
  testDir: "./visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  projects: [
    { name: "chromium" },
    // Selection painting differs per engine (Safari draws selection ink
    // through text-fill-color) — the selection spec runs in all three,
    // each with its own goldens.
    { name: "webkit", use: { browserName: "webkit" }, testMatch: /selection\.spec\.ts/ },
    { name: "firefox", use: { browserName: "firefox" }, testMatch: /selection\.spec\.ts/ },
  ],
  webServer: {
    command: "node ../../scripts/serve-static.mjs storybook-static 6007",
    port: 6007,
    reuseExistingServer: false,
  },
  use: {
    baseURL: "http://localhost:6007",
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 600 },
  },
  expect: {
    toHaveScreenshot: { animations: "disabled" },
  },
});
