<script lang="ts">
  import { onMount } from "svelte";
  import { collection } from "@monowind/ui/listbox";
  import { createSelect, SelectHiddenSelect, SelectRootProvider } from "../src/index.svelte.ts";

  /** A select with only its hidden control, in a form: the items and
   * the name the test changes, and the API it drives, through
   * `change`. */
  let {
    id,
    initial,
    multiple = false,
    defaultValue,
    change,
  }: {
    id: string;
    initial: string[];
    multiple?: boolean;
    defaultValue?: string[];
    change: (to: {
      items(next: string[]): void;
      name(next: string): void;
      api(): ReturnType<typeof createSelect>["api"];
    }) => void;
  } = $props();

  let items = $derived(collection({ items: initial }));
  let name = $state("branches");
  const select = createSelect(() => ({
    id,
    collection: items,
    multiple,
    name,
    ...(defaultValue ? { defaultValue } : {}),
  }));
  onMount(() =>
    change({
      items: (next) => (items = collection({ items: next })),
      name: (next) => (name = next),
      api: () => select.api,
    }),
  );
</script>

<form>
  <SelectRootProvider value={select}>
    <SelectHiddenSelect />
  </SelectRootProvider>
</form>
