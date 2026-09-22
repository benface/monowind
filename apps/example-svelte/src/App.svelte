<script lang="ts">
  import {
    collection,
    DialogCloseTrigger,
    DialogContent,
    DialogDescription,
    DialogPositioner,
    DialogRoot,
    DialogTitle,
    DialogTrigger,
    MenuContent,
    MenuItem,
    MenuPositioner,
    MenuRoot,
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
  } from "@monowind/ui-svelte";

  // Svelte owns the light DOM (runes updating the text in place);
  // monowind reads it and lays it out on the character grid. The counter
  // proves the whole loop: click → the rune rewrites the text → monowind
  // observes the mutation → relayout, without Svelte ever noticing the
  // engine.
  let count = $state(0);
  let picked = $state("nothing yet");

  const item = "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500";

  const branches = collection({ items: ["main", "next", "release"] });
</script>

<mono-wind>
  <div class="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
    <div>
      count is <b class="text-yellow-400">{count}</b>
    </div>
    <button class="cursor-pointer" onclick={() => (count += 1)}>increment</button>
  </div>
  <div class="mt-1 flex items-center gap-2">
    <!-- A menu from @monowind/ui-svelte: the positioner part carries
         the action that keeps it in the top layer, and a nested
         MenuRoot is this menu's submenu. -->
    <MenuRoot positioning={{ placement: "bottom-start" }} onSelect={({ value }) => (picked = value)}>
      <MenuTrigger class="border px-1">File</MenuTrigger>
      <MenuPositioner>
        <MenuContent class="border bg-clear">
          <MenuItem value="new" class={item}>New</MenuItem>
          <MenuItem value="open" class={item}>Open…</MenuItem>
          <MenuItem value="save" disabled class={item}>Save</MenuItem>
          <MenuRoot>
            <MenuTriggerItem class={item}>Share ›</MenuTriggerItem>
            <MenuPositioner>
              <MenuContent class="border bg-clear">
                <MenuItem value="mail" class={item}>Mail</MenuItem>
                <MenuItem value="link" class={item}>Copy link</MenuItem>
              </MenuContent>
            </MenuPositioner>
          </MenuRoot>
        </MenuContent>
      </MenuPositioner>
    </MenuRoot>
    <!-- A dialog the same way, its backdrop the engine's to draw; the
         `child` snippet puts a part's props on an element of your own,
         which is Svelte's stand-in for asChild. -->
    <DialogRoot>
      <DialogTrigger class="border px-1">Delete</DialogTrigger>
      <DialogPositioner class="backdrop:bg-black/50">
        <DialogContent class="border px-1">
          <DialogTitle class="font-bold">Delete the file?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
          <p class="mt-1 flex gap-2">
            <DialogCloseTrigger class="border px-1">Cancel</DialogCloseTrigger>
            <DialogCloseTrigger class="border px-1">
              {#snippet child(props)}
                <button {...props}>Delete</button>
              {/snippet}
            </DialogCloseTrigger>
          </p>
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
    <!-- A select: a listbox on a trigger, its own root element in the
         flow and its list in the top layer, with a native control for
         a form. -->
    <SelectRoot collection={branches} name="branch">
      <SelectControl>
        <SelectTrigger class="border px-1">
          <SelectValueText>branch…</SelectValueText>
          <SelectIndicator class="ml-1">▼</SelectIndicator>
        </SelectTrigger>
      </SelectControl>
      <SelectPositioner>
        <SelectContent class="border bg-clear">
          {#each branches.items as value (value)}
            <SelectItem {value} class={item}><SelectItemText>{value}</SelectItemText></SelectItem>
          {/each}
        </SelectContent>
      </SelectPositioner>
      <SelectHiddenSelect />
    </SelectRoot>
    <span>picked <b class="text-yellow-400">{picked}</b></span>
  </div>
  {#each { length: 6 } as _, i}
    <p>Line {i + 1} of the page, under the menu.</p>
  {/each}
</mono-wind>
