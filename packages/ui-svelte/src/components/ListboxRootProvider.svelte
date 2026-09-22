<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, listboxContext, type ListboxApi } from "./context.ts";

  /** A listbox over an API the caller holds, for reaching it from
   * outside the tree: run `createListbox()` yourself and hand it over. */
  let { value, children }: { value: ListboxApi; children?: Snippet } = $props();

  listboxContext.set(live(() => value));
</script>

{@render children?.()}
