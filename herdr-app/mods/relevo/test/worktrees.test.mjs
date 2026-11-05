// @ts-nocheck
import "./fake/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fake } from "./fake/herdr.mjs";

const { touchedAt } = await import("../worktrees.js");

test("Linux checkout recency includes the index timestamp", async (t) => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "relevo-touched-")));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: path, encoding: "utf8" });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "i");
  fake.window.platform = "linux";
  fake.exec = (cmd, args, options) => {
    const r = spawnSync(cmd, args, { cwd: options?.cwd, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const gitDir = git("rev-parse", "--absolute-git-dir").trim();
  const expected = Math.floor(Date.now() / 1000) + 60;
  utimesSync(join(gitDir, "HEAD"), expected, expected);

  assert.equal((await touchedAt([path])).get(path), expected);
});
