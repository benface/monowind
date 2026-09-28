import { spawnSync } from "node:child_process";

/**
 * The test gate (`pnpm test`): every package built once, then each
 * workspace's tests four at a time, the smokes serving those builds
 * (`MONOWIND_BUILT`), and the stories last and alone, whose three
 * browsers take the machine.
 */
const run = (args, env = {}) => {
  const done = spawnSync("pnpm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
};

run(["-r", "--filter", "./packages/*", "build"]);
run(["-r", "--workspace-concurrency=4", "--filter", "!@monowind/storybook", "test"], {
  MONOWIND_BUILT: "1",
});
run(["--filter", "@monowind/storybook", "test"]);
