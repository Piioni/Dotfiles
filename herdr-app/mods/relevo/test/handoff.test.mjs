// Handing an agent to another account on the fake app: what stops, what starts and in which order.
import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake, calls } from "./fake/herdr.mjs";
import { fakeCx, find, flush } from "./fake/ui.mjs";

const { Handoff, openHandoff, handoffFrom, closeHandedOff } = await import("../handoff.js");
const { default: Relevo } = await import("../main.js");
const { ACCOUNTS, accountOf } = await import("../accounts.js");

const FROM = ACCOUNTS[0], TO = ACCOUNTS[1], TAB = `work · ${TO.letter}`, INTERRUPT = /^hc interrupt t1/;
const UUID = "11111111-2222-3333-4444-555555555555";
const SESSION = `/home/test/${FROM.claudeDir}/projects/-work-app/${UUID}.jsonl`;
const agent = (address, over = {}) => ({ address, pane: `p-${address}`, space: "sp1", tab: `tb-${address}`, tab_name: "work", status: "working", ...over });
const tabNews = () => fake.runs.filter(([name]) => name === "tab.new").map(([, args]) => args);
const PROPS = { terminal: "t1", space: "sp1", tab: "work", cwd: "/work/app", from: FROM.key };
const outcome = (value) => ({ stdout: JSON.stringify({ outcome: value, key: "esc" }) });

// The stop key answers `result`; the next agent shows up on the first wait unless told otherwise.
function hc(result = outcome("stopped")) {
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "interrupt" ? result : null);
}

function go(props = {}, { arrives = true } = {}) {
  const cx = fakeCx(), part = new Handoff();
  cx.sleeps = 0;
  cx.sleep = async () => {
    cx.sleeps++;
    if (arrives) fake.agents.push(agent("t2", { tab_name: TAB, status: "idle" }));
  };
  fake.props = { ...PROPS, ...props };
  part.go(TO.key, cx);
  return { cx, part };
}

beforeEach(() => {
  resetFake();
  fake.agents = [agent("t1")];
  hc();
});

test("a working agent stops before anything starts, and the note has its last screen", async () => {
  const order = [];
  fake.exec = (cmd, args) => {
    if (cmd === "hc") order.push(args[0]);
    return cmd === "hc" && args[0] === "interrupt" ? outcome("stopped") : null;
  };
  go();
  await flush();
  assert.deepEqual(order, ["interrupt", "read"]);
  assert.equal(tabNews().length, 1);
  assert.equal(fake.notices.at(-1).action.name, "relevo.handoff-close-t1:t2");
});

test("an agent that didn't stop gets no successor", async () => {
  for (const result of [outcome("still_working"), outcome("unknown"), { stdout: "not json" }, { code: 1, stderr: '{"error":{"kind":"busy"}}' }]) {
    fake.runs.length = 0;
    hc(result);
    const { part } = go();
    await flush();
    assert.equal(tabNews().length, 0);
    assert.equal(part.busy, null);
    assert.match(part.error, /Couldn't stop/);
  }
});

test("an agent already gone doesn't hold it up", async () => {
  for (const result of [outcome("exited"), { code: 3, stderr: '{"error":{"kind":"not_found"}}' }, { code: 11, stderr: '{"error":{"kind":"finished"}}' }]) {
    fake.runs.length = 0;
    fake.agents = [agent("t1")];
    hc(result);
    go();
    await flush();
    assert.equal(tabNews().length, 1);
  }
});

test("a resting or waiting agent gets no stop key", async () => {
  for (const status of ["idle", "done", "blocked"]) {
    fake.runs.length = 0;
    fake.agents = [agent("t1", { status })];
    go();
    await flush();
    assert.equal(calls(INTERRUPT).length, 0);
    assert.equal(tabNews().length, 1);
  }
});

test("an agent slow to report starts once, offers no close, and gives up after 30 s", async () => {
  const { cx, part } = go({}, { arrives: false });
  await flush();
  assert.equal(cx.sleeps, 60);
  assert.equal(tabNews().length, 1);
  const notice = fake.notices.at(-1);
  assert.match(notice.title, /hasn't reported/);
  assert.equal(notice.action, undefined);
  assert.equal(part.error, null);
});

test("another tab with that name, or an agent elsewhere, doesn't count as started", async () => {
  fake.agents.push(agent("t8", { tab_name: TAB }));
  const { cx } = go({}, { arrives: false });
  cx.sleep = async () => {
    cx.sleeps++;
    if (cx.sleeps === 2) fake.agents.push(agent("t10", { tab_name: "other" }), agent("t11", { tab_name: TAB, space: "sp2" }));
  };
  await flush();
  assert.equal(fake.notices.at(-1).action, undefined);
});

test("a second click while it runs starts nothing more", async () => {
  const { part, cx } = go();
  part.go(TO.key, cx);
  await flush();
  assert.equal(calls(INTERRUPT).length, 1);
  assert.equal(tabNews().length, 1);
});

test("a command that can't run shows on the popup and frees it", async () => {
  fake.exec = () => { throw new Error("no hc"); };
  const { part } = go();
  await flush();
  assert.equal(part.busy, null);
  assert.match(part.error, /no hc/);
  assert.equal(tabNews().length, 0);
});

test("helpers still running are said and offer no close", async () => {
  fake.terminals = [{ address: "t3", parent: "t1", state: "live", labels: {} }];
  go();
  await flush();
  assert.match(fake.notices.at(-1).body, /helpers keep running/);
  assert.equal(fake.notices.at(-1).action, undefined);
});

test("a full account can't be picked", async () => {
  fake.props = PROPS;
  const part = new Handoff();
  part.quotas = { [TO.key]: { h5: { pct: 100 } } };
  assert.equal(find(part.render(), `handoff-${TO.key}`).handlers.on_click, undefined);
  part.quotas = { [TO.key]: { h5: { pct: 40 } } };
  assert.ok(find(part.render(), `handoff-${TO.key}`).handlers.on_click);
});

test("only a handoff from a full account says the quota ran out", async () => {
  for (const [reason, says] of [[null, false], ["quota", true]]) {
    fake.runs.length = 0;
    fake.agents = [agent("t1")];
    go({ transcript: SESSION, reason });
    await flush();
    const prompt = tabNews()[0].argv.join(" ");
    assert.match(prompt, new RegExp(`on the ${accountOf(TO.key).label} account`));
    assert.equal(/ran out of quota/.test(prompt), says);
    assert.ok(prompt.includes(UUID));
  }
});

test("the reason reaches the popup only from a full account", () => {
  fake.agents = [agent("t1", { status: "blocked" })];
  fake.terminals = [{ address: "t1", labels: { "agent.account": FROM.key } }];
  openHandoff("t1");
  assert.equal(fake.overlays.at(-1).props.reason, null);
  handoffFrom(FROM.key);
  assert.equal(fake.overlays.at(-1).props.reason, "quota");
});

function resting(status = "idle") {
  fake.agents = [agent("t1", { status }), agent("t2", { status: "working" })];
  fake.panes = [{ pane: "p1", terminal: "t1", tab: "tb1" }];
}

test("closing takes the tab, or only the terminal if others share it", () => {
  resting();
  closeHandedOff("t1", "t2");
  assert.deepEqual(fake.runs.at(-1), ["tab.close", { id: "tb1", confirmed: true }]);
  fake.panes.push({ pane: "p3", terminal: null, mod: "x", tab: "tb1" });
  closeHandedOff("t1", "t2");
  assert.deepEqual(fake.runs.at(-1), ["terminal.kill", { terminal: "t1" }]);
});

test("an agent in use, or a next one that's gone, or helpers keep it from closing", () => {
  for (const status of ["working", "blocked"]) {
    resting(status);
    closeHandedOff("t1", "t2");
  }
  resting();
  fake.agents = [fake.agents[0]];
  closeHandedOff("t1", "t2");
  resting();
  fake.terminals = [{ address: "t1", labels: { "agent.bg": "⧗ 1 shell" } }];
  closeHandedOff("t1", "t2");
  resting();
  fake.terminals = [{ address: "t3", parent: "t1", state: "live" }];
  closeHandedOff("t1", "t2");
  resting();
  fake.terminals = [];
  fake.agents = [fake.agents[1]];
  closeHandedOff("t1", "t2");
  assert.equal(fake.runs.length, 0);
  assert.equal(fake.notices.length, 6);
});

test("the sidebar's commands open the popup for that agent and close it", () => {
  resting();
  fake.panes = [{ pane: "p1", terminal: "t1", tab: "tb1" }];
  const mod = new Relevo();
  mod.command("handoff-agent-t1", fakeCx());
  assert.equal(fake.overlays.at(-1).props.terminal, "t1");
  mod.command("handoff-close-t1:t2", fakeCx());
  assert.deepEqual(fake.runs.at(-1), ["tab.close", { id: "tb1", confirmed: true }]);
});
