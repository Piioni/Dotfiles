import "../../relevo/test/fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fake, resetFake } from "../../relevo/test/fake/herdr.mjs";
import { fakeCx, flush, text } from "../../relevo/test/fake/ui.mjs";

const { directory } = await import("../main.js");
const { NameDialog } = await import("../actions.js");

beforeEach(resetFake);

test("the file browser does not follow symlinks outside its selected folder", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piioni-files-root-"));
  const outside = mkdtempSync(join(tmpdir(), "piioni-files-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(outside, "private"));
  mkdirSync(join(root, "inside"));
  writeFileSync(join(root, "normal.txt"), "inside");
  writeFileSync(join(outside, "secret.txt"), "outside");
  symlinkSync(join(outside, "private"), join(root, "linked-dir"));
  symlinkSync(join(outside, "secret.txt"), join(root, "linked-file"));
  symlinkSync(join(outside, "missing"), join(root, "dangling"));
  fake.exec = /** @type {(cmd?: string, args?: string[]) => {code: number, stdout: string, stderr: string}} */ ((cmd = "", args = []) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  });

  assert.deepEqual(await directory(root, null), [
    { name: "inside", dir: true },
    { name: "normal.txt", dir: false },
  ]);
});

test("creating a Windows name with a path separator is rejected before filesystem changes", async () => {
  fake.window.platform = "windows";
  fake.props = { mode: "new-file", root: "C:\\work", path: "", dir: true, overlay: "name" };
  const writes = /** @type {Array<[string, string, string | null]>} */ ([]);
  fake.exec = async () => ({ code: 1, stdout: "", stderr: "" });
  fake.write = /** @type {(path: string, body: string, expected: string | null) => null} */ ((path, body, expected) => {
    writes.push([path, body, expected]);
    return null;
  });
  const dialog = new NameDialog();
  const cx = fakeCx();
  dialog.init();
  dialog.input.set_value("..\\outside.txt");
  const context = /** @type {import("gpui-kit").Context} */ (/** @type {unknown} */ (cx));
  dialog.submit(context);
  await flush();

  assert.match(text(dialog.render()), /A name can't contain/);
  assert.deepEqual(writes, []);
  assert.deepEqual(fake.execs, []);
});
