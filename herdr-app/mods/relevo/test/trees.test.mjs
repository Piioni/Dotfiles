// Removing a merged worktree on a fake app: what's checked again, and what the confirmation says.
import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fake, resetFake, calls } from "./fake/herdr.mjs";
import { fakeCx, flush, text } from "./fake/ui.mjs";

const { TreeViews } = await import("../inbox-trees.js");
const { removalCheck, touchedAt } = await import("../worktrees.js");
const PATH = "/work/wt", REMOVE = /worktree remove/;
/** @typedef {{main:string,path:string,branch:string,repo:string,name:string,merged:boolean,dirty?:boolean,locked?:boolean,ignored?:string[],space?:string|null,open?:boolean,at?:number}} Worktree */
/** @typedef {{status?:string,ignored?:string,tracked?:string,nested?:string,locked?:boolean}} FileState */
/** @typedef {ReturnType<typeof fakeCx>} FakeCx */
/** @param {Partial<Worktree>} [over] @returns {Worktree} */
const tree = (over = {}) => ({ main: "/work/app", path: PATH, branch: "feat", repo: "app", name: "wt", merged: true, ...over });

/** @param {...Worktree} worktrees @returns {import("../inbox-trees.js").TreeViews} */
function view(...worktrees) {
  const v = new TreeViews();
  Object.assign(v, { worktrees, removing: new Set(), gone: new Set(), wtError: {}, expanded: {}, confirm: null, selected: () => false });
  return v;
}

/** @param {FileState} [state] */
function files({ status = "", ignored = "", tracked = "", nested = "", locked = false } = {}) {
  fake.exec = (cmd, args) => {
    if (cmd === "find") return { stdout: nested };
    if (args.includes("worktree") && args.includes("list")) return { stdout: `worktree ${PATH}\nHEAD abc\n${locked ? "locked\n" : ""}\n` };
    if (args.includes("--porcelain")) return { stdout: status };
    if (args.includes("--ignored")) return { stdout: ignored.includes("\0") ? ignored : ignored.replaceAll("\n", "\0") };
    if (args.includes("--stage")) return { stdout: tracked };
    return null;
  };
}

/** @param {import("../inbox-trees.js").TreeViews} v @param {Worktree} w @param {FakeCx} cx */
async function clickRemove(v, w, cx) {
  v.removeTree(w, cx);
  await flush();
}

beforeEach(() => {
  resetFake();
  files();
});

test("Remove asks, then removes a clean worktree", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.equal(v.confirm, PATH);
  assert.equal(calls(REMOVE).length, 0);
  await clickRemove(v, w, cx);
  assert.equal(calls(REMOVE).length, 1);
});

test("ignored work is named before it goes, while rebuilt folders aren't", async () => {
  files({ ignored: ".env\nnode_modules/\npackages/a/__pycache__/\n" });
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.deepEqual(w.ignored, [".env"]);
  assert.match(text(v.treeRow({}, w)), /deletes \.env/);
  await clickRemove(v, w, cx);
  assert.equal(calls(REMOVE).length, 1);
});

test("an ignored name with a newline is one file", async () => {
  files({ ignored: "a\nb.env\0" });
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.deepEqual(w.ignored, ["a\nb.env"]);
});

test("folders that only hold rebuilt or listed entries aren't named", async () => {
  files({ ignored: "emptyish/\0emptyish/node_modules/\0mixed/\0mixed/.env\0mixed/node_modules/\0" });
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.deepEqual(w.ignored, ["mixed/.env"]);
});

test("a second Confirm while the check runs removes once", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  v.removeTree(w, cx);
  v.removeTree(w, cx);
  await flush();
  assert.equal(calls(REMOVE).length, 1);
});

test("a space on another machine with the same folder isn't closed", async () => {
  fake.spaces = [{ id: "sp9", folder: PATH, machine: "devbox", tabs: [] }];
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  await clickRemove(v, w, cx);
  assert.deepEqual(fake.runs, []);
  assert.equal(calls(REMOVE).length, 1);
});

test("files that appear after the question ask again", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  files({ ignored: ".env\0" });
  await clickRemove(v, w, cx);
  assert.equal(calls(REMOVE).length, 0);
  assert.equal(v.confirm, PATH);
});

test("changes made since the scan stop it before its space closes", async () => {
  fake.spaces = [{ id: "sp1", folder: PATH }];
  const v = view(), w = tree({ space: "sp1" }), cx = fakeCx();
  await clickRemove(v, w, cx);
  files({ status: " M a.js\n" });
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], "uncommitted changes");
  assert.deepEqual(fake.runs, []);
  assert.equal(calls(REMOVE).length, 0);
});

test("a terminal opened here since the scan stops it", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  fake.panes = [{ pane: "p1", cwd: `${PATH}/src` }];
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], "open in a terminal");
  assert.equal(calls(REMOVE).length, 0);
});

test("a space's own terminals close with it; another's, or a working agent, stop it", async () => {
  fake.spaces = [{ id: "sp1", folder: PATH, tabs: [{ id: "tb1" }] }];
  fake.panes = [{ pane: "p1", cwd: PATH, tab: "tb1" }];
  const v = view(), w = tree({ space: "sp1" }), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], undefined);
  fake.panes = [{ pane: "p1", cwd: PATH, tab: "tb9" }];
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], "open in a terminal");
  fake.panes = [{ pane: "p1", cwd: PATH, tab: "tb1", status: "working" }];
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], "an agent is working here");
});

test("a space opened after the question asks again before closing it", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  fake.spaces = [{ id: "sp1", folder: PATH, tabs: [] }];
  await clickRemove(v, w, cx);
  assert.deepEqual(fake.runs, []);
  assert.equal(calls(REMOVE).length, 0);
  assert.match(text(v.treeRow({}, w)), /closes its space/);
});

test("Remove all leaves out worktrees with ignored work, even found after the scan", async () => {
  const a = tree(), b = tree({ path: "/work/wt2", ignored: [".env"] });
  const v = view(a, b), cx = fakeCx();
  assert.deepEqual(v.removable([a, b]), [a]);
  files({ ignored: "notes.md\0" });
  v.confirm = "all";
  v.removeAll([a], cx);
  await flush();
  assert.equal(calls(REMOVE).length, 0);
  assert.equal(v.wtError[PATH], "deletes notes.md");
});

test("Remove all leaves out a worktree that gained a space or a terminal after the scan", async () => {
  const a = tree(), b = tree({ path: "/work/wt2" });
  fake.spaces = [{ id: "sp1", folder: PATH, tabs: [] }];
  fake.panes = [{ pane: "p1", cwd: "/work/wt2", tab: "tb9" }];
  const v = view(a, b), cx = fakeCx();
  v.confirm = "all";
  v.removeAll([a, b], cx);
  await flush();
  assert.equal(calls(REMOVE).length, 0);
  assert.deepEqual(fake.runs, []);
  assert.equal(v.wtError[PATH], "has a space");
  assert.equal(v.wtError["/work/wt2"], "open in a terminal");
});

test("a branch git keeps is reported", async () => {
  fake.exec = (_cmd, args) => (args.includes("branch") ? { code: 1, stderr: "error: not fully merged\n" } : null);
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  await clickRemove(v, w, cx);
  assert.equal(fake.notices[0].title, "Kept branch feat");
});

/** @type {[string, FileState, string][]} */
const stopCases = [
  ["a repo inside an ignored folder", { ignored: "build/\n", nested: "./build/lib/.git\n" }, "holds a repo: build/lib"],
  ["a submodule", { tracked: "H 160000 abc 0\tsub\n" }, "has submodules"],
  ["a file git skips", { tracked: "S 100644 abc 0\ta.txt\n" }, "has files git skips"],
  ["a lock taken after the scan", { locked: true }, "locked"],
];
for (const [name, state, error] of stopCases) {
  test(`${name} stops it before its space closes`, async () => {
    files(state);
    fake.spaces = [{ id: "sp1", folder: PATH, tabs: [] }];
    const v = view(), w = tree({ space: "sp1" }), cx = fakeCx();
    await clickRemove(v, w, cx);
    assert.equal(v.wtError[PATH], error);
    assert.deepEqual(fake.runs, []);
  });
}

test("a folder that only might be rebuilt gets named", async () => {
  files({ ignored: "out/\n" });
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.deepEqual(w.ignored, ["out"]);
});

test("a space on another machine isn't this worktree's", async () => {
  fake.spaces = [{ id: "far", machine: "box", folder: PATH, tabs: [] }];
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  await clickRemove(v, w, cx);
  assert.deepEqual(fake.runs, []);
  assert.equal(calls(REMOVE).length, 1);
});

test("a space that appeared after the question asks again", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  fake.spaces = [{ id: "sp1", folder: PATH, tabs: [] }];
  await clickRemove(v, w, cx);
  assert.deepEqual(fake.runs, []);
  assert.equal(v.confirm, PATH);
  assert.match(text(v.treeRow({}, w)), /closes its space/);
});

test("a double click on Confirm removes once", async () => {
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  v.removeTree(w, cx);
  v.removeTree(w, cx);
  await flush();
  assert.equal(calls(REMOVE).length, 1);
});

test("a check that throws reports instead of removing", async () => {
  fake.exec = () => { throw new Error("gone"); };
  const v = view(), w = tree(), cx = fakeCx();
  await clickRemove(v, w, cx);
  assert.equal(v.wtError[PATH], "could not check its files");
});

// The same check on real git, whose output and refusals the fake only imitates.
/** @param {import("node:test").TestContext} t @param {string} [ignore] @returns {{w:Worktree,path:string,git:(...args:string[])=>string}} */
function realTree(t, ignore = ".env\nbuild/\nnode_modules/\n") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relevo-trees-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main"), path = join(root, "wt");
  /** @param {string} cwd @param {...string} args @returns {string} */
  const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "maintenance.auto=false", ...args], { cwd, encoding: "utf8" });
  mkdirSync(main);
  git(main, "init", "-q");
  writeFileSync(join(main, ".gitignore"), ignore);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "i");
  git(main, "worktree", "add", "-q", path, "-b", "feat");
  fake.exec = (cmd, args, options) => {
    const r = spawnSync(cmd, args, { cwd: options?.cwd, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** @param {...string} args */
  const gitInWorktree = (...args) => git(path, ...args);
  return { w: { main, path, branch: "feat", repo: "app", name: "wt", merged: false }, path, git: gitInWorktree };
}

test("Linux worktree recency includes the index timestamp", async (t) => {
  const { path } = realTree(t);
  fake.window.platform = "linux";
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: path, encoding: "utf8" }).trim();
  const expected = Math.floor(Date.now() / 1000) + 60;
  utimesSync(join(gitDir, "index"), expected, expected);

  assert.equal((await touchedAt([path])).get(path), expected);
});

test("real git: a clean worktree passes, and rebuilt folders aren't named", async (t) => {
  const { w, path } = realTree(t);
  mkdirSync(join(path, "node_modules"));
  writeFileSync(join(path, "node_modules", "x"), "x");
  const check = await removalCheck(w);
  assert.equal(check.error, undefined);
  assert.deepEqual(check.ignored, []);
});

test("real git: ignored work is named, odd names unquoted", async (t) => {
  const { w, path } = realTree(t, ".env\n*.local\n");
  writeFileSync(join(path, ".env"), "x");
  writeFileSync(join(path, "café notes.local"), "x");
  assert.deepEqual((await removalCheck(w)).ignored.sort(), [".env", "café notes.local"]);
});

test("real git: untracked files count even when status hides them", async (t) => {
  const { w, path, git } = realTree(t);
  git("config", "status.showUntrackedFiles", "no");
  writeFileSync(join(path, "notes.md"), "mine");
  assert.equal((await removalCheck(w)).error, "uncommitted changes");
});

test("real git: edits git is told to skip stop it", async (t) => {
  const { w, path, git } = realTree(t);
  git("update-index", "--skip-worktree", "a.txt");
  writeFileSync(join(path, "a.txt"), "edited");
  assert.equal((await removalCheck(w)).error, "has files git skips");
});

test("real git: a repo inside an ignored folder stops it", async (t) => {
  const { w, path } = realTree(t);
  mkdirSync(join(path, "build", "lib"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: join(path, "build", "lib") });
  assert.equal((await removalCheck(w)).error, "holds a repo: build/lib");
});

test("real git: a submodule entry stops it, as git itself would", async (t) => {
  const { w, path, git } = realTree(t);
  const sha = git("rev-parse", "HEAD").trim();
  git("update-index", "--add", "--cacheinfo", `160000,${sha},sub`);
  git("commit", "-qm", "sub");
  assert.equal((await removalCheck(w)).error, "has submodules");
  assert.ok(existsSync(path));
});

test("real git: a lock stops it", async (t) => {
  const { w, git } = realTree(t);
  git("worktree", "lock", w.path);
  assert.equal((await removalCheck(w)).error, "locked");
});

test("real git: a tool's clones don't stop it, wherever its folder sits, and aren't named", async (t) => {
  const { w, path } = realTree(t, ".build/\nvendor/\n");
  for (const clone of [join(".build", "checkouts", "x"), join("vendor", "pkg", ".build", "checkouts", "y")]) {
    mkdirSync(join(path, clone), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: join(path, clone) });
  }
  const check = await removalCheck(w);
  assert.equal(check.error, undefined);
  assert.deepEqual(check.ignored, ["vendor"]);
});

test("real git: a repo beside a tool's folder still stops it", async (t) => {
  const { w, path } = realTree(t, ".build/\nvendor/\n");
  mkdirSync(join(path, ".build"));
  mkdirSync(join(path, "vendor", "mylib"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: join(path, "vendor", "mylib") });
  assert.equal((await removalCheck(w)).error, "holds a repo: vendor/mylib");
});

test("real git: a search that can't finish stops it", async (t) => {
  const { w, path } = realTree(t, "vendor/\n");
  const closed = join(path, "vendor", "closed");
  mkdirSync(closed, { recursive: true });
  writeFileSync(join(path, "vendor", "kept.txt"), "x");
  chmodSync(closed, 0o000);
  try {
    assert.equal((await removalCheck(w)).error, "could not check its files");
  } finally {
    chmodSync(closed, 0o755);
  }
});
