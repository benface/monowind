import { expect, it } from "vitest";
import { computed, createApp, h, nextTick, ref } from "vue";
import { useDialog, useMenu } from "../src/index.ts";

/** The composables (specs/ui.md): the grid's props in the DOM Vue
 * renders, the positioner's ref handed back. */

// Vue's `h` and Zag's prop types disagree under exactOptionalPropertyTypes;
// the DOM is what the test reads.
const bind = (props: object): Record<string, unknown> => ({ ...props });

it("renders the grid's props and hands back the positioner's ref", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  let menuPositioner: HTMLElement | null = null;
  const app = createApp({
    setup() {
      const menu = useMenu({ id: "file", positioning: { placement: "top-end" } });
      const dialog = useDialog({ id: "confirm" });
      return () => {
        menuPositioner = menu.positioner.value;
        return h("div", [
          h("button", bind(menu.api.value.getTriggerProps()), "File"),
          h("div", { ...bind(menu.api.value.getPositionerProps()), ref: menu.positioner }, [
            h("div", bind(menu.api.value.getContentProps()), [
              h("div", bind(menu.api.value.getItemProps({ value: "new" })), "New"),
            ]),
          ]),
          h("button", bind(dialog.api.value.getTriggerProps()), "Delete"),
          h("div", { ...bind(dialog.api.value.getPositionerProps()), ref: dialog.positioner }, [
            h("div", bind(dialog.api.value.getContentProps()), "Delete?"),
          ]),
        ]);
      };
    },
  });
  app.mount(container);
  await nextTick();
  const [menuTrigger, dialogTrigger] = Array.from(
    container.querySelectorAll<HTMLElement>("button"),
  );
  const [positioner, dialogPositioner] = Array.from(
    container.querySelectorAll<HTMLElement>("[data-part='positioner']"),
  );
  expect(menuTrigger!.style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
  expect(positioner!.getAttribute("popover")).toBe("manual");
  expect(positioner!.style.getPropertyValue("position-area")).toBe("top span-left");
  expect(dialogTrigger!.getAttribute("aria-haspopup")).toBe("dialog");
  expect(dialogPositioner!.getAttribute("popover")).toBe("manual");
  expect(container.querySelector("[role='menu']")).not.toBeNull();
  await nextTick();
  expect(menuPositioner).toBe(positioner);
  app.unmount();
  container.remove();
});

it("follows a controlled prop through a ref", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const open = ref(false);
  let api!: ReturnType<typeof useMenu>["api"];
  const app = createApp({
    setup() {
      const menu = useMenu(computed(() => ({ id: "controlled", open: open.value })));
      api = menu.api;
      return () =>
        h("div", [
          h("button", bind(menu.api.value.getTriggerProps()), "File"),
          h("div", { ...bind(menu.api.value.getPositionerProps()), ref: menu.positioner }, [
            h("div", bind(menu.api.value.getContentProps())),
          ]),
        ]);
    },
  });
  app.mount(container);
  await nextTick();
  expect(api.value.open).toBe(false);
  open.value = true;
  await nextTick();
  await nextTick();
  expect(api.value.open).toBe(true);
  app.unmount();
  container.remove();
});
