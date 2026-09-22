<script lang="ts">
  import type { Snippet } from "svelte";
  import { comboboxContext, live, type ComboboxApi } from "./context.ts";

  /** A combobox over an API the caller holds, for reaching it from
   * outside the tree: run `createCombobox()` yourself and hand it
   * over. */
  let { value, children }: { value: ComboboxApi; children?: Snippet } = $props();

  comboboxContext.set(live(() => value));
</script>

{@render children?.()}
