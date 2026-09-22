<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, menuContext, type PartProps } from "./context.ts";

  let {
    htmlFor,
    children,
    child,
    ...rest
  }: PartProps & {
    htmlFor: string;
  } = $props();

  const { menu } = menuContext.use();
  const own = $derived(defined({ htmlFor }) as { htmlFor: string });
</script>

<Part tag="div" props={menu.api.getItemGroupLabelProps(own)} {children} {child} {...rest} />
