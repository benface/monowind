<script lang="ts">
  import type { Snippet } from "svelte";
  import { comboboxContext, listContext, live, type ComboboxApi } from "./context.ts";

  /** A combobox over an API the caller holds, for reaching it from
   * outside the tree: run `createCombobox()` yourself and hand it
   * over. */
  let { value, children }: { value: ComboboxApi; children?: Snippet } = $props();

  const held = live(() => value);
  comboboxContext.set(held);
  listContext.set(held);
</script>

{@render children?.()}
