<script lang="ts">
  import {
    ComboboxControl,
    ComboboxInput,
    ComboboxRoot,
    DialogContent,
    DialogPositioner,
    DialogRoot,
    DialogTrigger,
    MenuContent,
    MenuItem,
    MenuPositioner,
    MenuRoot,
    MenuTrigger,
  } from "../src/index.svelte.ts";
  import { collection } from "@monowind/ui/combobox";

  /** A menu's and a dialog's trigger values and a combobox's input
   * value, each bound, which is what `bind:` does for a Svelte author. */
  let {
    read,
  }: {
    read: (state: { menu?: string; dialog?: string; input?: string }) => void;
  } = $props();

  let menu = $state<string | undefined>();
  let dialog = $state<string | undefined>();
  let input = $state<string | undefined>();
  const items = collection({ items: ["main", "next"] });

  $effect(() => read({ menu, dialog, input }));
</script>

<MenuRoot id="bound-menu" bind:triggerValue={menu}>
  <MenuTrigger value="a">a</MenuTrigger>
  <MenuTrigger value="b">b</MenuTrigger>
  <MenuPositioner><MenuContent><MenuItem value="x">x</MenuItem></MenuContent></MenuPositioner>
</MenuRoot>
<DialogRoot id="bound-dialog" bind:triggerValue={dialog}>
  <DialogTrigger value="a">a</DialogTrigger>
  <DialogTrigger value="b">b</DialogTrigger>
  <DialogPositioner><DialogContent>shared</DialogContent></DialogPositioner>
</DialogRoot>
<ComboboxRoot id="bound-combobox" collection={items} bind:inputValue={input}>
  <ComboboxControl><ComboboxInput /></ComboboxControl>
</ComboboxRoot>
