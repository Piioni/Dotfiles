import { test } from "node:test";
import assert from "node:assert/strict";
import { statArgs, trashArgs, revealArgs } from "../lib/platform.js";

test("Linux file operations use Fedora-compatible stat, trash, and reveal commands", () => {
  assert.deepEqual(statArgs("linux", "/work/a file.txt"), ["stat", ["-c", "%s", "/work/a file.txt"]]);
  assert.deepEqual(trashArgs("linux", "/work/a file.txt"), ["gio", ["trash", "/work/a file.txt"]]);
  assert.deepEqual(revealArgs("linux", "/work/a file.txt"), ["xdg-open", ["/work"]]);
});

test("other platforms retain native file operation behavior", () => {
  assert.deepEqual(statArgs("macos", "/work/a.txt"), ["stat", ["-f", "%z", "/work/a.txt"]]);
  assert.deepEqual(trashArgs("macos", "/work/a.txt"), ["/usr/bin/trash", ["/work/a.txt"]]);
  assert.deepEqual(revealArgs("macos", "/work/a.txt"), ["open", ["-R", "/work/a.txt"]]);
  assert.deepEqual(statArgs("windows", "C:\\work\\a.txt"), ["powershell", ["-NoProfile", "-Command", "(Get-Item -LiteralPath 'C:\\work\\a.txt').Length"]]);
  assert.deepEqual(trashArgs("windows", "C:\\work\\a.txt"), ["powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('C:\\work\\a.txt',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"]]);
  assert.deepEqual(revealArgs("windows", "C:\\work\\a.txt"), ["explorer", ["/select,C:\\work\\a.txt"]]);
});
