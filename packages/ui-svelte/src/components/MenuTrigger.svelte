<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, menuContext, type PartProps } from "./context.ts";

  let {
    value,
    children,
    child,
    ...rest
  }: PartProps & {
    value?: string;
  } = $props();

  const { menu } = menuContext.use();
  const own = $derived(defined({ value }) as {  });
</script>

<Part tag="button" props={menu.api.getTriggerProps(own)} {children} {child} {...rest} />
