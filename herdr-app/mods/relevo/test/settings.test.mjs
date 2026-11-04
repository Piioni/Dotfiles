import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "./fake/register.mjs";
import * as example from "./fake/legacy-config.mjs";
import * as profiles from "./fake/config.mjs";
import { fake, resetFake } from "./fake/herdr.mjs";
import { fakeCx, flush, find, click, text } from "./fake/ui.mjs";
import { WRITE_SCRIPT, renderConfig, validate, slug, parseList, loginArgv } from "../lib/settings.js";

/** @param {Record<string, any>} m @returns {Record<string, any>} */
const plain = (m) => JSON.parse(JSON.stringify({ ...m }));

/** @param {Record<string, any>} config */
async function roundTrip(config) {
  const dir = await mkdtemp(join(tmpdir(), "relevo-settings-"));
  try {
    const file = join(dir, "config.mjs");
    await writeFile(file, renderConfig(config));
    return plain(await import(pathToFileURL(file).href));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("renderConfig: the example's values import back unchanged", async () => {
  assert.deepEqual(await roundTrip(plain(example)), plain(example));
});

test("renderConfig: odd strings survive and long entries wrap under 130 columns", async () => {
  const c = plain(example);
  c.ACCOUNTS[0].launcher = `say "hi" \\ 'there' $HOME \`x\` ${"z".repeat(140)}`;
  c.ACCOUNTS[1].label = "Trabajo — ñandú";
  assert.deepEqual(await roundTrip(c), c);
  const lines = renderConfig(plain(example)).split("\n");
  assert.ok(lines.every((l) => l.length <= 130));
  assert.equal(lines.filter((l) => l.startsWith("export const ")).length, 4);
});

test("validate: the example is valid", () => {
  assert.deepEqual(validate(plain(example)), []);
});

/** @param {(config:Record<string, any>)=>void} edit */
const broken = (edit) => {
  const c = plain(example);
  edit(c);
  return validate(c).map((e) => e.at);
};

test("validate: catches each rule", () => {
  assert.ok(broken((c) => { c.ACCOUNTS = []; }).includes("accounts"));
  for (const field of ["key", "label", "launcher", "claudeDir", "bg", "fg"]) {
    assert.ok(broken((c) => { c.ACCOUNTS[1][field] = ""; }).includes(`accounts.1.${field}`), field);
  }
  assert.ok(broken((c) => { c.ACCOUNTS[1].key = "personal"; }).includes("accounts.1.key"));
  assert.ok(broken((c) => { c.ACCOUNTS[1].key = "codex"; }).includes("accounts.1.key"));
  assert.ok(broken((c) => { c.ACCOUNTS[1].key = "a/b"; }).includes("accounts.1.key"));
  assert.ok(broken((c) => { c.ACCOUNTS[0].bg = "green"; }).includes("accounts.0.bg"));
  assert.ok(broken((c) => { c.ACCOUNTS[0].fg = "#12345"; }).includes("accounts.0.fg"));
  assert.deepEqual(broken((c) => { c.ACCOUNTS[0].letter = "ABC"; }), [], "an old badge letter is ignored");
  assert.ok(broken((c) => { c.CODEX.launcher = " "; }).includes("codex.launcher"));
  assert.ok(broken((c) => { c.REPOS_ROOT = ""; }).includes("reposRoot"));
  assert.ok(broken((c) => { c.REPOS_ROOT = "/home/me/code"; }).includes("reposRoot"));
  assert.ok(broken((c) => { c.REPOS_ROOT = "~/code"; }).includes("reposRoot"));
  assert.ok(broken((c) => { c.SKILLS.fix = ""; }).includes("skills.fix"));
  assert.ok(broken((c) => { delete c.SKILLS.comments; }).includes("skills"));
});

test("slug and parseList", () => {
  assert.equal(slug("  Client Work — Ñu! "), "client-work-nu");
  assert.deepEqual(parseList(" a, b,, c ,"), ["a", "b", "c"]);
});

test("WRITE_SCRIPT: replaces the file in one rename, text passed as argv", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relevo-write-"));
  try {
    const file = join(dir, "config.js"), text = "x $(touch pwned) `y` \"z\" %s\n";
    await writeFile(file, "old");
    execFileSync("sh", ["-c", WRITE_SCRIPT, "sh", file, text]);
    assert.equal(await readFile(file, "utf8"), text);
    assert.deepEqual(await readdir(dir), ["config.js"]);
    assert.equal((await stat(file)).mode & 0o777, 0o644);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("Settings collect/save/reload preserves launcher routing, stable keys and unknown values", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  assert.ok(settings.launchers?.length, "named profiles are editable independently of accounts");
  settings.accounts[0].inputs.label.set_value("Renamed account");
  const c = settings.collect();
  assert.equal(c.ACCOUNTS[0].key, "personal");
  assert.equal(c.LAUNCHERS.find((/** @type {Record<string, any>} */ l) => l.key === "claude-sipos").account, "personal");
  assert.equal(c.LAUNCHERS.find((/** @type {Record<string, any>} */ l) => l.key === "pi-sipos").account, undefined);
  assert.equal(c.ACCOUNTS[0].futureSetting, "keep me");
  assert.deepEqual(c.EXTRA_SETTING, { enabled: true });
  assert.deepEqual(validate(c), []);
  const dir = await mkdtemp(join(tmpdir(), "relevo-dialog-"));
  try {
    const file = join(dir, "config.mjs");
    fake.exec = (cmd, args) => {
      assert.equal(cmd, "sh");
      assert.equal(args[3], "/home/test/.config/herdr-app/mods/relevo/config.js");
      execFileSync(cmd, [...args.slice(0, 3), file, args[4]]);
      return { code: 0 };
    };
    settings.save(cx);
    await flush();
    assert.deepEqual(plain(await import(pathToFileURL(file).href)), c);
    assert.deepEqual(await readdir(dir), ["config.mjs"]);
  } finally { settings.close(); await rm(dir, { recursive: true, force: true }); }
});

test("removing an account a launcher uses blocks Save until the launcher is repaired", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  settings.removeAccount(settings.accounts[1], cx);
  settings.save(cx);
  await flush();
  assert.deepEqual(fake.execs, []);
  assert.ok(settings.errors.some((e) => e.at === "launchers.1.account"));
  settings.close();
});

test("validate: profile routing rejects fixed Pi accounts, unknown accounts and unsafe folders", () => {
  const cases = [
    ["launchers.3.account", (/** @type {Record<string, any>} */ c) => { c.LAUNCHERS[3].account = "personal"; }],
    ["launchers.0.account", (/** @type {Record<string, any>} */ c) => { c.LAUNCHERS[0].account = "removed"; }],
    ["launchers.2.claudeDir", (/** @type {Record<string, any>} */ c) => { c.LAUNCHERS[2].claudeDir = "../outside"; }],
  ];
  for (const [at, edit] of /** @type {Array<[string, (c:Record<string, any>)=>void]>} */ (cases)) {
    const c = plain(profiles);
    edit(c);
    assert.ok(validate(c).some((e) => e.at === at), at);
  }
});

test("an old config's CONTEXTS, FALLBACK and account default launchers load, validate and are dropped on save", async () => {
  resetFake();
  assert.ok(profiles.CONTEXTS && profiles.FALLBACK && profiles.ACCOUNTS[0].defaultLauncher, "the fake config is an old-shape one");
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  const c = settings.collect();
  assert.deepEqual(validate(c), []);
  assert.equal("CONTEXTS" in c || "FALLBACK" in c, false);
  assert.ok(c.ACCOUNTS.every((/** @type {Record<string, any>} */ a) => !("defaultLauncher" in a)));
  assert.equal("defaultLauncher" in c.CODEX, false);
  assert.doesNotMatch(renderConfig(c), /CONTEXTS|FALLBACK|defaultLauncher/);
  settings.close();
});

test("Settings buttons use the click context, not an expired render context", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings();
  const stale = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  const current = fakeCx();
  settings.init({}, stale);
  stale.notify = () => { throw new Error("expired render context"); };
  settings.tab = "launchers";
  const before = settings.launchers.length;
  click(find(settings.render(stale), "settings-add-launcher"), current);
  assert.equal(settings.launchers.length, before + 1);
  assert.equal(current.notified, 1);
  settings.close();
});

test("Settings opens on the requested section and jumps to the first invalid item on Save", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({ tab: "accounts" }, cx);
  assert.equal(settings.tab, "accounts");
  settings.close();
  const old = new Settings();
  old.init({ tab: "contexts" }, cx);
  assert.equal(old.tab, "launchers", "a removed section falls back to launchers");
  old.close();
  settings.init({}, cx);
  settings.tab = "advanced";
  settings.launchers[2].inputs.label.set_value("");
  settings.save(cx);
  assert.equal(settings.tab, "launchers");
  assert.equal(settings.current(), settings.launchers[2]);
  assert.ok(settings.issues("launchers", settings.launchers[2]).length > 0);
  assert.equal(settings.issues("launchers", settings.launchers[0]).length, 0);
  assert.deepEqual(fake.execs, []);
  settings.close();
});

test("Settings selects a newly added item and falls back when the selection is removed", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  settings.addLauncher(cx);
  const added = settings.launchers.at(-1);
  assert.equal(settings.current(), added);
  settings.removeLauncher(added, cx);
  assert.equal(settings.current(), settings.launchers[0]);
  settings.close();
});

test("saving drops an old badge letter, and Settings no longer edits one", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  assert.equal(settings.accounts[0].inputs.letter, undefined);
  assert.ok(settings.collect().ACCOUNTS.every((/** @type {Record<string, any>} */ a) => !("letter" in a)));
  assert.equal("letter" in settings.collect().CODEX, false);
  settings.close();
});

test("a launcher can be the default of its account, one per account, and the saved config says which", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  const [personal, , sipos] = settings.launchers;
  assert.equal(personal.account, sipos.account, "two launchers share an account");
  const defaults = () => settings.collect().LAUNCHERS.filter((/** @type {Record<string, any>} */ l) => l.default).map((/** @type {Record<string, any>} */ l) => l.key);
  assert.deepEqual(defaults(), []);
  settings.setDefault(personal, true, cx);
  settings.setDefault(sipos, true, cx);
  assert.deepEqual(defaults(), ["claude-sipos"], "marking one clears the other of that account");
  assert.deepEqual(validate(settings.collect()).filter((e) => e.at.endsWith(".default")), []);
  settings.setDefault(sipos, false, cx);
  assert.deepEqual(defaults(), []);
  personal.isDefault = sipos.isDefault = true;
  assert.ok(validate(settings.collect()).some((e) => /^launchers\.\d+\.default$/.test(e.at)), "two defaults for one account are refused");
  settings.close();
});

test("the launcher editor offers the default toggle only when the launcher has an account", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  const pi = settings.launchers.find((l) => l.app === "pi"), claude = settings.launchers[0];
  settings.select("launchers", pi);
  assert.equal(find(settings.render(cx), `launcher-default-${pi.id}-0`), null);
  settings.select("launchers", claude);
  find(settings.render(cx), `launcher-default-${claude.id}-0`).handlers.on_click({}, cx);
  assert.equal(claude.isDefault, true);
  settings.close();
});

test("a launcher moves up and down the list, stops at the ends, and the saved config keeps the order", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  const keys = () => settings.collect().LAUNCHERS.map((/** @type {Record<string, any>} */ l) => l.key);
  const before = keys(), row = settings.launchers[2];
  settings.select("launchers", row);
  settings.moveLauncher(row, -1, cx);
  assert.deepEqual(keys(), [before[0], before[2], before[1], ...before.slice(3)]);
  assert.equal(settings.current(), row, "the moved launcher stays selected");
  settings.moveLauncher(row, 1, cx);
  assert.deepEqual(keys(), before);
  settings.moveLauncher(settings.launchers[0], -1, cx);
  settings.moveLauncher(settings.launchers.at(-1), 1, cx);
  assert.deepEqual(keys(), before, "the ends don't wrap");
  settings.close();
});

test("a new account is valid without editing colors", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  settings.addAccount(cx);
  const row = settings.accounts.at(-1);
  row.inputs.label.set_value("Work");
  row.inputs.claudeDir.set_value(".claude-work");
  const errors = validate(settings.collect()).filter((e) => e.at.startsWith(`accounts.${settings.accounts.length - 1}.`));
  assert.deepEqual(errors.filter((e) => /\.(bg|fg)$/.test(e.at)), []);
  settings.close();
});

test("Settings reports write failure and allows retry without losing edits", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  fake.exec = () => ({ code: 1, stderr: "permission denied" });
  settings.reposRoot.set_value("projects");
  settings.save(cx);
  await flush();
  assert.equal(settings.saving, false);
  assert.deepEqual(settings.errors, [{ at: "write", message: "permission denied" }]);
  assert.equal(settings.collect().REPOS_ROOT, "projects");
  settings.close();
});

test("Settings has no Contexts section, fallback order or per-account default chips", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  for (const tab of ["launchers", "accounts", "advanced"]) {
    settings.tab = tab;
    const ui = settings.render(cx);
    assert.equal(find(ui, "settings-add-context"), null, tab);
    assert.equal(find(ui, "settings-fallback"), null, tab);
    assert.equal(find(ui, "account-default-0"), null, tab);
    assert.doesNotMatch(text(ui), /context|fallback order/i, tab);
  }
  assert.ok(find(settings.render(cx), "settings-repos-root"));
  settings.close();
});

test("loginArgv: Claude opens its own folder through a positional argument, Codex runs codex login", () => {
  assert.deepEqual(loginArgv("codex"), ["bash", "-ilc", "codex login"]);
  assert.deepEqual(loginArgv("claude", ".claude-work"), ["bash", "-ilc", 'env CLAUDE_CONFIG_DIR="$HOME/$1" claude', "bash", ".claude-work"]);
  assert.deepEqual(loginArgv("claude", ".claude"), ["bash", "-ilc", "env -u CLAUDE_CONFIG_DIR claude"]);
  assert.equal(loginArgv("claude", "../outside"), null);
  assert.equal(loginArgv("claude", ""), null);
});

test("an account's Log in button opens a new tab with that account's login command", async () => {
  resetFake();
  const { Settings } = await import("../settings.js");
  const settings = new Settings(), cx = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (fakeCx()));
  settings.init({}, cx);
  settings.tab = "accounts";
  settings.sel = settings.accounts[1];
  click(find(settings.render(cx), "account-login-1"), fakeCx());
  assert.deepEqual(fake.runs, [["tab.new", { argv: ["bash", "-ilc", 'env CLAUDE_CONFIG_DIR="$HOME/$1" claude', "bash", ".claude-work"] }]]);
  settings.sel = settings.codex;
  click(find(settings.render(cx), "account-login-codex"), fakeCx());
  assert.deepEqual(fake.runs[1], ["tab.new", { argv: ["bash", "-ilc", "codex login"] }]);
  settings.accounts[1].inputs.claudeDir.set_value("../outside");
  settings.sel = settings.accounts[1];
  assert.equal(find(settings.render(cx), "account-login-1").handlers.on_click, undefined, "an unsafe folder never reaches a shell");
  settings.close();
});
