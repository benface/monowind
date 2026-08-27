/**
 * Visual regression tests, always run inside the official Playwright Docker
 * image so screenshots are identical on every machine (same OS, browser
 * build, and fonts). Extra arguments are forwarded to `playwright test`
 * (e.g. --update-snapshots to regenerate baselines).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["--filter", "@monowind/storybook", "build"]);
run("docker", [
  "run",
  "--rm",
  "--init",
  // Note on CPU architecture: local (Apple Silicon → linux/arm64 image) and
  // CI (ubuntu-latest → linux/amd64) produce byte-identical screenshots for
  // our rendering — verified 2026-08 by regenerating baselines under both.
  // If a future feature ever breaks that (e.g. GPU-rasterized content),
  // pin `--platform linux/amd64` here to match CI.
  "-v",
  `${repoRoot}:/work`,
  "-w",
  "/work/apps/storybook",
  image,
  "npx",
  "playwright",
  "test",
  ...process.argv.slice(2),
]);
