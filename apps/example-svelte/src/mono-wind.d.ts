// Teach Svelte's templates about the <mono-wind> custom element: an
// ordinary element with ordinary attributes.
import type { HTMLAttributes } from "svelte/elements";

declare module "svelte/elements" {
  interface SvelteHTMLElements {
    "mono-wind": HTMLAttributes<HTMLElement>;
  }
}
