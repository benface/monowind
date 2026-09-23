<script lang="ts">
  import { mergeProps } from "@zag-js/svelte";
  import type { Action } from "svelte/action";
  import type { Snippet } from "svelte";

  /**
   * The floating part: it renders its own element, which carries the
   * action that keeps it in the top layer with the machine.
   */
  let {
    tag = "div",
    props,
    positioner,
    children,
    ...rest
  }: {
    tag?: string;
    /** The API's props for the part, whatever the getter types them as. */
    props: object;
    positioner: Action<HTMLElement>;
    children?: Snippet | undefined;
    [key: string]: unknown;
  } = $props();

  const merged = $derived(mergeProps(props as Record<string, unknown>, rest) as Record<string, unknown>);
</script>

<svelte:element this={tag} {...merged} use:positioner>{@render children?.()}</svelte:element>
