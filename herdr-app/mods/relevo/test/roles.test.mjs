// Every part of the layout loads and draws on the fake app, so a broken import or render fails here.
import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake } from "./fake/herdr.mjs";
import { fakeCx, flush } from "./fake/ui.mjs";

const { default: Relevo } = await import("../main.js");
const { default: Agents } = await import("../../relevo-agents/main.js");
const { default: Files } = await import("../../relevo-files/main.js");

const PR = { url: "https://github.com/acme/app/pull/1", number: 1, repo: "acme/app", title: "Fix", updatedAt: "2026-01-01T00:00:00Z" };
const { loadKeys, shortcut } = await import("../ui.js");

const ROLES = {
  accounts: {}, inbox: {}, "inbox-button": {}, "panel-bar": {}, "panel-toggle": {}, settings: {},
  "account-menu": { pr: PR, skill: "review", folder: "/work/app", current: "personal" },
  "find-file": { root: "/work/app" }, "checkout-menu": { top: "/work/app", list: [] },
  handoff: { terminal: "t1", cwd: "/work/app" }, "review-diff": { folder: "/work/app" }, "ledger-week": {},
};

beforeEach(() => {
  resetFake();
  fake.agents = [{ address: "t1", status: "done", pane: "p1", tab: "tb1", tab_name: "", space: "sp1", space_name: "app", program: { agent: true }, seq: 1, focused: true }];
  fake.panes = [{ pane: "p1", terminal: "t1", tab: "tb1", cwd: "/work/app", branch: "main", status: "done", program: { agent: true }, focused: true }];
  fake.terminals = [{ address: "t1", turn: 1, labels: {}, state: "live", parent: null, cwd: "/work/app" }];
  fake.spaces = [{ id: "sp1", name: "app", active: true, folder: "/work/app", tabs: [{ id: "tb1", name: "1", active: true }] }];
  fake.focused = { space: "sp1", tab: "tb1", pane: "p1", agent: "t1" };
});

async function draw(Mod, props) {
  fake.props = props;
  const mod = new Mod(), cx = fakeCx();
  mod.init(props, cx);
  await flush();
  assert.ok(mod.render(cx));
  await mod.close?.(cx);
}

for (const [role, props] of Object.entries(ROLES)) {
  test(`relevo: ${role} draws`, () => draw(Relevo, { role, ...props }));
}
test("relevo-agents draws", () => draw(Agents, {}));
test("relevo-files draws", () => draw(Files, {}));

test("tooltips read a key from the layout's section of keys.json", async () => {
  fake.files["/home/test/.config/herdr-app/keys.json"] = JSON.stringify({ "layout:relevo": { "cmd-j": "relevo.next-waiting" } });
  await loadKeys();
  assert.equal(shortcut("relevo.next-waiting"), "⌘J");
});
