import { run } from "./run.mjs";

/**
 * The test gate (`pnpm test`): each workspace's tests four at a time,
 * after its packages' builds (pnpm-workspace.yaml's `tasks`), every
 * package built and its emitted types checked as CI does, and the
 * stories last and alone, whose three browsers take the machine.
 */
run("pnpm", ["-r", "--workspace-concurrency=4", "--filter", "!@monowind/storybook", "test"]);
run("pnpm", ["-r", "--filter", "./packages/*", "build"]);
run("node", ["scripts/check-workspace.mjs", "--built"]);
run("pnpm", ["--filter", "@monowind/storybook", "test"]);
