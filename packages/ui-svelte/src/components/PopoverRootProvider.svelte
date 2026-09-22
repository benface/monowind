<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, popoverContext, type PopoverApi } from "./context.ts";

  /** A popover over an API the caller holds, for reaching it from
   * outside the tree: run `createPopover()` yourself and hand it over. */
  let { value, children }: { value: PopoverApi; children?: Snippet } = $props();

  popoverContext.set(live(() => value));
</script>

{@render children?.()}
