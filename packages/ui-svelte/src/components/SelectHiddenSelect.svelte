<script lang="ts">
  import { mergeProps } from "@zag-js/svelte";
  import { selectContext } from "./context.ts";

  /** The native select a form submits, an option per item: out of the
   * grid, a `display: none` control being one the layout skips and a
   * form still posts (Zag hides it visually, which would take
   * cells). */
  let rest: Record<string, unknown> = $props();

  const select = selectContext.use();
  const props = $derived(
    mergeProps(
      { ...select.api.getHiddenSelectProps(), style: "display: none" },
      rest,
    ) as Record<string, unknown>,
  );
</script>

<select {...props}>
  {#each select.api.collection.getValues() as value (value)}
    <option {value}></option>
  {/each}
</select>
