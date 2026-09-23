<script lang="ts">
  import { mergeProps } from "@zag-js/svelte";
  import type { PartProps } from "./context.ts";

  /**
   * A part's element, with the API's props under the author's — merged
   * by Zag's own `mergeProps`, so the class reads API-first and a
   * handler of the author's runs before the API's. A snippet renders
   * DOM rather than describing it, so Svelte's stand-in for `asChild`
   * is `child`: the part hands it those props to spread itself.
   */
  let {
    tag = "div",
    props,
    children,
    child,
    ...rest
  }: PartProps & {
    tag?: string;
    /** The API's props for the part, whatever the getter types them as. */
    props: object;
  } = $props();

  const merged = $derived(mergeProps(props as Record<string, unknown>, rest) as Record<string, unknown>);
</script>

{#if child}
  {@render child(merged)}
{:else if children}
  <svelte:element this={tag} {...merged}>{@render children()}</svelte:element>
{:else}
  <svelte:element this={tag} {...merged}></svelte:element>
{/if}
