/**
 * CDN entry — a classic script loaded NEXT TO monowind's own cdn.js:
 *
 *   <script src=".../monowind/dist/cdn.js"></script>
 *   <script src=".../@monowind/ui/dist/cdn.js"></script>
 *
 * Mounts components on markup through `monowind.ui`, Zag bundled in.
 */
import { dialog } from "./dialog.ts";
import { listbox } from "./listbox.ts";
import { menu } from "./menu.ts";
import { popover } from "./popover.ts";
import { select } from "./select.ts";
import { tooltip } from "./tooltip.ts";

// Injected by vite.cdn.config.ts from package.json.
declare const __MONOWIND_UI_VERSION__: string;

// Merge, not replace — core's cdn.js and the other companions share the global.
const existing = (globalThis as { monowind?: { ui?: object } }).monowind;
Object.assign(globalThis, {
  monowind: {
    ...existing,
    ui: {
      ...existing?.ui,
      menu,
      listbox,
      select,
      dialog,
      popover,
      tooltip,
      version: __MONOWIND_UI_VERSION__,
    },
  },
});
