<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, selectContext, type SelectApi } from "./context.ts";

  /** A select over an API the caller holds, for reaching it from
   * outside the tree: run `createSelect()` yourself and hand it over. */
  let { value, children }: { value: SelectApi; children?: Snippet } = $props();

  selectContext.set(live(() => value));
</script>

{@render children?.()}
