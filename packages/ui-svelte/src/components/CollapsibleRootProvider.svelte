<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, collapsibleContext, type CollapsibleApi } from "./context.ts";

  /** A collapsible over an API the caller holds, for reaching it from
   * outside the tree: run `createCollapsible()` yourself and hand it
   * over. */
  let { value, children }: { value: CollapsibleApi; children?: Snippet } = $props();

  collapsibleContext.set(live(() => value));
</script>

{@render children?.()}
