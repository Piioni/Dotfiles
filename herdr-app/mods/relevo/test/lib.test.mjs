// From this folder: node --test 'test/*.test.mjs'. Covers the pure helpers in lib/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, windowOf, FIVE_HOURS, runsOut } from "../lib/time.js";
import { keyMap, relevoKeys, formatShortcut } from "../lib/keys.js";
import { terminalAccount, handoffPlan, resumePrompt, notePrompt } from "../lib/handoff.js";

const now = () => Math.floor(Date.now() / 1000);

test("ago: minutes, then hours up to two days, then days", () => {
  assert.equal(ago(now() - 30), "now");
  assert.equal(ago(now() - 5 * 60), "5m ago");
  assert.equal(ago(now() - 47 * 3600), "47h ago");
  assert.equal(ago(now() - 3 * 86400), "3d ago");
});

test("windowOf: a window past its reset reads as empty", () => {
  assert.equal(windowOf(null, 0, FIVE_HOURS), null);
  assert.deepEqual(windowOf(80, now() - 10, FIVE_HOURS), { pct: 0, resets: null, pace: null });
  const w = windowOf(42.4, now() + FIVE_HOURS / 2, FIVE_HOURS);
  assert.equal(w.pct, 42);
  assert.ok(Math.abs(w.pace - 0.5) < 0.01);
});

test("relevoKeys: the layout's section counts and wins over global", () => {
  const map = relevoKeys({
    global: { "cmd-t": "tab.new", "cmd-g": "relevo.review" },
    "layout:relevo": { "cmd-alt-d": "relevo.review", "cmd-j": "relevo.next-waiting" },
    terminal: { "cmd-c": "terminal.copy" },
  });
  assert.equal(map["relevo.review"], "cmd-alt-d");
  assert.equal(map["relevo.next-waiting"], "cmd-j");
  assert.equal(map["tab.new"], "cmd-t");
  assert.equal(map["terminal.copy"], undefined);
  assert.deepEqual(relevoKeys({}), {});
});

test("shortcuts: first combo per action, macOS modifier order", () => {
  const map = keyMap({ "cmd-alt-d": "relevo.review", "ctrl-r": "relevo.review", "cmd-alt-shift-w": "relevo.worktree-open" });
  assert.equal(formatShortcut(map["relevo.review"]), "⌥⌘D");
  assert.equal(formatShortcut(map["relevo.worktree-open"]), "⌥⇧⌘W");
  assert.equal(formatShortcut(undefined), "");
});

const pr = (over) => ({
  number: 1, title: "t", url: "u1", isDraft: false, updatedAt: "2026-10-30T10:00:00Z", reviewDecision: null,
  repository: { nameWithOwner: "me/repo" },
  commits: { nodes: [{ commit: { committedDate: "2026-10-30T09:00:00Z", statusCheckRollup: { state: "SUCCESS" } } }] },
  reviews: { nodes: [] }, reviewThreads: { nodes: [] }, ...over,
});

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;

test("runsOut: when a window hits 100% at the pace so far", () => {
  const now = 1_000_000, hour = 3600;
  // 2h into a 5h window at 60%: 30%/h, so the remaining 40% takes 80 minutes.
  const hot = { pct: 60, resets: now + 3 * hour, pace: 0.4 };
  assert.equal(runsOut(hot, FIVE_HOURS, now), now + 80 * 60);
  // 2h in at 20%: 10%/h, 8h more needed, past the reset.
  assert.equal(runsOut({ pct: 20, resets: now + 3 * hour, pace: 0.4 }, FIVE_HOURS, now), null);
  assert.equal(runsOut({ pct: 5, resets: now + hour, pace: 0.01 }, FIVE_HOURS, now), null);
  assert.equal(runsOut({ pct: 100, resets: now + hour, pace: 0.5 }, FIVE_HOURS, now), null);
  assert.equal(runsOut(null, FIVE_HOURS, now), null);
});

const LAUNCH = [
  { key: "personal", app: "claude", account: "personal", claudeDir: ".claude" },
  { key: "work", app: "claude", account: "work", claudeDir: ".claude-work" },
  { key: "work-on-personal", app: "claude", account: "personal", claudeDir: ".claude-work" },
  { key: "codex", app: "codex", account: "codex" },
];
const ID = "0b5e6f4a-12cd-4e8f-9a01-23456789abcd", SESSION = `/h/.claude/projects/-h-code-api/${ID}.jsonl`;

test("terminalAccount: the hook's label, else Codex by its app", () => {
  assert.equal(terminalAccount({ labels: { "agent.account": "work" }, agent: "claude-code" }), "work");
  assert.equal(terminalAccount({ labels: {}, agent: "codex" }), "codex");
  assert.equal(terminalAccount({ agent: "claude-code" }), null);
  assert.equal(terminalAccount(null), null);
});

test("handoffPlan: Claude to Claude resumes from a copy in the next account's projects folder", () => {
  assert.deepEqual(handoffPlan({ from: "personal", to: "work", transcript: SESSION, launchers: LAUNCH, home: "/h" }),
    { mode: "resume", src: SESSION, dir: "/h/.claude-work/projects/-h-code-api", id: ID, launcher: LAUNCH[1], seed: true });
});

test("handoffPlan: the session's profile goes on with the other account, without copying the file", () => {
  const WORK_SESSION = `/h/.claude-work/projects/-h-code-api/${ID}.jsonl`;
  assert.deepEqual(handoffPlan({ from: "work", to: "personal", transcript: WORK_SESSION, launchers: LAUNCH, home: "/h" }),
    { mode: "resume", src: WORK_SESSION, dir: "/h/.claude-work/projects/-h-code-api", id: ID, launcher: LAUNCH[2], seed: false });
  // Started with a token, the personal account's label sits on a session of the work profile.
  assert.deepEqual(handoffPlan({ from: "personal", to: "work", transcript: WORK_SESSION, launchers: LAUNCH, home: "/h" }),
    { mode: "resume", src: WORK_SESSION, dir: "/h/.claude-work/projects/-h-code-api", id: ID, launcher: LAUNCH[1], seed: false });
});

test("handoffPlan: Codex on either side, an unknown session or the same account starts from a note", () => {
  const plan = (o) => handoffPlan({ from: "personal", to: "work", transcript: SESSION, launchers: LAUNCH, home: "/h", ...o }).mode;
  assert.equal(plan({ to: "codex" }), "note");
  assert.equal(plan({ from: "codex", transcript: null }), "note");
  assert.equal(plan({ transcript: null }), "note");
  assert.equal(plan({ from: null }), "note");
  assert.equal(plan({ to: "personal" }), "note");
  assert.equal(plan({ transcript: "/h/.claude/projects/-x/bad id;rm.jsonl" }), "note");
});

test("handoffPlan: only a UUID file in a configured profile's projects folder is trusted", () => {
  const plan = (transcript) => handoffPlan({ from: "personal", to: "work", transcript, launchers: LAUNCH, home: "/h" }).mode;
  assert.equal(plan(`/h/.claude/projects/-x/-${ID.slice(1)}.jsonl`), "note");
  assert.equal(plan("/h/.claude/projects/-x/--help.jsonl"), "note");
  assert.equal(plan(`/h/.claude/projects/../../.ssh/${ID}.jsonl`), "note");
  assert.equal(plan(`/h/.claude/projects/a/b/${ID}.jsonl`), "note");
  assert.equal(plan(`/h/.other/projects/-x/${ID}.jsonl`), "note");
  assert.equal(plan(`/tmp/.claude/projects/-x/${ID}.jsonl`), "note");
});

test("handoff prompts name the account or the app and the note", () => {
  assert.match(resumePrompt("Work"), /on the Work account\./);
  assert.doesNotMatch(resumePrompt("Work"), /quota/);
  assert.match(resumePrompt("Work", true), /ran out of quota/);
  assert.match(notePrompt("Codex", "/n.md"), /a Codex session .* Read \/n\.md/);
});
