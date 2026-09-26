<script lang="ts">
  import type { Snippet } from "svelte";
  import { listContext, live, selectContext, type SelectApi } from "./context.ts";

  /** A select over an API the caller holds, for reaching it from
   * outside the tree: run `createSelect()` yourself and hand it over. */
  let { value, children }: { value: SelectApi; children?: Snippet } = $props();

  const held = live(() => value);
  selectContext.set(held);
  listContext.set(held);
</script>

{@render children?.()}
