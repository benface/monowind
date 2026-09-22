<script lang="ts">
  import type { Snippet } from "svelte";
  import { live, menuContext, type MenuApi } from "./context.ts";

  /** A menu over an API the caller holds, for reaching it from outside
   * the tree: run `createMenu()` yourself and hand it over. */
  let { value, children }: { value: MenuApi; children?: Snippet } = $props();

  const parent = menuContext.useOptional();
  const held = live(() => value);
  menuContext.set({ menu: held, parent: parent ?? null, props: null });
</script>

{@render children?.()}
