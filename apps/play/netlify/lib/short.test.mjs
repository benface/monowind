import assert from "node:assert/strict";
import { test } from "node:test";
import { idFor, MAX_TARGET_LENGTH, targetOf } from "./short.mjs";

test("a target is this site's root with an optional query and hash", () => {
  assert.equal(targetOf("/"), "/");
  assert.equal(targetOf("/?select=text#1.abc"), "/?select=text#1.abc");
  assert.equal(targetOf("/#1.abc"), "/#1.abc");
  for (const bad of [
    "",
    "https://evil.example/",
    "//evil.example",
    "/other",
    "/?a b",
    "/#a b",
    42,
  ]) {
    assert.equal(targetOf(bad), null, JSON.stringify(bad));
  }
  assert.equal(targetOf(`/#${"x".repeat(MAX_TARGET_LENGTH)}`), null);
});

test("ids are content-addressed prefixes of the target's hash", async () => {
  const a = await idFor("/#1.abc", 10);
  assert.equal(a.length, 10);
  assert.equal(await idFor("/#1.abc", 10), a);
  assert.equal((await idFor("/#1.abc", 14)).slice(0, 10), a);
  assert.notEqual(await idFor("/#1.abd", 10), a);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
