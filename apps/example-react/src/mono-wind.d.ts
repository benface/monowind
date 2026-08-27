// Teach React's JSX about the <mono-wind> custom element. (React 19 handles
// custom elements natively; this is purely a TypeScript declaration.)
// The import makes this file a module, so `declare module "react"` AUGMENTS
// React's types — as a global script it would replace them instead.
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "mono-wind": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
