/** Silence lit's dev-mode banner: the test server serves the dev build
 * by design, and the line would otherwise repeat for every story file. */
const NOISE = [/Lit is in dev mode/];

const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (NOISE.some((pattern) => typeof args[0] === "string" && pattern.test(args[0]))) return;
  warn(...args);
};
