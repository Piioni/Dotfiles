import "./fake/register.mjs";
import { fake, resetFake } from "./fake/herdr.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const { launchArgv, launchInRepo, launchChoice, pickAccount, launcherOf, publishSetup, ACCOUNTS } = await import("../accounts.js");

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

test("PR work launches the chosen account's launcher in the repo's space", () => {
  resetFake();
  launchInRepo({ repo: "someone/project", folder: "/repo", tab: "task", account: "work", prompt: "review this" });
  assert.deepEqual(fake.runs[0], ["space.new", { name: "project", folder: "/repo", tab: "task", argv: launchArgv("work", "review this") }]);
  launchInRepo({ repo: "someone/project", folder: "/repo", tab: "task", account: "codex", prompt: "review this" });
  assert.deepEqual(fake.runs[1][1].argv, launchArgv("codex", "review this"));
});

/** @param {number} h5 @param {number} [d7] */
const usage = (h5, d7 = 10) => ({ h5: { pct: h5 }, d7: { pct: d7 }, updated: 1 });
const launcher = (/** @type {string} */ key) => launcherOf(key);

test("a Claude launcher whose account is full opens the other account's launcher and says so", () => {
  resetFake();
  for (const [window, quotas] of [["5h", { personal: usage(100) }], ["7d", { personal: usage(20, 100) }]]) {
    const choice = launchChoice(launcher("claude-sipos"), quotas, true);
    assert.equal(choice.launcher.key, "work", window);
    assert.equal(choice.note, `Personal is at 100% (${window}) — using Work`);
    assert.deepEqual(fake.notices.at(-1), { title: choice.note, level: "info" });
  }
  assert.equal(fake.notices.length, 2);
});

test("with room, or when every account is full, the requested launcher opens and nothing is announced", () => {
  resetFake();
  const requested = launcher("claude-sipos");
  for (const quotas of [{}, { personal: usage(40) }, { personal: usage(100), work: usage(100) }, { personal: usage(100), work: usage(10, 100) }]) {
    assert.deepEqual(launchChoice(requested, quotas, true), { launcher: requested, note: null });
  }
  assert.deepEqual(fake.notices, []);
  launchChoice(requested, { personal: usage(100) });
  assert.deepEqual(fake.notices, [], "a preview does not notify");
});

test("Pi and Codex launchers never fall back", () => {
  resetFake();
  const full = { personal: usage(100), work: usage(10), codex: usage(100) };
  for (const key of ["pi", "pi-sipos", "codex"]) {
    assert.deepEqual(launchChoice(launcher(key), full, true), { launcher: launcher(key), note: null }, key);
  }
  assert.deepEqual(fake.notices, []);
});

test("the sidebar launch uses its usage data and opens the fallback launcher", async () => {
  resetFake();
  const { Sidebar } = await import("../sidebar.js");
  fake.focused = { cwd: "/repo" };
  const sidebar = new Sidebar();
  sidebar.quota = { personal: usage(100) };
  sidebar.launch("claude-sipos");
  assert.deepEqual(fake.runs, [["tab.new", { folder: "/repo", argv: launchArgv("work") }]]);
  assert.match(fake.notices.at(-1)?.title ?? "", /Personal is at 100% \(5h\) — using Work/);
  sidebar.quota = { personal: usage(30) };
  sidebar.launch(launcher("claude-sipos"));
  assert.deepEqual(fake.runs[1][1].argv, launchArgv("claude-sipos"));
});

test("PR actions use the first Claude account, or the next one with room", () => {
  resetFake();
  assert.deepEqual(pickAccount({}), { key: "personal", note: null });
  assert.deepEqual(pickAccount({ personal: usage(100) }, true), { key: "work", note: "Personal is at 100% (5h) — using Work" });
  assert.equal(fake.notices.length, 1);
  assert.deepEqual(pickAccount({ personal: usage(100), work: usage(100) }), { key: "personal", note: null });
  assert.equal(ACCOUNTS[0].key, "personal");
});

test("the setup shared with the agents list has accounts and launchers, no contexts", () => {
  resetFake();
  publishSetup(ACCOUNTS, [launcher("pi")]);
  assert.deepEqual(Object.keys(fake.stored["relevo.setup"]).sort(), ["accounts", "launchers"]);
});

test("sending review comments on a PR with no agent starts one with the usage fallback", async () => {
  resetFake();
  fake.props = { root: "/repo", pr: { repo: "someone/project", number: 7, url: "https://github.com/someone/project/pull/7", base: "main" } };
  fake.stored["relevo.quota.api"] = { personal: { updated: Date.now() / 1000, rate_limits: { five_hour: { used_percentage: 100, resets_at: Date.now() / 1000 + 600 } } } };
  const { ReviewDiff } = await import("../review.js");
  const { fakeCx, flush } = await import("./fake/ui.mjs");
  const review = new ReviewDiff(), cx = fakeCx();
  review.init({}, /** @type {any} */ (cx));
  await flush();
  review.comments = [{ file: "a.ts", key: "+1", line: 1, side: "+", code: "x", text: "why" }];
  review.send(cx);
  await flush();
  const [name, args] = fake.runs.find(([n]) => n === "space.new" || n === "tab.new") ?? [];
  assert.equal(name, "space.new");
  assert.equal(args.argv[2], launcherOf("work").command + ' "$1"');
  assert.match(fake.notices.at(-1)?.title ?? "", /using Work/);
});
