import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

/**
 * Copy the scripts an example serves into its `public/`, which the dev
 * server serves beside index.html and a build copies as is — a plain
 * relative script URL cannot reach outside the served directory, and
 * this mirrors how they are consumed in the real world (URLs, not
 * monorepo paths).
 *
 * `bundles` names the monowind packages to build and take `dist/cdn.js`
 * from, each mapped to the name it is served under. `extras` maps a
 * served name to a URL the CALLER resolved: `import.meta.resolve` in
 * the app, where pnpm linked the dependency, rather than here.
 */
export function copyVendor(dir, { bundles = {}, extras = {} } = {}) {
  mkdirSync(`${dir}/public`, { recursive: true });
  const into = (name) => new URL(name, `file://${dir}/public/`);
  for (const [pkg, served] of Object.entries(bundles)) {
    const built = spawnSync("pnpm", ["--filter", pkg, "build"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (built.status !== 0) process.exit(built.status ?? 1);
    const from = pkg === "monowind" ? "core" : pkg.replace("@monowind/", "");
    for (const suffix of ["", ".map"]) {
      copyFileSync(
        new URL(`../packages/${from}/dist/cdn.js${suffix}`, import.meta.url),
        into(`${served}${suffix}`),
      );
    }
  }
  for (const [served, resolved] of Object.entries(extras)) {
    copyFileSync(new URL(resolved), into(served));
  }
}
