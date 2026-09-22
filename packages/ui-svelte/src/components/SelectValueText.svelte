<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  /** The trigger's text: what is selected, or the children as the
   * placeholder while nothing is — as the mount writes it. */
  let { children, child, ...rest }: PartProps = $props();

  const select = selectContext.use();
  const selected = $derived(select.api.valueAsString);
</script>

<Part tag="span" props={select.api.getValueTextProps()} {child} {...rest}>
  {#snippet children()}
    {#if selected}{selected}{:else}{@render children?.()}{/if}
  {/snippet}
</Part>
