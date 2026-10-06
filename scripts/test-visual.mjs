/**
 * Visual regression tests, always run inside the official Playwright Docker
 * image so screenshots are identical on every machine (same OS, browser
 * build, and fonts). Extra arguments are forwarded to `playwright test`
 * (e.g. --update-snapshots to regenerate baselines).
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { run } from "./run.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

run("pnpm", ["--filter", "@monowind/storybook", "build"]);
run("docker", [
  "run",
  "--rm",
  "--init",
  // The goldens are arm64's (Apple Silicon → the linux/arm64 image), and
  // CI's visual jobs run on arm64 too: amd64 rasterizes a rotated
  // picture's edges a few pixels apart (verified 2026-10-06).
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
