/** A font module's source map repeats its whole font as source: the
 * build drops the maps and the comments naming them. */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const dir = new URL("../dist/fonts/", import.meta.url);
for (const file of readdirSync(dir)) {
  const path = new URL(file, dir);
  if (file.endsWith(".map")) rmSync(path);
  else if (file.endsWith(".js") || file.endsWith(".d.ts")) {
    const code = readFileSync(path, "utf8");
    writeFileSync(path, code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"));
  }
}
