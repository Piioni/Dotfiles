// The real Inbox on a fake app: marking cards addressed, and what makes it look at git again.
import "./fake/register.mjs";
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake, calls, changeFolder, watched } from "./fake/herdr.mjs";
import { fakeCx, find, text, click, flush, spinners } from "./fake/ui.mjs";

const { Inbox } = await import("../inbox.js");
const { LAUNCHED } = await import("../skills.js");

const TOP = "/work/app", GIT_DIR = "/work/app/.git";
const LABEL = "relevo.addressed";
const DIFF = /--shortstat/;

const agent = (address, status, tab = "tb1") => ({
  address, status, pane: `p-${address}`, tab, tab_name: "", space: "sp1", space_name: "app", program: { agent: true }, seq: 1,
});
const pane = (address, cwd = TOP) => ({ pane: `p-${address}`, terminal: address, cwd, branch: "main", status: "idle", program: { agent: true } });
const term = (address, turn = 3, labels = {}) => ({ address, turn, labels, state: "live", parent: null, cwd: TOP });

function setAgents(...list) {
  fake.agents = list.map(([address, status]) => agent(address, status));
  fake.panes = list.map(([address]) => pane(address));
  fake.terminals = list.map(([address, , turn, labels]) => term(address, turn, labels));
}

function repoOutput(cmd, args) {
  const line = args.join(" ");
  if (line.includes("--show-toplevel")) return { stdout: `${TOP}\n` };
  if (line.includes("--git-common-dir")) return { stdout: `${GIT_DIR}\n` };
  if (line.includes("--shortstat")) return { stdout: " 2 files changed, 5 insertions(+), 1 deletion(-)\n" };
  if (cmd === "gh") return { stdout: JSON.stringify({ data: { viewer: { login: "me", pullRequests: { nodes: [] } }, search: { nodes: [] } } }) };
  return null;
}

async function open() {
  const inbox = new Inbox(), cx = fakeCx();
  inbox.init({}, cx);
  await flush();
  return { inbox, cx, ui: () => inbox.render(cx) };
}

const count = () => fake.stored["relevo.inbox.count"];

beforeEach(() => {
  mock.timers.reset();
  resetFake();
  localStorage.removeItem("since");
  fake.exec = repoOutput;
});

test("a card keeps its age when the mod reloads", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000_000 });
  setAgents(["t1", "done"]);
  const first = await open();
  const at = first.inbox.local[0].at;
  mock.timers.tick(3_600_000);
  const again = await open();
  assert.equal(again.inbox.local[0].at, at);
});

test("a card's age starts over when its agent's status changes, and a broken save is ignored", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000_000 });
  setAgents(["t1", "done"]);
  const { inbox } = await open();
  const at = inbox.local[0].at;
  mock.timers.tick(3_600_000);
  setAgents(["t1", "idle"]);
  const again = await open();
  assert.equal(again.inbox.local[0].at, at + 3600);
  localStorage.setItem("since", "{not json");
  setAgents(["t1", "done"]);
  const broken = await open();
  assert.equal(broken.inbox.local.length, 1);
});

test("a finished agent's diff is a card that can be marked addressed", async () => {
  setAgents(["t1", "done"]);
  const { ui, inbox } = await open();
  const view = ui();
  assert.ok(find(view, "in-t1"));
  assert.match(text(view), /UNCOMMITTED WORK/);
  assert.ok(find(view, "addressed-t1"));
  assert.equal(count(), 1);
  assert.equal(inbox.local.length, 1);
});

test("✓ hides the card at once, before the label comes back, and writes it", async () => {
  setAgents(["t1", "done", 7]);
  const { ui, cx } = await open();
  click(find(ui(), "addressed-t1"), cx);
  await flush();
  const view = ui();
  assert.equal(find(view, "in-t1"), null);
  assert.match(text(find(view, "addressed-local")), /1 addressed/);
  assert.equal(count(), 0);
  assert.equal(calls(/^hc label t1 relevo\.addressed=\d+:7$/).length, 1);
});

test("the fold shows the card with Undo, which removes the label", async () => {
  setAgents(["t1", "done", 7, { [LABEL]: "100:7" }]);
  const { ui, cx } = await open();
  await flush();
  cx.fire(1500);
  await flush();
  click(find(ui(), "addressed-local"), cx);
  const undo = find(ui(), "undo-t1");
  assert.ok(undo);
  click(undo, cx);
  await flush();
  assert.equal(calls(/^hc label t1 relevo\.addressed=$/).length, 1);
  assert.ok(find(ui(), "addressed-t1"));
  assert.equal(count(), 1);
});

test("a turn ended since brings the card back and removes the label", async () => {
  setAgents(["t1", "done", 8, { [LABEL]: "100:7" }]);
  const { ui } = await open();
  assert.ok(find(ui(), "addressed-t1"));
  assert.equal(calls(/^hc label t1 relevo\.addressed=$/).length, 1);
});

test("the same turn keeps the card away across a reload", async () => {
  setAgents(["t1", "idle", 7, { [LABEL]: "100:7" }]);
  const { ui } = await open();
  assert.equal(find(ui(), "addressed-t1"), null);
  assert.equal(calls(/^hc label/).length, 0);
});

test("an agent that starts working drops the mark, and a stale one is only cleared once", async () => {
  setAgents(["t1", "idle", 7, { [LABEL]: "100:7" }]);
  const { cx } = await open();
  setAgents(["t1", "working", 7, { [LABEL]: "100:7" }]);
  cx.fire(1500);
  await flush();
  cx.fire(1500);
  await flush();
  assert.equal(calls(/^hc label t1 relevo\.addressed=$/).length, 1);
});

test("a waiting agent can't be marked and stays in the list", async () => {
  setAgents(["t1", "blocked", 7, { [LABEL]: "100:7" }]);
  const { ui } = await open();
  const view = ui();
  assert.ok(find(view, "in-t1"));
  assert.equal(find(view, "addressed-t1"), null);
  assert.equal(find(view, "addressed-local"), null);
});

test("a waiting agent stays in the list even if its mark can't be removed", async () => {
  setAgents(["t1", "blocked", 7, { [LABEL]: "100:7" }]);
  const output = fake.exec;
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "label" ? { code: 1, stderr: "busy\n" } : output(cmd, args));
  const { ui } = await open();
  assert.ok(find(ui(), "in-t1"));
});

test("a label that can't be written puts the card back and says so", async () => {
  setAgents(["t1", "done", 7]);
  const output = fake.exec;
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "label" ? { code: 1, stderr: "no such terminal\n" } : output(cmd, args));
  const { ui, cx } = await open();
  click(find(ui(), "addressed-t1"), cx);
  await flush();
  assert.ok(find(ui(), "addressed-t1"));
  assert.equal(fake.notices.at(-1).body, "no such terminal");
});

test("a repo's one card goes to the agent not marked addressed", async () => {
  setAgents(["t1", "done", 7, { [LABEL]: "100:7" }], ["t2", "done", 2]);
  const { ui } = await open();
  const view = ui();
  assert.equal(find(view, "addressed-t1"), null);
  assert.ok(find(view, "addressed-t2"));
});

test("a change to a repo's git state reads the diff again, after it settles", async () => {
  setAgents(["t1", "done"]);
  const { cx } = await open();
  assert.deepEqual(watched(), [GIT_DIR]);
  const before = calls(DIFF).length;
  changeFolder(GIT_DIR, [`${GIT_DIR}/refs/heads/main`]);
  await flush();
  assert.equal(calls(DIFF).length, before + 1);
  assert.deepEqual(cx.slept, [2000]);
  assert.deepEqual(watched(), [GIT_DIR], "keeps watching");
});

test("new objects and locks under .git don't read anything", async () => {
  setAgents(["t1", "done"]);
  await open();
  const before = calls(DIFF).length;
  changeFolder(GIT_DIR, [`${GIT_DIR}/objects/ab/cd`, `${GIT_DIR}/index.lock`]);
  await flush();
  assert.equal(calls(DIFF).length, before);
});

test("a command ending in a shell reads that repo's diff again", async () => {
  setAgents(["t1", "done"]);
  const shell = { pane: "p-sh", terminal: "t9", cwd: `${TOP}/src`, status: null, program: { name: "npm" } };
  fake.panes = [...fake.panes, shell];
  const { cx } = await open();
  const before = calls(DIFF).length;
  fake.panes = [...fake.panes.filter((p) => p !== shell), { ...shell, program: { shell: true } }];
  cx.fire(1500);
  await flush();
  assert.equal(calls(DIFF).length, before + 1);
});

test("without events the fallback waits for the window to be in front", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  setAgents(["t1", "done"]);
  const { cx } = await open();
  const diffs = calls(DIFF).length, trees = () => calls(/^sh -c .*worktree/s).length, treesBefore = trees();

  fake.window.active = false;
  mock.timers.tick(700_000);
  cx.fire(1500);
  await flush();
  assert.equal(calls(DIFF).length, diffs, "nothing while it's behind");
  assert.equal(trees(), treesBefore);

  fake.window.active = true;
  cx.fire(1500);
  await flush();
  assert.equal(calls(DIFF).length, diffs + 1, "catches up when it's back");
  assert.equal(trees(), treesBefore + 1);

  mock.timers.tick(1_500);
  cx.fire(1500);
  await flush();
  assert.equal(calls(DIFF).length, diffs + 1, "then waits again");
});

test("an agent changing state still scans while the window is behind", async () => {
  setAgents(["t1", "working"]);
  const { cx } = await open();
  fake.window.active = false;
  const before = calls(DIFF).length;
  setAgents(["t1", "done"]);
  cx.fire(1500);
  await flush();
  assert.equal(calls(DIFF).length, before + 1);
});

test("the PR and quota timers keep running behind other apps", async () => {
  setAgents();
  const { cx } = await open();
  fake.window.active = false;
  const before = calls(/^gh api graphql/).length;
  cx.fire(180000);
  await flush();
  assert.equal(calls(/^gh api graphql/).length, before + 1);
  assert.equal(cx.timers.some((t) => t.ms === 60000), true);
});

test("an agent that leaves the list and returns waiting shows the question on its screen, not the old one", async () => {
  let screen = " Delete the staging data?\n › 1. Yes\n   2. No\n";
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "read" ? { stdout: screen } : repoOutput(cmd, args));
  setAgents(["t1", "blocked"]);
  const { ui, inbox, cx } = await open();
  assert.match(text(ui()), /Delete the staging data/);
  setAgents();
  inbox.scanLocal(cx);
  await flush();
  screen = " Which database?\n › 1. Postgres\n   2. SQLite\n";
  setAgents(["t1", "blocked"]);
  inbox.scanLocal(cx);
  await flush();
  const view = text(ui());
  assert.match(view, /Which database/);
  assert.doesNotMatch(view, /Delete the staging data/);
});

// A waiting agent whose screen the test can change after the card was drawn.
async function waiting(first) {
  const screen = { now: first };
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "read" ? { stdout: screen.now } : repoOutput(cmd, args));
  setAgents(["t1", "blocked"]);
  return { screen, ...await open() };
}
const DB = " Which database?\n › 1. Postgres\n   2. SQLite\n";
const DELETE = " Delete the staging data?\n › 1. Yes\n   2. No\n";
const sent = () => [...calls(/^hc keys t1/), ...calls(/^hc send/)];

test("a choice is pressed when the question is still the one the card showed", async () => {
  const { ui, cx, screen } = await waiting(DB);
  const row = find(ui(), "answer-t1-2");
  screen.now = " Which database?\n   1. Postgres\n › 2. SQLite\n";
  click(row, cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/), ["hc keys t1 enter"]);
  assert.equal(fake.notices.filter((n) => n.title === "The question changed").length, 0);
});

test("a question that changed after the card was drawn gets no keys, and the card shows the new one", async () => {
  const { ui, cx, screen } = await waiting(DB);
  const row = find(ui(), "answer-t1-1");
  screen.now = DELETE;
  click(row, cx);
  await flush();
  assert.deepEqual(sent(), []);
  assert.equal(fake.notices.at(-1).title, "The question changed");
  assert.match(text(ui()), /Delete the staging data/);
});

test("a click compares with the card as drawn, even if a read already refreshed the question behind it", async () => {
  const { ui, inbox, cx, screen } = await waiting(DB);
  const row = find(ui(), "answer-t1-1");
  screen.now = DELETE;
  await inbox.rereadPrompt("t1");
  click(row, cx);
  await flush();
  assert.deepEqual(sent(), []);
});

test("the keyboard's choice checks against the card too", async () => {
  const { inbox, cx, screen } = await waiting(DB);
  const item = inbox.navItems(inbox.shown()).find((i) => i.id === "in-t1");
  screen.now = DELETE;
  item.choose(1, cx);
  await flush();
  assert.deepEqual(sent(), []);
});

test("a box in a multiple choice toggles after the cursor moved, and not on another question", async () => {
  const MULTI = " Pick\n › 1. [ ] A\n   2. [ ] B\n   3. [ ] Other\n   Submit\n";
  const { ui, cx, screen } = await waiting(MULTI);
  const row = find(ui(), "answer-t1-2");
  screen.now = " Pick\n   1. [x] A\n › 2. [ ] B\n   3. [ ] Other\n   Submit\n";
  click(row, cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/), ["hc keys t1 2"]);
  fake.execs.length = 0;
  const again = find(ui(), "answer-t1-1");
  screen.now = " Another\n › 1. [ ] A\n   2. [ ] B\n   3. [ ] Other\n   Submit\n";
  click(again, cx);
  await flush();
  assert.deepEqual(sent(), []);
});

test("Submit presses nothing if the form changed", async () => {
  const MULTI = " Pick\n › 1. [x] A\n   2. [ ] B\n   Submit\n";
  const { ui, cx, screen } = await waiting(MULTI);
  const button = find(ui(), "submit-t1");
  screen.now = DELETE;
  click(button, cx);
  await flush();
  assert.deepEqual(sent(), []);
  assert.equal(fake.notices.at(-1).title, "The question changed");
});

test("a typed answer isn't sent to a question that changed while typing", async () => {
  const FREE = " Why?\n › 1. Because\n   2. Type something.\n";
  const { ui, inbox, cx, screen } = await waiting(FREE);
  click(find(ui(), "answer-t1-2"), cx);
  await flush();
  assert.equal(inbox.replying, "t1");
  inbox.reply.set_value("my words");
  screen.now = DELETE;
  inbox.sendReply(cx);
  await flush();
  assert.deepEqual(sent(), []);
  assert.equal(fake.notices.at(-1).title, "The question changed");
});

test("Reply on a card without choices sends, but not once a menu has appeared", async () => {
  const { ui, inbox, cx, screen } = await waiting("Should I also update the docs?\n");
  click(find(ui(), "reply-t1"), cx);
  inbox.reply.set_value("yes");
  screen.now = "Thinking about it.\nShould I also update the docs?\n";
  inbox.sendReply(cx);
  await flush();
  assert.deepEqual(calls(/^hc send/), ["hc send --force t1 yes"]);
  fake.execs.length = 0;
  click(find(ui(), "reply-t1"), cx);
  inbox.reply.set_value("yes");
  screen.now = DELETE;
  inbox.sendReply(cx);
  await flush();
  assert.deepEqual(sent(), []);
  assert.equal(fake.notices.at(-1).title, "The question changed");
});

test("the keyboard answers the card as drawn, even if a read refreshed it before the redraw", async () => {
  const { ui, inbox, cx, screen } = await waiting(DB);
  ui();
  const item = inbox.nav.find((i) => i.id === "in-t1");
  screen.now = DELETE;
  await inbox.rereadPrompt("t1");
  item.choose(1, cx);
  await flush();
  assert.deepEqual(sent(), []);
});

test("a new question redraws the card, even within the same minute", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000_000 });
  const { ui, inbox, cx, screen } = await waiting(DB);
  ui();
  setAgents(["t1", "working"]);
  inbox.scanLocal(cx);
  await flush();
  mock.timers.tick(1000);
  screen.now = DELETE;
  setAgents(["t1", "blocked"]);
  const redraws = cx.notified;
  inbox.scanLocal(cx);
  await flush();
  assert.ok(cx.notified > redraws);
  assert.match(text(ui()), /Delete the staging data/);
});

test("a failed read of the screen sends nothing, whatever the card", async () => {
  const noMenu = await waiting("Should I also update the docs?\n");
  click(find(noMenu.ui(), "reply-t1"), noMenu.cx);
  noMenu.inbox.reply.set_value("yes");
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "read" ? { code: 1, stderr: "gone" } : repoOutput(cmd, args));
  noMenu.inbox.sendReply(noMenu.cx);
  await flush();
  assert.deepEqual(sent(), []);
  assert.match(fake.notices.at(-1).title, /Could not read/);
});

test("Reply stops on a screen that looks like a menu but can't be read as one", async () => {
  const { ui, inbox, cx, screen } = await waiting("Should I also update the docs?\n");
  click(find(ui(), "reply-t1"), cx);
  inbox.reply.set_value("yes");
  screen.now = " Which?\n   2. B\n › 3. C\n";
  inbox.sendReply(cx);
  await flush();
  assert.deepEqual(sent(), []);
});

// Holds the PR query until the test answers it.
function holdPRs() {
  let answer;
  const held = new Promise((resolve) => { answer = resolve; });
  fake.exec = (cmd, args) => (cmd === "gh" && args[0] === "api" ? held : repoOutput(cmd, args));
  return answer;
}

const PRS = /^gh api graphql/;

test("a first PR scan spins while pending and stops when gh fails", async () => {
  const answer = holdPRs();
  const { inbox, ui } = await open();
  assert.match(text(ui()), /loading/);
  assert.equal(spinners(ui()), 1);
  answer({ code: 1, stderr: "offline\ndetail" });
  await flush();
  assert.match(text(ui()), /PRs unavailable/);
  assert.equal(spinners(ui()), 0);
  assert.equal(inbox.error, "offline");
});

test("a first PR scan that throws also stops the spinner", async () => {
  const answer = holdPRs();
  const { inbox, ui } = await open();
  answer({ stdout: "not json" });
  await flush();
  assert.match(text(ui()), /PRs unavailable/);
  assert.equal(spinners(ui()), 0);
  assert.match(inbox.error, /^PRs: /);
});

test("gh failing with blank stderr still shows an error", async () => {
  const answer = holdPRs();
  const { inbox } = await open();
  answer({ code: 1, stderr: "\n" });
  await flush();
  assert.equal(inbox.error, "gh failed");
});

test("refreshing an existing PR snapshot keeps the header still", async () => {
  const { cx, ui } = await open();
  assert.match(text(ui()), /PRs now/);
  holdPRs();
  click(find(ui(), "inbox-refresh"), cx);
  await flush();
  assert.match(text(ui()), /PRs now/);
  assert.equal(spinners(ui()), 0);
});

test("a PR scan already running is not started again", async () => {
  const answer = holdPRs();
  const { inbox, cx } = await open();
  inbox.scanPRs(cx);
  await flush();
  assert.equal(calls(PRS).length, 1);
  answer({ code: 1, stderr: "offline" });
  await flush();
  inbox.scanPRs(cx);
  await flush();
  assert.equal(calls(PRS).length, 2);
});

test("PR data that arrived stays dated when a later step fails", async () => {
  const node = {
    url: "https://github.com/o/r/pull/1", number: 1, title: "t", isDraft: false, updatedAt: new Date().toISOString(), reviewDecision: "CHANGES_REQUESTED",
    repository: { nameWithOwner: "o/r" }, commits: { nodes: [] }, reviews: { nodes: [] }, reviewThreads: { nodes: [] },
  };
  fake.exec = (cmd, args) => {
    if (cmd === "git" && args.includes("get-url")) throw new Error("no git");
    if (cmd === "gh" && args[0] === "api") return { stdout: JSON.stringify({ data: { viewer: { login: "me", pullRequests: { nodes: [node] } }, search: { nodes: [] } } }) };
    return repoOutput(cmd, args);
  };
  const { inbox, ui } = await open();
  assert.match(inbox.error, /^PRs: no git/);
  assert.match(text(ui()), /PRs now/);
  assert.equal(inbox.mine.length, 1);
});

test("a second click during a send sends nothing", async () => {
  const { ui, cx } = await waiting(DB);
  const row = find(ui(), "answer-t1-1");
  click(row, cx);
  click(row, cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/), ["hc keys t1 enter"]);
});

test("a numbered list with no cursor offers no choices and no reply", async () => {
  const { ui } = await waiting("Plan:\n1. Rebuild\n2. Test\nPress Enter to continue\n");
  assert.equal(find(ui(), "answer-t1-1"), null);
  assert.equal(find(ui(), "reply-t1"), null);
});

test("a digit held with a modifier answers nothing", async () => {
  const { inbox, ui, cx } = await waiting(DB);
  ui();
  inbox.keyboard = true;
  inbox.sel = "in-t1";
  inbox.navKey({ key: "1", modifiers: { platform: true } }, cx);
  await flush();
  assert.deepEqual(sent(), []);
});

test("quick clicks on two boxes both land, in order", async () => {
  const boxes = " Pick\n › 1. [ ] A\n   2. [ ] B\n";
  const { ui, cx } = await waiting(boxes);
  const one = find(ui(), "answer-t1-1"), two = find(ui(), "answer-t1-2");
  click(one, cx);
  click(two, cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/), ["hc keys t1 1", "hc keys t1 2"]);
});

test("a blocked agent in a PR's tab gets a card, and a resting one doesn't", async () => {
  fake.stored[LAUNCHED] = { "https://github.com/o/r/pull/1": { tab: "r#1 review", skill: "fix" } };
  const screen = { now: DB };
  fake.exec = (cmd, args) => (cmd === "hc" && args[0] === "read" ? { stdout: screen.now } : repoOutput(cmd, args));
  setAgents(["t1", "blocked"]);
  fake.agents[0].tab_name = "r#1 review";
  const { ui, inbox, cx } = await open();
  assert.ok(find(ui(), "answer-t1-1"));
  fake.agents[0].status = "idle";
  inbox.scanLocal(cx);
  await flush();
  assert.equal(find(ui(), "answer-t1-1"), null);
});

test("Submit clicked twice on a static screen presses once", async () => {
  const boxes = " Pick\n › 1. [ ] A\n   2. [ ] B\n     Submit\n";
  const { ui, cx } = await waiting(boxes);
  const row = find(ui(), "submit-t1");
  click(row, cx);
  click(row, cx);
  await flush();
  assert.equal(calls(/^hc keys t1/).length, 1);
});

test("a click during a slow redraw can't reach the next dialog", async () => {
  const { ui, cx, screen, inbox } = await waiting(DB);
  const row = find(ui(), "answer-t1-1");
  let sleeps = 0;
  cx.sleep = async () => {
    if (++sleeps === 2) click(row, cx);
    if (sleeps === 3) screen.now = DELETE;
  };
  click(row, cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/), ["hc keys t1 enter"]);
  assert.equal(inbox.answering.size, 0);
});

test("a typed answer in a multiple choice is checked again after its label changes", async () => {
  const before = " Pick\n   1. [ ] A\n › 2. [ ] Type something\n     Submit\n";
  const { ui, cx, screen, inbox } = await waiting(before);
  click(find(ui(), "answer-t1-2"), cx);
  await flush();
  inbox.reply.set_value("my words");
  const realExec = fake.exec;
  fake.exec = (cmd, args) => {
    if (cmd === "hc" && args[0] === "send") screen.now = " Pick\n   1. [ ] A\n › 2. [ ] my words\n     Submit\n";
    return realExec(cmd, args);
  };
  inbox.sendReply(cx);
  await flush();
  assert.deepEqual(calls(/^hc keys t1/).slice(-1), ["hc keys t1 up 2"]);
});

test("a reply while the agent is still being answered keeps its text", async () => {
  const { inbox, cx } = await waiting("Should I go on?\n");
  inbox.startReply({ address: "t1" }, null, cx);
  inbox.reply.set_value("yes");
  inbox.answering.set("t1", Promise.resolve());
  inbox.sendReply(cx);
  await flush();
  assert.equal(inbox.replying, "t1");
  assert.equal(fake.notices.at(-1).title, "Still answering this agent");
  assert.deepEqual(sent(), []);
});

test("a waiting card can continue with another account", async () => {
  const { ui, cx } = await waiting(DB);
  click(find(ui(), "handoff-t1"), cx);
  assert.equal(fake.overlays.at(-1).props.role, "handoff");
  assert.equal(fake.overlays.at(-1).props.terminal, "t1");
});
