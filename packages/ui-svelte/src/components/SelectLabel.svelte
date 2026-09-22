<script lang="ts">
  import Part from "./Part.svelte";
  import { selectContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  // Zag normalizes a select's label as a <label> carrying htmlFor for
  // the hidden control, where a listbox's is a plain element: a span
  // here would drop the association a click needs.
  const select = selectContext.use();
</script>

<Part tag="label" props={select.api.getLabelProps()} {children} {child} {...rest} />
