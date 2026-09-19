<script setup lang="ts">
import { useDialog, useMenu } from "@monowind/ui-vue";
import { ref } from "vue";

// Vue owns the light DOM (reactive state patching the text in place);
// monowind reads it and lays it out on the character grid. The counter
// proves the whole loop: click → the ref rewrites the text → monowind
// observes the mutation → relayout, without Vue ever noticing the engine.
const count = ref(0);
const picked = ref("nothing yet");

// A menu and a dialog from @monowind/ui-vue, each positioner kept in
// the top layer by its ref.
const { api: menu, positioner: menuPositioner } = useMenu({
  id: "file",
  positioning: { placement: "bottom-start" },
  onSelect: ({ value }) => (picked.value = value),
});
const { api: dialog, positioner: dialogPositioner } = useDialog({ id: "confirm" });

const item =
  "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500";
</script>

<template>
  <mono-wind>
    <div class="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
      <div>
        count is <b class="text-yellow-400">{{ count }}</b>
      </div>
      <button class="cursor-pointer" @click="count += 1">increment</button>
    </div>
    <div class="mt-1 flex items-center gap-2">
      <button v-bind="menu.getTriggerProps()" class="border px-1">File</button>
      <div ref="menuPositioner" v-bind="menu.getPositionerProps()">
        <div v-bind="menu.getContentProps()" class="border bg-clear">
          <div v-bind="menu.getItemProps({ value: 'new' })" :class="item">New</div>
          <div v-bind="menu.getItemProps({ value: 'open' })" :class="item">Open…</div>
          <div v-bind="menu.getItemProps({ value: 'save', disabled: true })" :class="item">
            Save
          </div>
        </div>
      </div>
      <button v-bind="dialog.getTriggerProps()" class="border px-1">Delete</button>
      <div ref="dialogPositioner" v-bind="dialog.getPositionerProps()" class="backdrop:bg-black/50">
        <div v-bind="dialog.getContentProps()" class="border px-1">
          <p v-bind="dialog.getTitleProps()" class="font-bold">Delete the file?</p>
          <p v-bind="dialog.getDescriptionProps()">This cannot be undone.</p>
          <p class="mt-1 flex gap-2">
            <button v-bind="dialog.getCloseTriggerProps()" class="border px-1">Cancel</button>
            <button class="border px-1" @click="dialog.setOpen(false)">Delete</button>
          </p>
        </div>
      </div>
      <span
        >picked <b class="text-yellow-400">{{ picked }}</b></span
      >
    </div>
    <p v-for="i in 6" :key="i">Line {{ i }} of the page, under the menu.</p>
  </mono-wind>
</template>
