// The companion stylesheet, which the engine needs and no styling tool
// supplies: the locks on the host's subtree and the `@property`
// declarations the grid reads.
import "monowind/styles.css";
import { defineMonoWind } from "monowind";
import { accent, box } from "./page.css.ts";

/**
 * vanilla-extract styles the page and monowind lays it out. The class
 * names are values here rather than strings in the markup, so the
 * page is built from them.
 */
defineMonoWind();

document.body.innerHTML = `
  <mono-wind>
    <div data-test="box" class="${box}">
      <p>A page styled by <b class="${accent}">vanilla-extract</b>.</p>
      <p>The corners are rounded because a custom property says so.</p>
    </div>
  </mono-wind>`;
