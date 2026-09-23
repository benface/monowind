import { afterEach, describe, expect, it, vi } from "vitest";
import * as Select from "@zag-js/select";
import { normalizeProps, VanillaMachine } from "@zag-js/vanilla";
import { defined, itemProps, warnStray } from "../src/framework.ts";

/** What the framework packages share (specs/ui.md "Component layer"). */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warnStray", () => {
  it("names a root's stray props once per root, a caller naming none keyed by its component", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnStray("Menu.Root", ["className"]);
    warnStray("Menu.Root", ["className"]);
    expect(warned).toHaveBeenCalledTimes(1);
    warnStray("Dialog.Root", ["className"]);
    expect(warned).toHaveBeenCalledTimes(2);
    const root = {};
    warnStray("Menu.Root", ["className"], root);
    warnStray("Menu.Root", ["className"], root);
    expect(warned).toHaveBeenCalledTimes(3);
  });
});

describe("itemProps", () => {
  it("marks the items Zag's own props say are checked", () => {
    const machine = new VanillaMachine(Select.machine, {
      id: "marked",
      collection: Select.collection({ items: ["main", "next"] }),
      defaultValue: ["next"],
    });
    const api = Select.connect(machine.service, normalizeProps);
    expect(itemProps(api, "next")).toHaveProperty("data-selected", "");
    expect(itemProps(api, "main")).not.toHaveProperty("data-selected");
  });
});

describe("defined", () => {
  it("leaves out what is undefined, and types it so", () => {
    const value = undefined as string | undefined;
    // Zag types a getter's options as optional without `undefined`.
    const own: { value?: string } = defined({ value });
    expect(own).toEqual({});
  });
});
