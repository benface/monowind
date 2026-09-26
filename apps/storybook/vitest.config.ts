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
    // Bind the browser-test server to IPv4 loopback: where `localhost`
    // resolves to `::1` first, Firefox's in-page orchestrator can't reach
    // the IPv6-bound server and its session never connects.
    api: { host: "127.0.0.1" },
    // Runs in the browser page; silences known console noise (see file).
    setupFiles: [path.join(import.meta.dirname, ".storybook/vitest.setup.ts")],
    // Generous: three browsers share a loaded CI runner's CPU, and slow
    // tails have crossed 30s.
    testTimeout: 60_000,
    // Playwright's initial `page.goto` occasionally times out or crashes
    // when three browsers boot in parallel on a busy machine (WebKit is
    // the usual culprit). Second attempts recover cleanly.
    retry: 1,
    reporters: [
      "default",
      // A retry covers a flaky play as well as a flaky boot: each test
      // that passed only on its retry is named, so neither goes unseen.
      {
        onTestCaseResult(testCase) {
          if (testCase.diagnostic()?.flaky)
            console.warn(
              `Passed on retry: ${testCase.project.name} › ${path.basename(testCase.module.moduleId)} › ${testCase.fullName}`,
            );
        },
      },
    ],
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
