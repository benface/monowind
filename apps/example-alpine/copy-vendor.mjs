/** The scripts this example serves: monowind's bundles and the
 * enhancer, resolved here where pnpm linked it. */
import { copyVendor } from "../../scripts/copy-vendor.mjs";

copyVendor(import.meta.dirname, {
  bundles: { monowind: "cdn.js", "@monowind/ui": "ui-cdn.js" },
  extras: { "alpine.js": import.meta.resolve("alpinejs/dist/cdn.min.js") },
});
