import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** Run `command` with `args` from the repo's root, exiting with its
 * status where it fails. */
export function run(command, args) {
  const done = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}
