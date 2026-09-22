<script lang="ts">
  import Part from "./Part.svelte";
  import { menuContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const { menu } = menuContext.use();
</script>

<Part tag="hr" props={menu.api.getSeparatorProps()} {children} {child} {...rest} />
