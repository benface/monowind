<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import { ListboxItemText, ListboxRoot, SelectItem } from "../src/index.svelte.ts";

  /** A listbox holding a select's item, or an item's text with no item
   * around it. */
  let { stray = false }: { stray?: boolean } = $props();

  const items = collection({ items: ["main"] });
</script>

<ListboxRoot id="mixed" collection={items}>
  {#if stray}
    <ListboxItemText>main</ListboxItemText>
  {:else}
    <SelectItem value="main">main</SelectItem>
  {/if}
</ListboxRoot>
