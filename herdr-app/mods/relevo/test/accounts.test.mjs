import "./fake/register.mjs";
import { fake, resetFake } from "./fake/herdr.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const { launchArgv, launchChoice, launcherOf, loginLauncher, publishSetup, ACCOUNTS } = await import("../accounts.js");

for (const key of ["personal", "work", "codex"]) {
  test(`${key} launches through the available interactive login shell`, () => {
    assert.deepEqual(launchArgv(key), ["bash", "-ilc", key === "codex" ? "codex --profile configured" : (key === "work" ? "CLAUDE_CONFIG_DIR=$HOME/.claude-work claude" : "claude")]);
  });
}

test("launcher prompt and arguments remain positional and shell-quoted", () => {
  assert.deepEqual(launchArgv("personal", "do this", ["a'b", "two words"]), [
    "bash", "-ilc", 'claude "$2" "$3" "$1"', "bash", "do this", "a'b", "two words",
  ]);
  const prompt = "$(exit 91); `exit 92` ' \"\n";
  const argv = launchArgv("personal", prompt, ["a'b", "two words"]);
  // Only the stub function executes; no Claude process or user shell configuration loads.
  const stdout = execFileSync("bash", ["-c", 'claude() { printf "%s\\0" "$@"; }; ' + argv[2], ...argv.slice(3)], { encoding: "utf8" });
  assert.deepEqual(stdout.split("\0"), ["a'b", "two words", prompt, ""]);
});

// Protect configured command routing at the actual sidebar boundary (no process runs).
test("sidebar honors configured Codex launcher and focused folder", async () => {
  resetFake();
  const { Sidebar } = await import("../sidebar.js");
  fake.focused = { cwd: "/repo/hostile ' $(nope)" };
  new Sidebar().launch("codex");
  assert.deepEqual(fake.runs, [["tab.new", { folder: fake.focused.cwd, argv: ["bash", "-ilc", "codex --profile configured"] }]]);
});

test("Pi profiles pass hostile prompts after -- without Claude flags or model selection", () => {
  const prompt = "--model nope; $(touch /tmp/nope) ' \"\n";
  for (const key of ["pi", "pi-sipos"]) {
    const argv = launchArgv(key, prompt);
    assert.equal(argv[4], prompt);
    assert.match(argv[2], / -- "\$1"$/);
    assert.doesNotMatch(argv[2], /--resume|--fork-session|--model|--provider/);
    assert.match(argv[2], key === "pi" ? /PI_CODING_AGENT_DIR/ : /bin\/pi-sipos/);
  }
  assert.throws(() => launchArgv("pi", "hello", ["--resume", "id"]), /Claude/);
});

test("Claude SIPOS uses explicit environment command rather than a Nu function", () => {
  assert.deepEqual(launchArgv("claude-sipos"), ["bash", "-ilc", 'env CLAUDE_CONFIG_DIR="$HOME/.claude-sipos" claude']);
});

test("unknown launchers fail closed instead of silently opening the first account", () => {
  assert.throws(() => launchArgv("deleted-profile"), /launcher/i);
});

test("an account key opens the first launcher that names it; a launcher key opens that launcher", () => {
  assert.equal(launcherOf("work").key, "work");
  assert.equal(launcherOf("codex").key, "codex");
  assert.equal(launcherOf("claude-sipos").key, "claude-sipos");
});

/** @param {number} h5 @param {number} [d7] */
const usage = (h5, d7 = 10) => ({ h5: { pct: h5 }, d7: { pct: d7 }, updated: 1 });
const launcher = (/** @type {string} */ key) => launcherOf(key);

test("a Claude launcher whose account is full offers the other account's launcher and says why", () => {
  for (const [window, quotas] of [["5h", { personal: usage(100) }], ["7d", { personal: usage(20, 100) }]]) {
    const choice = launchChoice(launcher("claude-sipos"), quotas);
    assert.equal(choice.launcher.key, "work", window);
    assert.equal(choice.note, `Personal is at 100% (${window})`);
  }
});

test("the fallback keeps the profile: the other account's launcher of the same folder and settings wins", () => {
  const choice = launchChoice(launcher("work"), { work: usage(100), personal: usage(20) });
  assert.equal(choice.launcher.key, "work-on-personal");
  assert.equal(choice.note, "Work is at 100% (5h)");
});

test("an account opens its default launcher, else the first that names it, whatever the list order", async () => {
  const { resolveLauncher } = await import("../lib/launchers.js");
  const accounts = [{ key: "w" }], list = [{ key: "a", account: "w" }, { key: "b", account: "w", default: true }, { key: "c", account: "w" }];
  assert.equal(resolveLauncher("w", list, accounts).key, "b");
  assert.equal(resolveLauncher("w", list.map(({ default: _d, ...l }) => l), accounts).key, "a");
  assert.equal(resolveLauncher("c", list, accounts).key, "c", "a launcher key still resolves to itself");
});

test("with no launcher of the same profile, the other account's default launcher is the one offered", () => {
  const sipos = launcher("claude-sipos"), requested = { ...launcher("work"), profile: "nowhere" };
  assert.equal(launchChoice(requested, { work: usage(100) }).launcher.key, "personal");
  sipos.default = true;
  try {
    assert.equal(launchChoice(requested, { work: usage(100) }).launcher.key, "claude-sipos");
  } finally {
    delete sipos.default;
  }
});

test("an account's login is renewed by the launcher of its own folder, whatever the list order", () => {
  assert.equal(loginLauncher(ACCOUNTS[1]).key, "work");
  // A token launcher for the personal account comes first in the list but runs another folder.
  assert.equal(loginLauncher({ key: "personal", claudeDir: ".claude-sipos" }).key, "claude-sipos");
  assert.equal(loginLauncher({ key: "personal", claudeDir: ".nowhere" }).key, launcherOf("personal").key, "no match falls back to the default");
});

test("with room, or when every account is full, there is nothing to offer", () => {
  const requested = launcher("claude-sipos");
  for (const quotas of [{}, { personal: usage(40) }, { personal: usage(100), work: usage(100) }, { personal: usage(100), work: usage(10, 100) }]) {
    assert.deepEqual(launchChoice(requested, quotas), { launcher: requested, note: null });
  }
});

test("Pi and Codex launchers are never offered another account", () => {
  const full = { personal: usage(100), work: usage(10), codex: usage(100) };
  for (const key of ["pi", "pi-sipos", "codex"]) {
    assert.deepEqual(launchChoice(launcher(key), full), { launcher: launcher(key), note: null }, key);
  }
});

test("the sidebar launch asks before using another account, and opens the requested one otherwise", async () => {
  resetFake();
  const { Sidebar } = await import("../sidebar.js");
  fake.focused = { cwd: "/repo" };
  const sidebar = new Sidebar();
  sidebar.quota = { personal: usage(100) };
  sidebar.launch("claude-sipos");
  assert.deepEqual(fake.runs, [], "nothing opens before the answer");
  assert.deepEqual(fake.overlays.at(-1), { mod: "relevo", kind: "dialog", width: 420, height: 150,
    props: { role: "fallback", note: "Personal is at 100% (5h)", folder: "/repo", requested: "claude-sipos", alternative: "work" } });
  assert.deepEqual(fake.notices, []);
  sidebar.quota = { personal: usage(30) };
  sidebar.launch(launcher("claude-sipos"));
  assert.deepEqual(fake.runs, [["tab.new", { folder: "/repo", argv: launchArgv("claude-sipos") }]]);
});

test("the fallback dialog opens the launcher that was answered, and nothing else", async () => {
  resetFake();
  const { Fallback } = await import("../fallback.js");
  fake.props = { role: "fallback", folder: "/repo", requested: "claude-sipos", alternative: "work", note: "Personal is at 100% (5h)" };
  const dialog = new Fallback();
  dialog.open("work");
  assert.deepEqual(fake.runs, [["tab.new", { folder: "/repo", argv: launchArgv("work") }]]);
  dialog.open("claude-sipos");
  assert.deepEqual(fake.runs[1], ["tab.new", { folder: "/repo", argv: launchArgv("claude-sipos") }]);
  dialog.open("gone");
  assert.equal(fake.runs.length, 2, "an unknown launcher opens nothing");
  const { find, fakeCx, text } = await import("./fake/ui.mjs");
  const ui = dialog.render(), cx = fakeCx();
  assert.match(text(ui), /Personal is at 100% \(5h\)/);
  assert.match(text(ui), /Open Claude SIPOS anyway, or use Work Claude instead\?/);
  find(ui, "fallback-switch").handlers.on_click({}, cx);
  find(ui, "fallback-anyway").handlers.on_click({}, cx);
  assert.deepEqual(fake.runs.slice(2).map(([, a]) => a.argv), [launchArgv("work"), launchArgv("claude-sipos")]);
});

test("the setup shared with the agents list has accounts and launchers, no contexts", () => {
  resetFake();
  publishSetup(ACCOUNTS, [launcher("pi")]);
  assert.deepEqual(Object.keys(fake.stored["relevo.setup"]).sort(), ["accounts", "launchers"]);
});
