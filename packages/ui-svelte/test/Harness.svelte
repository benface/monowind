<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import {
    ComboboxClearTrigger,
    ComboboxContent,
    ComboboxControl,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemGroup,
    ComboboxItemGroupLabel,
    ComboboxItemIndicator,
    ComboboxItemText,
    ComboboxLabel,
    ComboboxList,
    ComboboxPositioner,
    ComboboxRoot,
    ComboboxTrigger,
    DialogCloseTrigger,
    DialogContent,
    DialogDescription,
    DialogPositioner,
    DialogRoot,
    DialogTitle,
    DialogTrigger,
    ListboxContent,
    ListboxItem,
    ListboxItemGroup,
    ListboxItemGroupLabel,
    ListboxItemIndicator,
    ListboxItemText,
    ListboxLabel,
    ListboxRoot,
    MenuContent,
    MenuItem,
    MenuItemGroup,
    MenuItemGroupLabel,
    MenuPositioner,
    MenuRoot,
    MenuSeparator,
    MenuTrigger,
    MenuTriggerItem,
    PopoverCloseTrigger,
    PopoverContent,
    PopoverDescription,
    PopoverIndicator,
    PopoverPositioner,
    PopoverRoot,
    PopoverTitle,
    PopoverTrigger,
    SelectClearTrigger,
    SelectContent,
    SelectControl,
    SelectHiddenSelect,
    SelectIndicator,
    SelectItem,
    SelectItemGroup,
    SelectItemGroupLabel,
    SelectItemIndicator,
    SelectItemText,
    SelectLabel,
    SelectList,
    SelectPositioner,
    SelectRoot,
    SelectTrigger,
    SelectValueText,
    TooltipContent,
    TooltipPositioner,
    TooltipRoot,
    TooltipTrigger,
  } from "../src/index.svelte.ts";

  /** Every component the package ships, in one tree: the test reads
   * the DOM they render. */
  let { picked = $bindable("") }: { picked?: string } = $props();

  const items = collection({ items: ["main", "next"] });
</script>

<MenuRoot id="file" onSelect={({ value }) => (picked = value)}>
  <MenuTrigger>File</MenuTrigger>
  <MenuPositioner>
    <MenuContent>
      <MenuItemGroup id="edit">
        <MenuItemGroupLabel htmlFor="edit">Edit</MenuItemGroupLabel>
        <MenuItem value="new">New</MenuItem>
      </MenuItemGroup>
      <MenuSeparator />
      <MenuRoot id="share">
        <MenuTriggerItem>Share</MenuTriggerItem>
        <MenuPositioner>
          <MenuContent>
            <MenuItem value="mail">Mail</MenuItem>
          </MenuContent>
        </MenuPositioner>
      </MenuRoot>
    </MenuContent>
  </MenuPositioner>
</MenuRoot>

<DialogRoot id="confirm">
  <DialogTrigger>Delete</DialogTrigger>
  <DialogPositioner>
    <DialogContent action="/delete" method="post">
      {#snippet child(props)}
        <form {...props} data-test="form">
          <DialogTitle>Delete the file?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
          <DialogCloseTrigger class="from-part">
            {#snippet child(props)}
              <button {...props} data-test="close" class={[props["class"], "from-child"]}>
                Cancel
              </button>
            {/snippet}
          </DialogCloseTrigger>
        </form>
      {/snippet}
    </DialogContent>
  </DialogPositioner>
</DialogRoot>

<ListboxRoot id="branch" collection={items} class="border" data-test="listbox">
  <ListboxLabel>Branch</ListboxLabel>
  <ListboxContent>
    <ListboxItemGroup id="local">
      <ListboxItemGroupLabel htmlFor="local">Local</ListboxItemGroupLabel>
    </ListboxItemGroup>
    {#each items.items as value (value)}
      <ListboxItem {value}>
        <ListboxItemIndicator>*</ListboxItemIndicator>
        <ListboxItemText>{value}</ListboxItemText>
      </ListboxItem>
    {/each}
  </ListboxContent>
</ListboxRoot>

<ComboboxRoot id="find" collection={items} placeholder="branch…">
  <ComboboxLabel>Find</ComboboxLabel>
  <ComboboxControl>
    <ComboboxInput />
    <ComboboxTrigger>▼</ComboboxTrigger>
    <ComboboxClearTrigger>×</ComboboxClearTrigger>
  </ComboboxControl>
  <ComboboxPositioner>
    <ComboboxContent>
      <ComboboxList>
        <ComboboxItemGroup id="local">
          <ComboboxItemGroupLabel htmlFor="local">Local</ComboboxItemGroupLabel>
        </ComboboxItemGroup>
        {#each items.items as value (value)}
          <ComboboxItem {value}>
            <ComboboxItemIndicator>*</ComboboxItemIndicator>
            <ComboboxItemText>{value}</ComboboxItemText>
          </ComboboxItem>
        {/each}
      </ComboboxList>
    </ComboboxContent>
  </ComboboxPositioner>
</ComboboxRoot>

<SelectRoot id="pick" collection={items} name="branch">
  <SelectLabel>Branch</SelectLabel>
  <SelectControl>
    <SelectClearTrigger>×</SelectClearTrigger>
    <SelectTrigger>
      <SelectValueText />
      <SelectIndicator>▾</SelectIndicator>
    </SelectTrigger>
  </SelectControl>
  <SelectPositioner>
    <SelectContent>
      <SelectList>
        <SelectItemGroup id="local">
          <SelectItemGroupLabel htmlFor="local">Local</SelectItemGroupLabel>
        </SelectItemGroup>
        {#each items.items as value (value)}
          <SelectItem {value}>
            <SelectItemIndicator>*</SelectItemIndicator>
            <SelectItemText>{value}</SelectItemText>
          </SelectItem>
        {/each}
      </SelectList>
    </SelectContent>
  </SelectPositioner>
  <SelectHiddenSelect />
</SelectRoot>

<PopoverRoot id="note">
  <PopoverTrigger>Note<PopoverIndicator>▾</PopoverIndicator></PopoverTrigger>
  <PopoverPositioner>
    <PopoverContent>
      <PopoverTitle>A note</PopoverTitle>
      <PopoverDescription>Something worth saying.</PopoverDescription>
      <PopoverCloseTrigger>Close</PopoverCloseTrigger>
    </PopoverContent>
  </PopoverPositioner>
</PopoverRoot>

<TooltipRoot id="hint">
  <TooltipTrigger>Hover</TooltipTrigger>
  <TooltipPositioner>
    <TooltipContent>Saves the document</TooltipContent>
  </TooltipPositioner>
</TooltipRoot>
