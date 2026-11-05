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

test("a reload right after a collection doesn't ask the usage endpoints again; an old one does", async () => {
  fake.stored["relevo.quota.api.at"] = Date.now() - 60 * 1000;
  await open();
  assert.equal(fake.stored["relevo.quota.api"], undefined);
  fake.stored["relevo.quota.api.at"] = Date.now() - 6 * 60 * 1000;
  await open();
  assert.ok(fake.stored["relevo.quota.api"], "a stale one collects");
  assert.ok(Date.now() - fake.stored["relevo.quota.api.at"] < 60 * 1000, "and records when");
});

test("an expired login says so instead of showing empty bars, and only on its own account", async () => {
  fake.stored["relevo.quota.api.at"] = Date.now();
  fake.stored["relevo.quota.api"] = { personal: { error: "token expired" }, work: { error: "HTTP 429" } };
  const { view } = await open();
  assert.match(text(find(view(), "account-personal")), /login expired/);
  assert.doesNotMatch(text(find(view(), "account-work")), /login expired/);
});

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
