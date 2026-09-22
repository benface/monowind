<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, menuContext, type PartProps } from "./context.ts";

  let {
    id,
    children,
    child,
    ...rest
  }: PartProps & {
    id: string;
  } = $props();

  const { menu } = menuContext.use();
  const own = $derived(defined({ id }) as { id: string });
</script>

<Part tag="div" props={menu.api.getItemGroupProps(own)} {children} {child} {...rest} />
