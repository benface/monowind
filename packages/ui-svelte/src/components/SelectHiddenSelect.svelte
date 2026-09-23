<script lang="ts">
  import { mergeProps } from "@zag-js/svelte";
  import { hiddenSelectOptions, syncHiddenSelect } from "@monowind/ui/select";
  import { selectContext } from "./context.ts";

  /** The native select a form submits, `display: none` so the layout
   * skips it and a form still posts it. Its first options are markup
   * Svelte writes once, for a server's page; after each change
   * `syncHiddenSelect` owns them, the selection and Zag's `value`
   * (specs/ui.md "A select is a listbox on a trigger"). */
  let rest: Record<string, unknown> = $props();

  const select = selectContext.use();
  const options = hiddenSelectOptions(select.api, select.service);
  let element = $state<HTMLSelectElement>();
  const attributes = $derived.by(() => {
    const { value: _value, ...hidden } = select.api.getHiddenSelectProps();
    return mergeProps({ ...hidden, size: 2, style: "display: none" }, rest) as Record<
      string,
      unknown
    >;
  });
  $effect(() => {
    const control = element;
    if (!control) return;
    syncHiddenSelect(control, select.api, select.service);
    // Svelte 5.20 to 5.56.7 selects a spread select's own `value`, none
    // here, a microtask after its options change.
    queueMicrotask(() => syncHiddenSelect(control, select.api, select.service));
  });
</script>

<select bind:this={element} {...attributes}>{@html options}</select>
