// GIT_READ against a real repo: the reads the Inbox repeats must not touch what its folder watch looks at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_READ } from "../lib/git.js";

function snapshot(dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), s = statSync(path);
    if (s.isDirectory()) snapshot(path, out);
    else out[path] = s.mtimeMs;
  }
  return out;
}

test("GIT_READ: status, diff and ls-files write nothing under .git, even with a stale index", () => {
  const repo = mkdtempSync(join(tmpdir(), "relevo-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    // A commit starts background maintenance, whose lock would come and go between the snapshots.
    git("config", "maintenance.auto", "false");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-qm", "first");
    // Same content with a new time: a plain `git diff` or `git status` would refresh the index.
    const later = new Date(Date.now() + 60000);
    utimesSync(join(repo, "a.txt"), later, later);
    const before = snapshot(join(repo, ".git"));
    git(...GIT_READ, "diff", "HEAD", "--shortstat");
    git(...GIT_READ, "ls-files", "--others", "--exclude-standard");
    git(...GIT_READ, "status", "--porcelain");
    assert.deepEqual(snapshot(join(repo, ".git")), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
