import * as stylex from "@stylexjs/stylex";
// The companion stylesheet, which the engine needs and no styling tool
// supplies: the locks on the host's subtree and the `@property`
// declarations the grid reads.
import "monowind/styles.css";
import { defineMonoWind } from "monowind";

/**
 * StyleX styles the page and monowind lays it out. The engine reads
 * COMPUTED styles, so the tool that wrote them does not matter — and
 * monowind's own utilities are custom properties, which a style
 * object sets like any other. The class names are values here rather
 * than strings in the markup, so the page is built from them.
 */
defineMonoWind();

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: "2rem",
    backgroundColor: "#171717",
    color: "#f5f5f5",
  },
  box: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#34d399",
    paddingInline: "0.25rem",
    // What `borders-rounded` writes in Tailwind.
    "--mw-border-glyphs": "rounded",
  },
  accent: { color: "#facc15" },
});

document.body.className = stylex.attrs(styles.page).class ?? "";
document.body.innerHTML = `
  <mono-wind>
    <div data-test="box" class="${stylex.attrs(styles.box).class ?? ""}">
      <p>A page styled by <b class="${stylex.attrs(styles.accent).class ?? ""}">StyleX</b>.</p>
      <p>The corners are rounded because a custom property says so.</p>
    </div>
  </mono-wind>`;
