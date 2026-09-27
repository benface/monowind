/** Vite's `css` option for every build that inlines CSS as a string
 * (`?inline`): its comments dropped, minified or not. */
export const css = {
  postcss: {
    plugins: [{ postcssPlugin: "strip-comments", Comment: (comment) => void comment.remove() }],
  },
};
