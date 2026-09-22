<script lang="ts">
  import Part from "./Part.svelte";
  import { defined, menuContext, type PartProps } from "./context.ts";

  let {
    value,
    disabled,
    closeOnSelect,
    valueText,
    children,
    child,
    ...rest
  }: PartProps & {
    value: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    valueText?: string;
  } = $props();

  const { menu } = menuContext.use();
  const own = $derived(defined({ value, disabled, closeOnSelect, valueText }) as { value: string });
</script>

<Part tag="div" props={menu.api.getItemProps(own)} {children} {child} {...rest} />
