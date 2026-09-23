<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, dialogContext, type PartProps } from "./context.ts";

  let {
    value,
    children,
    child,
    ...rest
  }: PartProps & {
    value?: string;
  } = $props();

  const dialog = dialogContext.use();
  const own = $derived(defined({ value }));
</script>

<Part tag="button" props={dialog.api.getTriggerProps(own)} {children} {child} {...rest} />
