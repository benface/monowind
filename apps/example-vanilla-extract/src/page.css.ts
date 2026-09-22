import { globalStyle, style } from "@vanilla-extract/css";

/**
 * Styles as TypeScript, compiled to real CSS at build time. monowind
 * reads the COMPUTED result, so there is nothing to teach it about
 * vanilla-extract — and its own utilities are custom properties, which
 * a style object sets like any other.
 */
globalStyle("body", {
  minHeight: "100vh",
  margin: 0,
  padding: "2rem",
  background: "#171717",
  color: "#f5f5f5",
});

export const box = style({
  border: "1px solid #34d399",
  paddingLeft: "0.25rem",
  paddingRight: "0.25rem",
  // What `borders-rounded` writes in Tailwind.
  vars: { "--mw-border-glyphs": "rounded" },
});

export const accent = style({ color: "#facc15" });
