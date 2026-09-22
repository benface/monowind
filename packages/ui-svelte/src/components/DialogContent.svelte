<script lang="ts">
  import Part from "./Part.svelte";
  import { dialogContext, type PartProps } from "./context.ts";

  let { children, child, ...rest }: PartProps = $props();

  const dialog = dialogContext.use();
</script>

<Part tag="div" props={dialog.api.getContentProps()} {children} {child} {...rest} />
