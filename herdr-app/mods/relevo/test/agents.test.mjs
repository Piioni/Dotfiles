// The agents list on the fake app: pins live in the core, and old ones move there.
import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake } from "./fake/herdr.mjs";
import { fakeCx, find, flush, text, click } from "./fake/ui.mjs";

import { LAUNCHERS } from "./fake/config.mjs";
const { default: Relevo } = await import("../main.js");

const { default: Agents } = await import("../../relevo-agents/main.js");
const pins = () => fake.runs.filter(([name]) => name === "terminal.pin").map(([, args]) => args);

/** @param {string} address @param {Record<string, any>} [over] */
function agent(address, over = {}) {
  return { address, status: "idle", pane: `p-${address}`, tab: `tb-${address}`, title: address, space: "sp1", space_name: "app", program: { name: "claude", agent: true }, seq: 1, pinned: false, ...over };
}

/** @param {Record<string, any>[]} list @param {Record<string, any>[]} [terminals] */
async function open(list, terminals = list.map((a) => ({ address: a.address, state: "live", labels: {} }))) {
  fake.agents = list;
  fake.terminals = terminals;
  fake.panes = list.map((a) => ({ pane: a.pane, terminal: a.address, tab: a.tab, title: a.title, program: a.program }));
  fake.spaces = [{ id: "sp1", name: "app", active: true, tabs: list.map((a) => ({ id: a.tab, name: "1", named: false })) }];
  const mod = new Agents(), cx = fakeCx();
  mod.init({}, cx);
  await flush();
  return { mod, cx, ui: () => mod.render(cx) };
}

beforeEach(() => {
  resetFake();
  localStorage.removeItem("pins");
});

test("an old pin moves to the core, and is kept until the core has it", async () => {
  localStorage.setItem("pins", JSON.stringify(["t1", "t9"]));
  const { ui } = await open([agent("t1")]);
  ui();
  ui();
  assert.deepEqual(pins(), [{ terminal: "t1", pinned: true }]);
  assert.deepEqual(JSON.parse(localStorage.getItem("pins")), ["t1", "t9"]);
  fake.terminals = [{ address: "t1", state: "live", labels: { "herdr.pinned": "true" } }];
  ui();
  assert.deepEqual(JSON.parse(localStorage.getItem("pins")), ["t9"]);
});

test("a pin from any client comes first", async () => {
  const { ui } = await open([agent("t1", { title: "first", seq: 2 }), agent("t2", { title: "second", seq: 1, pinned: true })]);
  const shown = text(ui());
  assert.ok(shown.indexOf("second") < shown.indexOf("first"), shown);
});

test("an unnamed tab shows what its agent is doing", async () => {
  const { ui } = await open([agent("t1", { title: "Fixing the login" })]);
  assert.match(text(ui()), /Fixing the login/);
});

test("a named tab keeps its name", async () => {
  const a = agent("t1", { title: "Fixing the login" });
  const { ui } = await open([a]);
  fake.spaces[0].tabs = [{ id: a.tab, name: "Auth", named: true }];
  assert.match(text(ui()), /Auth/);
});

test("nothing is drawn for collapsing unless the sidebar is collapsed", async () => {
  const { ui } = await open([agent("t1")]);
  assert.equal(find(ui(), "collapse"), null);
});

test("a local agent's account chip opens the handoff, without focusing it", async () => {
  fake.stored["relevo.setup"] = { accounts: { personal: { label: "Personal", letter: "P", bg: "#000", fg: "#fff" } } };
  const { ui, cx } = await open([agent("t1")], [{ address: "t1", state: "live", labels: { "agent.account": "personal" } }]);
  const chip = find(ui(), "acct-t1");
  assert.match(chip.tip, /continue with another account/);
  let stopped = false;
  chip.handlers.on_click({}, { ...cx, stop_propagation() { stopped = true; } });
  assert.deepEqual(fake.runs.at(-1), ["relevo.handoff-agent-t1", undefined]);
  assert.equal(stopped, true);
});

test("an account chip says only its account, with no borrowed marker", async () => {
  fake.stored["relevo.setup"] = { accounts: { personal: { label: "Personal", letter: "P", bg: "#000", fg: "#fff" } } };
  const { ui } = await open([agent("t1")], [{ address: "t1", state: "live", labels: { "agent.account": "personal" } }]);
  const chip = find(ui(), "acct-t1");
  assert.match(chip.tip, /^Personal account · /);
  assert.doesNotMatch(chip.tip, /borrowed/);
});

test("an agent on another machine has no handoff click", async () => {
  fake.stored["relevo.setup"] = { accounts: { personal: { label: "Personal", letter: "P", bg: "#000", fg: "#fff" } } };
  const { ui } = await open([agent("box/t1")], [{ address: "box/t1", state: "live", labels: { "agent.account": "personal", "agent.jira": "AB-1" } }]);
  const chip = find(ui(), "acct-box/t1");
  assert.equal(chip.handlers.on_click, undefined);
  assert.doesNotMatch(chip.tip, /continue with/);
});

test("a ticket with no account has no handoff click", async () => {
  fake.stored["relevo.setup"] = { accounts: {} };
  const { ui } = await open([agent("t1")], [{ address: "t1", state: "live", labels: { "agent.jira": "AB-1" } }]);
  assert.equal(find(ui(), "acct-t1").handlers.on_click, undefined);
});


async function accounts() {
  fake.props = { role: "accounts" };
  const mod = new Relevo(), cx = fakeCx();
  const nativeCx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (cx));
  mod.init({}, nativeCx);
  await flush();
  fake.props = {};
  return { mod, nativeCx };
}

test("Agents + never offers the Codex launcher", async () => {
  await accounts();
  const { ui, cx } = await open([]);
  click(find(ui(), "ag-new"), cx);
  fake.props = { ...fake.overlays.at(-1).props, overlay: "launcher-popup" };
  const menu = new Agents();
  menu.init(fake.props, cx);
  assert.ok(!find(menu.render(cx), "launch-profile-codex"));
  assert.ok(find(menu.render(cx), "launch-profile-claude-sipos"));
});

for (const profile of LAUNCHERS.filter((p) => p.app !== "codex")) {
  test(`Agents + offers and starts the configured ${profile.key} profile here`, async () => {
    const handler = await accounts();
    const { ui, cx } = await open([]);
    const view = ui();
    assert.ok(find(view, "ag-new"));
    assert.ok(find(view, "ag-sort"));
    click(find(view, "ag-new"), cx);
    const popup = fake.overlays.at(-1);
    assert.equal(popup?.mod, "relevo-agents");
    assert.equal(popup?.kind, "popup");
    assert.equal(popup?.at, "pointer");
    assert.equal(popup?.props.launcherMenu, true);
    fake.props = { ...popup.props, overlay: "launcher-popup" };
    const menu = new Agents();
    menu.init(fake.props, cx);
    assert.deepEqual(fake.runs, [], "opening the list never starts an agent");
    const option = find(menu.render(cx), `launch-profile-${profile.key}`);
    assert.ok(option);
    assert.ok(text(option).includes(profile.label));
    fake.focused = { pane: "p-focus", cwd: "/stale" };
    fake.panes = [{ pane: "p-focus", cwd: "/repo/it's $(not-a-command)" }];
    click(option, cx);
    const command = fake.runs.at(-1)[0];
    assert.equal(command, `relevo.launch-profile-${profile.key}`);
    handler.mod.command(command.slice("relevo.".length), handler.nativeCx);
    assert.deepEqual(fake.runs.at(-1), ["tab.new", {
      folder: "/repo/it's $(not-a-command)", argv: ["bash", "-ilc", profile.command],
    }]);
  });
}

test("retired launcher choices never fall back to a different account", async () => {
  const { mod, nativeCx } = await accounts();
  mod.command("launch-profile-deleted", nativeCx);
  assert.deepEqual(fake.runs, []);
  assert.match(fake.notices.at(-1)?.title ?? "", /launcher/i);
});

test("the compact Agents rail keeps the + launcher menu", async () => {
  await accounts();
  fake.layout = { id: "sidebar", size: { px: 80 } };
  const { ui, cx } = await open([]);
  assert.ok(find(ui(), "ag-new"));
  assert.ok(find(ui(), "collapse"));
  click(find(ui(), "ag-new"), cx);
  assert.equal(fake.overlays.at(-1)?.props.launcherMenu, true);
});

test("launcher sharing exposes display metadata, not shell commands", async () => {
  await accounts();
  const menu = fake.stored["relevo.setup"].launchers;
  assert.equal(menu.length, LAUNCHERS.length);
  assert.ok(menu.every((/** @type {Record<string, any>} */ l) => !Object.hasOwn(l, "command")));
});
