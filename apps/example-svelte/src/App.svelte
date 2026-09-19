<script lang="ts">
  import { createDialog, createMenu } from "@monowind/ui-svelte";

  // Svelte owns the light DOM (runes updating the text in place);
  // monowind reads it and lays it out on the character grid. The counter
  // proves the whole loop: click → the rune rewrites the text → monowind
  // observes the mutation → relayout, without Svelte ever noticing the
  // engine.
  let count = $state(0);
  let picked = $state("nothing yet");

  // A menu and a dialog from @monowind/ui-svelte, each positioner kept
  // in the top layer by its action.
  const menu = createMenu({
    id: "file",
    positioning: { placement: "bottom-start" },
    onSelect: ({ value }) => (picked = value),
  });
  const dialog = createDialog({ id: "confirm" });

  const item = "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500";
</script>

<mono-wind>
  <div class="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
    <div>
      count is <b class="text-yellow-400">{count}</b>
    </div>
    <button class="cursor-pointer" onclick={() => (count += 1)}>increment</button>
  </div>
  <div class="mt-1 flex items-center gap-2">
    <button {...menu.api.getTriggerProps()} class="border px-1">File</button>
    <div use:menu.positioner {...menu.api.getPositionerProps()}>
      <div {...menu.api.getContentProps()} class="border bg-clear">
        <div {...menu.api.getItemProps({ value: "new" })} class={item}>New</div>
        <div {...menu.api.getItemProps({ value: "open" })} class={item}>Open…</div>
        <div {...menu.api.getItemProps({ value: "save", disabled: true })} class={item}>Save</div>
      </div>
    </div>
    <button {...dialog.api.getTriggerProps()} class="border px-1">Delete</button>
    <div use:dialog.positioner {...dialog.api.getPositionerProps()} class="backdrop:bg-black/50">
      <div {...dialog.api.getContentProps()} class="border px-1">
        <p {...dialog.api.getTitleProps()} class="font-bold">Delete the file?</p>
        <p {...dialog.api.getDescriptionProps()}>This cannot be undone.</p>
        <p class="mt-1 flex gap-2">
          <button {...dialog.api.getCloseTriggerProps()} class="border px-1">Cancel</button>
          <button class="border px-1" onclick={() => dialog.api.setOpen(false)}>Delete</button>
        </p>
      </div>
    </div>
    <span>picked <b class="text-yellow-400">{picked}</b></span>
  </div>
  {#each { length: 6 } as _, i}
    <p>Line {i + 1} of the page, under the menu.</p>
  {/each}
</mono-wind>
