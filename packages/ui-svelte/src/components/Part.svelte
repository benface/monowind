<script lang="ts">
  import { mergeProps } from "@zag-js/svelte";
  import type { Action } from "svelte/action";
  import type { PartProps } from "./context.ts";

  /**
   * A part's element, with the API's props under the author's — merged
   * by Zag's own `mergeProps`, so the class reads API-first and a
   * handler of the author's runs before the API's. A snippet renders
   * DOM rather than describing it, so Svelte's stand-in for `asChild`
   * is `child`: the part hands it those props to spread itself. A
   * positioner renders its own element, which carries the action that
   * keeps it in the top layer with the machine.
   */
  let {
    tag = "div",
    props,
    positioner,
    children,
    child,
    ...rest
  }: PartProps & {
    tag?: string;
    /** The API's props for the part, whatever the getter types them as. */
    props: object;
    /** That action, named as no HTML attribute is: a part forwards
     * every attribute the author gives it. */
    positioner?: Action<HTMLElement> | undefined;
  } = $props();

  const merged = $derived(mergeProps(props as Record<string, unknown>, rest) as Record<string, unknown>);
</script>

{#if positioner}
  <svelte:element this={tag} {...merged} use:positioner>{@render children?.()}</svelte:element>
{:else if child}
  {@render child(merged)}
{:else if children}
  <svelte:element this={tag} {...merged}>{@render children()}</svelte:element>
{:else}
  <svelte:element this={tag} {...merged}></svelte:element>
{/if}
