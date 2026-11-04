#!/usr/bin/env python3
"""Optional Claude Code hook for Relevo. It only sets terminal labels; setup is in HOOK.md.

As a hook (SessionStart, Stop, SessionEnd) it reads Claude's JSON on stdin and sets agent.account,
agent.transcript, agent.wait and agent.bg. Outside a Herdr terminal it does nothing.
--check, --install and --uninstall manage it in the settings of each account in config.js.
"""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter

EVENTS = ("SessionStart", "Stop", "SessionEnd")
NAME = "relevo-labels.py"
ACCOUNT = re.compile(r'key:\s*"([^"]+)"[^{}]*?claudeDir:\s*"([^"]+)"')
SCRIPT = os.path.realpath(__file__)


def accounts(config_path=None):
    """{claudeDir: account key} from the mod's config.js."""
    path = config_path or os.path.join(os.path.dirname(os.path.dirname(SCRIPT)), "config.js")
    with open(path, encoding="utf-8") as f:
        # Named launcher profiles may reuse a credential folder; their IDs are not accounts.
        section = re.search(r"export\s+const\s+ACCOUNTS\s*=\s*\[(.*?)\]\s*;", f.read(), re.S)
        return {folder: key for key, folder in ACCOUNT.findall(section.group(1) if section else "")}


def account_for(config_dir, dirs, override=None):
    """The launcher's RELEVO_ACCOUNT wins: a token launch uses one account's profile folder with another account."""
    if override in dirs.values():
        return override
    home = os.path.expanduser("~")
    return dirs.get(os.path.relpath((config_dir or os.path.join(home, ".claude")).rstrip("/"), home))


def plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def pending(data):
    """(wait kind, summary) for background work still running, or (None, None)."""
    tasks = data.get("background_tasks") or []
    crons = data.get("session_crons") or []
    if tasks:
        kinds = Counter(t.get("type") or "task" for t in tasks)
        return "watch", "⧗ " + " · ".join(plural(n, k) for k, n in kinds.most_common())
    if crons:
        return "timer", "⏰ " + plural(len(crons), "wakeup")
    return None, None


def labels(data, account):
    """The labels for one hook event; an empty value removes a label."""
    if data.get("hook_event_name") == "SessionEnd":
        return {k: "" for k in ("wait", "bg", "account", "transcript")}
    wait, bg = pending(data)
    return {
        "wait": wait or "", "bg": bg or "", "account": account or "",
        "transcript": data.get("transcript_path") or "",
    }


def on_hook():
    terminal = os.environ.get("HC_TERMINAL_ID")
    if not terminal:
        return
    data = json.load(sys.stdin)
    account = account_for(os.environ.get("CLAUDE_CONFIG_DIR"), accounts(), os.environ.get("RELEVO_ACCOUNT"))
    values = labels(data, account)
    hc = shutil.which("hc") or os.path.expanduser("~/.local/bin/hc")
    args = [hc, "label", terminal] + ["agent.%s=%s" % kv for kv in values.items()]
    subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)


def ours(hook):
    return NAME in (hook.get("command") or "")


def command():
    """Exits 0 whatever happens: on Stop a hook's exit 2 stops the agent from finishing, and python3 exits 2 for a moved script."""
    path = shlex.quote(SCRIPT)
    return "[ -f %s ] && python3 %s || true" % (path, path)


def generated(hook):
    """Only commands this script wrote: anything else that mentions it is someone's own and stays as it is."""
    try:
        parts = shlex.split(hook.get("command") or "")
    except ValueError:
        return False
    if len(parts) == 2 and parts[0] == "python3":
        return os.path.basename(parts[1]) == NAME
    return len(parts) == 9 and parts[:2] == ["[", "-f"] and parts[3:6] == ["]", "&&", "python3"] and parts[7:] == ["||", "true"] \
        and parts[2] == parts[6] and os.path.basename(parts[2]) == NAME


def entries(settings, event):
    return [h for group in (settings.get("hooks") or {}).get(event) or [] for h in group.get("hooks") or [] if generated(h)]


def installed(settings):
    current = command()
    return all([h.get("command") for h in entries(settings, e)] == [current] for e in EVENTS)


def outdated(settings):
    return not installed(settings) and any(entries(settings, e) for e in EVENTS)


def add(settings):
    hooks = settings.setdefault("hooks", {})
    for event in EVENTS:
        found = False
        groups = []
        for group in hooks.get(event) or []:
            kept = []
            for hook in group.get("hooks") or []:
                if generated(hook):
                    if found:
                        continue
                    found = True
                    hook["command"] = command()
                kept.append(hook)
            if kept:
                groups.append(dict(group, hooks=kept))
        if not found:
            groups.append({"hooks": [{"type": "command", "command": command()}]})
        hooks[event] = groups


def remove(settings):
    hooks = settings.get("hooks") or {}
    for event in EVENTS:
        groups = [dict(g, hooks=[h for h in g.get("hooks") or [] if not ours(h)]) for g in hooks.get(event) or []]
        groups = [g for g in groups if g["hooks"]]
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    if "hooks" in settings and not hooks:
        del settings["hooks"]


def save(path, settings):
    """Backs up, then replaces the real file atomically, so a symlinked settings.json stays linked."""
    real = os.path.realpath(path)
    if os.path.exists(real):
        shutil.copy2(real, "%s.relevo-backup-%d" % (real, time.time()))
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(real), prefix=".relevo-settings-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if os.path.exists(real):
        shutil.copymode(real, tmp)
    os.replace(tmp, real)


def manage(action, dirs):
    """Runs --check, --install or --uninstall on each account. Never prints settings; returns the exit code."""
    code = 0
    for folder, key in dirs.items():
        root = os.path.join(os.path.expanduser("~"), folder)
        path = os.path.join(root, "settings.json")
        if not os.path.isdir(root):
            print("%s (%s): no such folder, skipped" % (key, folder))
            continue
        try:
            with open(path, encoding="utf-8") as f:
                settings = json.load(f)
        except FileNotFoundError:
            settings = {}
        except ValueError:
            print("%s (%s): settings.json is not valid JSON, left as it is" % (key, folder))
            code = 1
            continue
        has = installed(settings)
        old = outdated(settings)
        if action == "--install" and not has:
            add(settings)
            save(path, settings)
        elif action == "--uninstall" and any(NAME in json.dumps(v) for v in (settings.get("hooks") or {}).values()):
            remove(settings)
            save(path, settings)
        elif action == "--check" and not has:
            code = 1
        state = {"--install": "installed", "--uninstall": "removed"}.get(action, "installed" if has else "outdated" if old else "not installed")
        print("%s (%s): %s" % (key, folder, state))
    return code


def main():
    if len(sys.argv) > 1:
        return manage(sys.argv[1], accounts()) if sys.argv[1] in ("--check", "--install", "--uninstall") else 2
    # A hook must never get in the agent's way.
    try:
        on_hook()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
