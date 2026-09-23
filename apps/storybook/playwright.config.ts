import { defineConfig } from "@playwright/test";

/**
 * Visual regression tests — ALWAYS run inside the official Playwright Docker
 * image (see scripts/test-visual.mjs) so screenshots are byte-identical
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
    // each with its own goldens. The QR decode, keyboard, pointer,
    // top-layer, and agreement specs run in all three too, goldenless:
    // glyph rendering, scroll physics, hit-testing, layout rounding, and
    // the window's own metrics differ per engine.
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: /(selection|qr|keyboard|pointer(-events)?|top-layer|agreement)\.spec\.ts/,
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
      testMatch: /(selection|qr|keyboard|pointer(-events)?|top-layer|agreement)\.spec\.ts/,
    },
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
    // A hair above nothing: the image is pinned and the render
    // deterministic (both verified at 0), so 0.01 only absorbs a
    // one-bit wobble, where the default 0.2 passed nine baselines that
    // had drifted up to a percent of their pixels at 70/255. No pixel
    // BUDGET here, so a spec that needs one (the per-engine selection
    // ink) still sets its own on the call.
    toHaveScreenshot: { animations: "disabled", threshold: 0.01 },
  },
});
