<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import {
    SelectContent,
    SelectControl,
    SelectHiddenSelect,
    SelectItem,
    SelectItemText,
    SelectPositioner,
    SelectRootProvider,
    SelectTrigger,
    SelectValueText,
    createSelect,
  } from "../src/index.svelte.ts";

  /** A select over an API this component holds, which is what a
   * `RootProvider` is for: the test drives the machine from outside
   * the tree. */
  let { ready }: { ready: (api: ReturnType<typeof createSelect>) => void } = $props();

  const items = collection({ items: ["main", "next"] });
  const select = createSelect({ id: "branch", collection: items });
  $effect(() => ready(select));
</script>

<SelectRootProvider value={select}>
  <SelectControl>
    <SelectTrigger><SelectValueText>branch…</SelectValueText></SelectTrigger>
  </SelectControl>
  <SelectPositioner>
    <SelectContent>
      {#each items.items as value (value)}
        <SelectItem {value}><SelectItemText>{value}</SelectItemText></SelectItem>
      {/each}
    </SelectContent>
  </SelectPositioner>
  <SelectHiddenSelect />
</SelectRootProvider>
