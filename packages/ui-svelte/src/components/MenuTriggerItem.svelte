<script lang="ts">
  import Part from "./Part.svelte";
  import { menuContext, type PartProps } from "./context.ts";

  /** The item of the menu above that opens this one: the submenu's own
   * trigger, which is why it goes inside the nested MenuRoot. */
  let { children, child, ...rest }: PartProps = $props();

  const { menu, parent } = menuContext.use();
  if (!parent) throw new Error("a MenuTriggerItem must be inside a nested <MenuRoot>");
</script>

<Part props={parent.menu.api.getTriggerItemProps(menu.api)} {children} {child} {...rest} />
