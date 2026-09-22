// UnoCSS's Tailwind-compatible reset, which is what makes `border`
// mean a 1px solid one, as it does in Tailwind.
import "@unocss/reset/tailwind.css";
import "uno.css";
// The companion stylesheet, which the engine needs and no styling tool
// supplies: the locks on the host's subtree and the `@property`
// declarations the grid reads.
import "monowind/styles.css";
import { defineMonoWind } from "monowind";

/**
 * UnoCSS styles the page and monowind lays it out. The engine reads
 * COMPUTED styles, so the tool that wrote them does not matter — the
 * whole setup is these imports and the call below.
 */
defineMonoWind();
