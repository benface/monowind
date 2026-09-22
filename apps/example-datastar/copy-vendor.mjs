/** The scripts this example serves. Datastar is not among them: what
 * npm carries is source with relative imports, its browser build
 * living on a CDN, so `main.js` imports it and the bundler resolves
 * it. */
import { copyVendor } from "../../scripts/copy-vendor.mjs";

copyVendor(import.meta.dirname, {
  bundles: { monowind: "cdn.js", "@monowind/ui": "ui-cdn.js" },
});
