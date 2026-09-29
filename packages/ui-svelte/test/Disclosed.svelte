<script lang="ts">
  import {
    AccordionItem,
    AccordionItemContent,
    AccordionItemIndicator,
    AccordionItemTrigger,
    AccordionRoot,
    CollapsibleContent,
    CollapsibleIndicator,
    CollapsibleRoot,
    CollapsibleTrigger,
  } from "../src/index.svelte.ts";

  /** A collapsible whose open state is bound and an accordion whose
   * value is, which is what `bind:open` and `bind:value` do for a
   * Svelte author. */
  let { read }: { read: (state: { open: boolean; value: string[] }) => void } = $props();

  let open = $state(false);
  let value = $state(["one"]);

  $effect(() => read({ open, value }));
</script>

<CollapsibleRoot id="more" bind:open data-test="collapsible">
  <CollapsibleTrigger>More<CollapsibleIndicator>+</CollapsibleIndicator></CollapsibleTrigger>
  <CollapsibleContent>Folded</CollapsibleContent>
</CollapsibleRoot>

<AccordionRoot id="faq" bind:value data-test="accordion">
  {#each ["one", "two"] as item (item)}
    <AccordionItem value={item}>
      <AccordionItemTrigger>{item}<AccordionItemIndicator>+</AccordionItemIndicator></AccordionItemTrigger>
      <AccordionItemContent>{item} body</AccordionItemContent>
    </AccordionItem>
  {/each}
</AccordionRoot>
