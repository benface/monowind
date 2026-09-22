/** The scripts this example serves: monowind's bundles and the
 * enhancer, resolved here where pnpm linked it. */
import { copyVendor } from "../../scripts/copy-vendor.mjs";

copyVendor(import.meta.dirname, {
  bundles: { monowind: "cdn.js", "@monowind/ui": "ui-cdn.js" },
  extras: { "turbo.js": import.meta.resolve("@hotwired/turbo/dist/turbo.es2017-umd.js") },
});
