<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, tooltipContext, type TooltipApi } from "./context.ts";

  /** A tooltip over an API the caller holds, for reaching it from
   * outside the tree: run `createTooltip()` yourself and hand it over. */
  let { value, children }: { value: TooltipApi; children?: Snippet } = $props();

  tooltipContext.set(live(() => value));
</script>

{@render children?.()}
