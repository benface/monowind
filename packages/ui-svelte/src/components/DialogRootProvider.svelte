<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, dialogContext, type DialogApi } from "./context.ts";

  /** A dialog over an API the caller holds, for reaching it from
   * outside the tree: run `createDialog()` yourself and hand it over. */
  let { value, children }: { value: DialogApi; children?: Snippet } = $props();

  dialogContext.set(live(() => value));
</script>

{@render children?.()}
