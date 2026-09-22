import "./index.css";
// The companion stylesheet, which the engine needs and no styling tool
// supplies: the locks on the host's subtree and the `@property`
// declarations the grid reads.
import "monowind/styles.css";
import { defineMonoWind } from "monowind";
import { css } from "../styled-system/css";

/**
 * Panda CSS styles the page and monowind lays it out. The engine reads
 * COMPUTED styles, so the tool that wrote them does not matter — and
 * monowind's own utilities are custom properties, which a style object
 * sets like any other. The class names are values here rather than
 * strings in the markup, so the page is built from them.
 */
defineMonoWind();

const page = css({
  minHeight: "100vh",
  margin: 0,
  padding: "2rem",
  background: "#171717",
  color: "#f5f5f5",
});
const box = css({
  border: "1px solid #34d399",
  paddingInline: "0.25rem",
  // What `borders-rounded` writes in Tailwind.
  "--mw-border-glyphs": "rounded",
});
const accent = css({ color: "#facc15" });

document.body.className = page;
document.body.innerHTML = `
  <mono-wind>
    <div data-test="box" class="${box}">
      <p>A page styled by <b class="${accent}">Panda CSS</b>.</p>
      <p>The corners are rounded because a custom property says so.</p>
    </div>
  </mono-wind>`;
