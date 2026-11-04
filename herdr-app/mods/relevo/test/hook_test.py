"""From the repo root: python3 -m unittest discover -s mods/relevo/test -p '*_test.py'. Settings live in a temp home."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("labels", Path(__file__).resolve().parent.parent / "hooks/relevo-labels.py")
assert spec is not None and spec.loader is not None
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)

CONFIG = """export const ACCOUNTS = [
  { key: "personal", label: "Personal", letter: "P", launcher: "claude", claudeDir: ".claude", bg: "#000", fg: "#fff" },
  {
    key: "work", label: "Work", letter: "W", launcher: "x", claudeDir: ".claude-work",
    bg: "#000", fg: "#fff",
  },
];
export const CODEX = { key: "codex", label: "Codex", letter: "X", launcher: "codex", bg: "#000", fg: "#fff" };
"""
DIRS = {".claude": "personal", ".claude-work": "work"}


class Labels(unittest.TestCase):
    def test_accounts_read_config_and_skip_codex(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "config.js")
            Path(path).write_text(CONFIG, encoding="utf-8")
            self.assertEqual(hook.accounts(path), DIRS)
            # Launcher IDs are profiles, not additional provider identities.
            Path(path).write_text(CONFIG + '''
export const LAUNCHERS = [
  { key: "claude-profile", app: "claude", account: "personal", claudeDir: ".claude" },
  { key: "claude-sipos", app: "claude", account: "personal", claudeDir: ".claude-sipos" },
];
''', encoding="utf-8")
            self.assertEqual(hook.accounts(path), DIRS)

    def test_account_from_config_dir(self):
        with patch.dict(os.environ, {"HOME": "/h"}):
            self.assertEqual(hook.account_for(None, DIRS), "personal")
            self.assertEqual(hook.account_for("/h/.claude-work/", DIRS), "work")
            self.assertIsNone(hook.account_for("/h/.other", DIRS))

    def test_a_token_launcher_names_its_account_whatever_the_folder(self):
        with patch.dict(os.environ, {"HOME": "/h"}):
            self.assertEqual(hook.account_for("/h/.claude-work", DIRS, "personal"), "personal")
            self.assertEqual(hook.account_for("/h/.claude-work", DIRS, "unknown"), "work")
            self.assertEqual(hook.account_for("/h/.claude-work", DIRS, ""), "work")
            self.assertEqual(hook.account_for(None, DIRS, None), "personal")

    def test_labels_for_a_stop(self):
        data = {"hook_event_name": "Stop", "transcript_path": "/t.jsonl", "background_tasks": [{"type": "shell"}]}
        self.assertEqual(hook.labels(data, "work"), {
            "wait": "watch", "bg": "⧗ 1 shell", "account": "work", "transcript": "/t.jsonl",
        })

    def test_session_end_clears_every_label(self):
        self.assertEqual(set(hook.labels({"hook_event_name": "SessionEnd"}, "work").values()), {""})

    def test_a_hook_outside_herdr_does_nothing(self):
        with patch.dict(os.environ, clear=True), patch.object(hook.subprocess, "run") as run:
            hook.on_hook()
        run.assert_not_called()


class Manage(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        patcher = patch.dict(os.environ, {"HOME": self.home.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.root = Path(self.home.name, ".claude")
        self.root.mkdir()
        self.path = self.root / "settings.json"

    def run_it(self, action, dirs=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = hook.manage(action, dirs or {".claude": "personal"})
        return code, out.getvalue()

    def read(self):
        return json.loads(self.path.read_text(encoding="utf-8"))

    def backups(self):
        return list(self.root.glob("settings.json.relevo-backup-*"))

    def test_install_keeps_everything_else_and_is_idempotent(self):
        other = {"hooks": [{"type": "command", "command": "other"}]}
        self.path.write_text(json.dumps({"model": "m", "hooks": {"Stop": [other]}}), encoding="utf-8")
        self.assertEqual(self.run_it("--check")[0], 1)
        self.assertEqual(self.run_it("--install")[0], 0)
        first = self.path.read_text(encoding="utf-8")
        settings = json.loads(first)
        self.assertEqual(settings["model"], "m")
        self.assertEqual(settings["hooks"]["Stop"][0], other)
        self.assertEqual(sorted(settings["hooks"]), ["SessionEnd", "SessionStart", "Stop"])
        self.assertEqual(len(self.backups()), 1)
        self.assertEqual(self.run_it("--check")[0], 0)
        self.run_it("--install")
        self.assertEqual(self.path.read_text(encoding="utf-8"), first)
        self.assertEqual(len(self.backups()), 1)

    def test_the_command_exits_zero_when_the_script_is_gone(self):
        self.run_it("--install")
        command = self.read()["hooks"]["Stop"][0]["hooks"][0]["command"]
        gone = command.replace(hook.SCRIPT, os.path.join(self.home.name, "moved", hook.NAME))
        self.assertEqual(subprocess.run(["sh", "-c", gone], capture_output=True).returncode, 0)

    def test_an_older_command_is_reported_and_replaced(self):
        old = {"hooks": [{"type": "command", "command": "python3 /old/place/" + hook.NAME}]}
        other = {"hooks": [{"type": "command", "command": "other"}]}
        self.path.write_text(json.dumps({"hooks": {e: [old] for e in hook.EVENTS} | {"Stop": [other, old]}}), encoding="utf-8")
        self.assertEqual(self.run_it("--check")[0], 1)
        self.run_it("--install")
        self.assertEqual(self.run_it("--check")[0], 0)
        stop = self.read()["hooks"]["Stop"]
        self.assertEqual(stop[0], other)
        self.assertEqual(len(stop), 2)

    def test_a_stale_command_beside_the_current_one_is_cleaned(self):
        self.run_it("--install")
        settings = self.read()
        stale = {"type": "command", "command": "python3 /moved/away/" + hook.NAME}
        settings["hooks"]["Stop"].append({"hooks": [stale]})
        self.path.write_text(json.dumps(settings), encoding="utf-8")
        code, out = self.run_it("--check")
        self.assertEqual(code, 1)
        self.assertIn("outdated", out)
        self.run_it("--install")
        self.assertEqual(self.run_it("--check")[0], 0)
        self.assertEqual(len(self.read()["hooks"]["Stop"]), 1)

    def test_someone_elses_command_and_settings_on_the_entry_stay(self):
        own = {"type": "command", "command": "tee log | python3 /old/%s; backup.sh" % hook.NAME}
        old = {"type": "command", "command": "python3 /old/" + hook.NAME, "timeout": 5}
        self.path.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [own, old]}]}}), encoding="utf-8")
        self.run_it("--install")
        stop = self.read()["hooks"]["Stop"]
        self.assertEqual(stop[0]["hooks"][0], own)
        self.assertEqual(stop[0]["hooks"][1]["timeout"], 5)
        self.assertEqual(stop[0]["hooks"][1]["command"], hook.command())
    def test_an_older_command_beside_the_current_one_is_not_installed(self):
        self.run_it("--install")
        settings = self.read()
        settings["hooks"]["Stop"].append({"hooks": [{"type": "command", "command": "python3 /old/place/" + hook.NAME}]})
        self.path.write_text(json.dumps(settings), encoding="utf-8")
        self.assertEqual(self.run_it("--check")[0], 1)
        self.run_it("--install")
        self.assertEqual(self.run_it("--check")[0], 0)
        self.assertEqual(len(self.read()["hooks"]["Stop"]), 1)

    def test_uninstall_removes_only_this_hook(self):
        other = {"hooks": [{"type": "command", "command": "other"}]}
        self.path.write_text(json.dumps({"model": "m", "hooks": {"Stop": [other]}}), encoding="utf-8")
        self.run_it("--install")
        self.run_it("--uninstall")
        self.assertEqual(self.read(), {"model": "m", "hooks": {"Stop": [other]}})

    def test_invalid_settings_are_left_alone(self):
        self.path.write_text("{not json", encoding="utf-8")
        code, out = self.run_it("--install")
        self.assertEqual(code, 1)
        self.assertIn("not valid JSON", out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "{not json")

    def test_a_symlinked_settings_file_stays_linked(self):
        real = Path(self.home.name, "real.json")
        real.write_text("{}", encoding="utf-8")
        self.path.symlink_to(real)
        self.run_it("--install")
        self.assertTrue(self.path.is_symlink())
        self.assertIn("hooks", json.loads(real.read_text(encoding="utf-8")))

    def test_a_missing_folder_is_skipped_and_never_created(self):
        code, out = self.run_it("--install", {".claude-work": "work"})
        self.assertEqual(code, 0)
        self.assertIn("skipped", out)
        self.assertFalse(Path(self.home.name, ".claude-work").exists())


if __name__ == "__main__":
    unittest.main()
