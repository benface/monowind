<script lang="ts">
  import Part from "./Part.svelte";
  import { accordionContext, accordionItemContext, type PartProps } from "./context.ts";

  /** An item, by its value, held for the parts inside it. */
  let {
    value,
    disabled,
    children,
    child,
    ...rest
  }: PartProps & {
    value: string;
    disabled?: boolean | undefined;
  } = $props();

  const accordion = accordionContext.use();
  const item = $derived({ value, disabled });
  accordionItemContext.set(() => item);
</script>

<Part props={accordion.api.getItemProps(item)} {children} {child} {...rest} />
