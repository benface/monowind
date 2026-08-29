import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // Runs every story as a test (render + play function + a11y checks).
    storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") }),
  ],
  test: {
    name: "storybook",
    // Generous: three browsers share a loaded CI runner's CPU, and slow
    // tails have crossed 30s.
    testTimeout: 60_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Full engine matrix: Chromium + WebKit exercise the Typed OM path,
      // and (until Firefox's stable channel ships Typed OM, ~157) Firefox
      // exercises the class-scan fallback against a real engine. The
      // fallback also has deterministic headless coverage in
      // packages/core/test/style.test.ts (happy-dom has no Typed OM).
      instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
    },
  },
});
