<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, accordionContext, type AccordionApi } from "./context.ts";

  /** An accordion over an API the caller holds, for reaching it from
   * outside the tree: run `createAccordion()` yourself and hand it
   * over. */
  let { value, children }: { value: AccordionApi; children?: Snippet } = $props();

  accordionContext.set(live(() => value));
</script>

{@render children?.()}
