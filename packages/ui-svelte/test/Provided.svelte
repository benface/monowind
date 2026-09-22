<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import {
    ComboboxContent,
    ComboboxControl,
    ComboboxInput,
    ComboboxRootProvider,
    DialogContent,
    DialogPositioner,
    DialogRootProvider,
    DialogTrigger,
    ListboxContent,
    ListboxRootProvider,
    MenuContent,
    MenuPositioner,
    MenuRootProvider,
    MenuTrigger,
    PopoverContent,
    PopoverPositioner,
    PopoverRootProvider,
    PopoverTrigger,
    SelectContent,
    SelectControl,
    SelectHiddenSelect,
    SelectItem,
    SelectItemText,
    SelectPositioner,
    SelectRootProvider,
    SelectTrigger,
    SelectValueText,
    TooltipContent,
    TooltipPositioner,
    TooltipRootProvider,
    TooltipTrigger,
    createCombobox,
    createDialog,
    createListbox,
    createMenu,
    createPopover,
    createSelect,
    createTooltip,
  } from "../src/index.svelte.ts";

  /** A select over an API this component holds, which is what a
   * `RootProvider` is for: the test drives the machine from outside
   * the tree. */
  let { ready }: { ready: (api: ReturnType<typeof createSelect>) => void } = $props();

  const items = collection({ items: ["main", "next"] });
  const select = createSelect({ id: "branch", collection: items });
  // Every other provider too: handing an API over is the same move,
  // and mounting them is what compiles them.
  const menu = createMenu({ id: "held-menu" });
  const dialog = createDialog({ id: "held-dialog" });
  const popover = createPopover({ id: "held-popover" });
  const tooltip = createTooltip({ id: "held-tooltip" });
  const listbox = createListbox({ id: "held-listbox", collection: items });
  const combobox = createCombobox({ id: "held-combobox", collection: items });
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

<MenuRootProvider value={menu}>
  <MenuTrigger>File</MenuTrigger>
  <MenuPositioner><MenuContent /></MenuPositioner>
</MenuRootProvider>

<DialogRootProvider value={dialog}>
  <DialogTrigger>Delete</DialogTrigger>
  <DialogPositioner><DialogContent /></DialogPositioner>
</DialogRootProvider>

<PopoverRootProvider value={popover}>
  <PopoverTrigger>Note</PopoverTrigger>
  <PopoverPositioner><PopoverContent /></PopoverPositioner>
</PopoverRootProvider>

<TooltipRootProvider value={tooltip}>
  <TooltipTrigger>Hover</TooltipTrigger>
  <TooltipPositioner><TooltipContent /></TooltipPositioner>
</TooltipRootProvider>

<ListboxRootProvider value={listbox}><ListboxContent /></ListboxRootProvider>

<ComboboxRootProvider value={combobox}>
  <ComboboxControl><ComboboxInput /></ComboboxControl>
  <ComboboxContent />
</ComboboxRootProvider>
