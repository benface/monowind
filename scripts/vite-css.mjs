/** A selector's, value's or prelude's line breaks and indentation, as
 * one space, and the space around its commas where none is quoted text. */
const tight = (text) => {
  const spaced = text.replace(/\s*\n\s*/g, " ");
  return /["']/.test(spaced) ? spaced : spaced.replace(/\s*,\s*/g, ",");
};

/** Vite's `css` option for every build that inlines CSS as a string
 * (`?inline`): its comments dropped and its white space trimmed, the
 * minifier left off for the Tailwind source among it. */
export const css = {
  postcss: {
    plugins: [
      { postcssPlugin: "strip-comments", Comment: (comment) => void comment.remove() },
      {
        postcssPlugin: "trim-white-space",
        OnceExit(root) {
          root.raws.after = "";
          root.walk((node) => {
            node.raws.before = "";
            if (node.type === "decl") {
              node.raws.between = ":";
              node.value = tight(node.value);
              if (node.important) node.raws.important = "!important";
              return;
            }
            node.raws.between = "";
            node.raws.after = "";
            node.raws.semicolon = false;
            if (node.type === "rule") {
              node.selector = tight(node.selector);
            } else if (node.type === "atrule") {
              node.params = tight(node.params);
              node.raws.afterName = node.params ? " " : "";
            }
          });
        },
      },
    ],
  },
};
