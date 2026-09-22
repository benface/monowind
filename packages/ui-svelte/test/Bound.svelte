<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import {
    SelectContent,
    SelectControl,
    SelectItem,
    SelectItemText,
    SelectPositioner,
    SelectRoot,
    SelectTrigger,
    SelectValueText,
  } from "../src/index.svelte.ts";

  /** A select whose open state and value are bound, which is what
   * `bind:open` and `bind:value` do for a Svelte author. */
  let { read }: { read: (state: { open: boolean; value: string[] }) => void } = $props();

  const items = collection({ items: ["main", "next"] });
  let open = $state(false);
  let value = $state<string[]>([]);

  $effect(() => read({ open, value }));
</script>

<SelectRoot id="bound" collection={items} bind:open bind:value>
  <SelectControl>
    <SelectTrigger><SelectValueText>branch…</SelectValueText></SelectTrigger>
  </SelectControl>
  <SelectPositioner>
    <SelectContent>
      {#each items.items as branch (branch)}
        <SelectItem value={branch}><SelectItemText>{branch}</SelectItemText></SelectItem>
      {/each}
    </SelectContent>
  </SelectPositioner>
</SelectRoot>
