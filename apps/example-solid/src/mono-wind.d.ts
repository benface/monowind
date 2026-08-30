// Teach Solid's JSX about the <mono-wind> custom element. In Solid 2.0 the
// renderer package owns the JSX types (tsconfig's jsxImportSource is
// @solidjs/web), so its jsx-runtime module is the one to augment. The
// import makes this file a module, so the declaration AUGMENTS the
// namespace — as a global script it would replace it instead.
import "@solidjs/web/jsx-runtime";

declare module "@solidjs/web/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "mono-wind": HTMLAttributes<HTMLElement>;
    }
  }
}
