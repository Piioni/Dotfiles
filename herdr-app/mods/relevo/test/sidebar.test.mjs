import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake } from "./fake/herdr.mjs";
import { fakeCx, find, flush, text, click } from "./fake/ui.mjs";

const { default: Relevo } = await import("../main.js");

beforeEach(resetFake);

async function open() {
  fake.props = { role: "accounts" };
  const mod = new Relevo(), cx = fakeCx();
  const nativeCx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (cx));
  mod.init({}, nativeCx);
  await flush();
  return { mod, cx, nativeCx, view: () => mod.render(nativeCx) };
}

test("accounts keeps quotas and Settings without launchers or the context selector", async () => {
  const { view, cx } = await open();
  const ui = view();
  assert.ok(find(ui, "relevo-settings"));
  assert.ok(find(ui, "account-personal"));
  assert.equal(find(ui, "launch-pi-sipos"), null);
  assert.doesNotMatch(text(ui), /LAUNCHERS/);
  assert.equal(find(ui, "focus"), null);
  ui.handlers.on_size_change({ width: 80 }, cx);
  assert.equal(find(view(), "launch-pi-sipos"), null);
});

test("accounts no longer creates or changes space folders on startup or refresh", async () => {
  const folders = { "": { list: [{ id: "custom", name: "Existing", folded: true }], of: { sp1: "custom" }, at: 17 } };
  fake.stored["space-folders"] = structuredClone(folders);
  const { cx } = await open();
  cx.fire(600000);
  await flush();
  assert.deepEqual(fake.stored["space-folders"], folders);
  assert.deepEqual(fake.execs.filter((line) => line.includes("herdr-space-folders.json")), []);
});

test("clicking an account refreshes its usage and never starts an agent", async () => {
  const reads = /** @type {string[]} */ ([]);
  fake.read = (path) => { reads.push(path); return null; };
  const { view, nativeCx } = await open();
  await flush();
  const before = reads.length;
  click(find(view(), "account-personal"), nativeCx);
  await flush();
  assert.ok(reads.length > before, "the usage sources are read again");
  assert.deepEqual(fake.runs.filter(([name]) => name === "tab.new"), []);
  assert.doesNotMatch(text(view()), /Click to start/);
});
