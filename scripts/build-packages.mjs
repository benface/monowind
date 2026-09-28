import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build monowind packages by folder name (`core`, `ui`, …), in order —
 * none where the test gate built them all already (`MONOWIND_BUILT`,
 * scripts/test.mjs). Run directly, it builds the folders it is given.
 */
export function buildPackages(folders) {
  if (process.env.MONOWIND_BUILT) return;
  for (const folder of folders) {
    const dir = fileURLToPath(new URL(`../packages/${folder}`, import.meta.url));
    const built = spawnSync("pnpm", ["-C", dir, "build"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  buildPackages(process.argv.slice(2));
}
