<script lang="ts">
  import { collection } from "@monowind/ui/listbox";
  import {
    DialogCloseTrigger,
    DialogContent,
    DialogPositioner,
    DialogRoot,
    DialogTitle,
    DialogTrigger,
    ListboxContent,
    ListboxItem,
    ListboxItemIndicator,
    ListboxItemText,
    ListboxLabel,
    ListboxRoot,
    MenuContent,
    MenuItem,
    MenuPositioner,
    MenuRoot,
    MenuSeparator,
    MenuTrigger,
    MenuTriggerItem,
    SelectContent,
    SelectControl,
    SelectHiddenSelect,
    SelectIndicator,
    SelectItem,
    SelectItemText,
    SelectPositioner,
    SelectRoot,
    SelectTrigger,
    SelectValueText,
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
      <MenuItem value="new">New</MenuItem>
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
    <DialogContent>
      <DialogTitle>Delete the file?</DialogTitle>
      <DialogCloseTrigger class="from-part">
        {#snippet child(props)}
          <button {...props} data-test="close" class={[props["class"], "from-child"]}>
            Cancel
          </button>
        {/snippet}
      </DialogCloseTrigger>
    </DialogContent>
  </DialogPositioner>
</DialogRoot>

<ListboxRoot id="branch" collection={items} class="border" data-test="listbox">
  <ListboxLabel>Branch</ListboxLabel>
  <ListboxContent>
    {#each items.items as value (value)}
      <ListboxItem {value}>
        <ListboxItemIndicator>*</ListboxItemIndicator>
        <ListboxItemText>{value}</ListboxItemText>
      </ListboxItem>
    {/each}
  </ListboxContent>
</ListboxRoot>

<SelectRoot id="pick" collection={items} name="branch">
  <SelectControl>
    <SelectTrigger>
      <SelectValueText />
      <SelectIndicator>▾</SelectIndicator>
    </SelectTrigger>
  </SelectControl>
  <SelectPositioner>
    <SelectContent>
      {#each items.items as value (value)}
        <SelectItem {value}><SelectItemText>{value}</SelectItemText></SelectItem>
      {/each}
    </SelectContent>
  </SelectPositioner>
  <SelectHiddenSelect />
</SelectRoot>
