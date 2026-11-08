import test from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, wtName, compile, parseHeader, dropKeys, failure } from "../model.js";

const PORCELAIN = [
  "worktree /home/u/app\nHEAD aaa\nbranch refs/heads/feat/main-work",
  "worktree /home/u/app.POS-502-armazon\nHEAD bbb\nbranch refs/heads/feat/POS-502",
  "worktree /home/u/app/.claude/worktrees/revision-pr-278\nHEAD ccc\ndetached",
  "worktree /home/u/app.gone\nHEAD ddd\nbranch refs/heads/old\nprunable gitdir file points to non-existent location",
  "worktree /srv/bare.git\nbare",
].join("\n\n") + "\n";

test("worktrees: main first, branch kept, detached has none, bare and prunable ones are left out", () => {
  const list = parseWorktrees(PORCELAIN);
  assert.deepEqual(list.map((w) => w.path), ["/home/u/app", "/home/u/app.POS-502-armazon", "/home/u/app/.claude/worktrees/revision-pr-278"]);
  assert.equal(list[0].branch, "feat/main-work");
  assert.equal(list[2].branch, null);
});

test("worktree names: the main checkout by its folder, linked ones without the repo prefix", () => {
  assert.equal(wtName("/home/u/app", "/home/u/app"), "app");
  assert.equal(wtName("/home/u/app.POS-502-armazon", "/home/u/app"), "POS-502-armazon");
  assert.equal(wtName("/home/u/app/.claude/worktrees/revision-pr-278", "/home/u/app"), "revision-pr-278");
  assert.equal(wtName("/home/u/elsewhere", "/home/u/app"), "elsewhere");
});

test("header patterns are regexes that match across lines, case-insensitively; a broken one is null", () => {
  assert.ok(compile("key commands").test("Flutter Run Key Commands."));
  assert.ok(compile("^Performing hot reload\\.\\.\\.[^0-9\\n]*$").test("done\nPerforming hot reload..."));
  assert.equal(compile("Performing hot reload...      1,561ms") instanceof RegExp, true);
  assert.equal(compile("(unbalanced"), null);
});

test("header: name, ready, reload and busy are read from the first lines, CRLF included", () => {
  const h = parseHeader("#!/usr/bin/env bash\r\n# name: dev\r\n# ready: Flutter run key commands\r\n# reload: r\r\n# busy: Performing hot reload\r\nrun\r\n", "dev.sh");
  assert.deepEqual(h, { name: "dev", ready: "Flutter run key commands", reload: "r", busy: "Performing hot reload", problems: [] });
});

test("header: no name falls back to the file's, and lines past the eighth are ignored", () => {
  assert.equal(parseHeader("true\n", "check").name, "check");
  const late = parseHeader("1\n2\n3\n4\n5\n6\n7\n8\n# ready: late\n", "x");
  assert.equal(late.ready, undefined);
});

test("header: a pattern that is not a valid regex is dropped and reported, not kept to spin forever", () => {
  const h = parseHeader("# name: dev\n# ready: (broken\n# busy: also (broken\n# reload: r\n", "dev");
  assert.equal(h.ready, undefined);
  assert.equal(h.busy, undefined);
  assert.equal(h.reload, "r");
  assert.deepEqual(h.problems, ["# ready: is not a valid regex", "# busy: is not a valid regex"]);
});

test("dropping keys works on the current map, so an entry added meanwhile survives", () => {
  const snapshot = { a: 1, b: 2 };
  const current = { a: 1, b: 2, c: 3 };
  const out = dropKeys(current, ["a"]);
  assert.deepEqual(out, { b: 2, c: 3 });
  assert.deepEqual(current, { a: 1, b: 2, c: 3 });
  assert.deepEqual(snapshot, { a: 1, b: 2 });
  assert.deepEqual(dropKeys({}, ["a"]), {});
});

test("failure text: the message of an hc JSON error, else the first line, else nothing", () => {
  assert.equal(failure('{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \\"t9\\""}}'), 'no terminal "t9"');
  assert.equal(failure("fatal: not a git repository\nmore"), "fatal: not a git repository");
  assert.equal(failure("  \n"), "");
});
