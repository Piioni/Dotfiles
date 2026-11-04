# Set up Relevo's hook (runbook for an agent)

`relevo-labels.py` is an optional Claude Code hook on SessionStart, Stop and SessionEnd. It runs no network calls and
only sets terminal labels:

| Label | What it is | What needs it |
|---|---|---|
| `agent.account` | the account whose `claudeDir` matches `CLAUDE_CONFIG_DIR` | account chips, time per account |
| `agent.jira` | the ticket key in the branch name | ticket chips |
| `agent.transcript` | the session file | handoffs that resume the conversation |
| `agent.wait`, `agent.bg` | background shells and wakeups still running | the ⧗ marker and its alert |

## Rules

- Don't read, print or edit `settings.json` yourself: it can hold secrets. The commands below change only the `hooks`
  key and write a `settings.json.relevo-backup-<time>` next to it first.
- Show the person the accounts from step 1 and get their go before installing.

## Steps

The hook lives in the installed mod (`$HERDR_APP_HOME` instead of `~/.config/herdr-app` if that is set):

```sh
H=~/.config/herdr-app/mods/relevo/hooks/relevo-labels.py
```

1. Run `python3 "$H" --check`. It lists each account in `mods/relevo/config.js` and whether the hook is installed.
   If it fails with no such file, stop: Relevo isn't installed. If it shows only the example accounts (`personal`,
   `work`) and those aren't theirs, stop and ask them to set their accounts in Relevo's Settings.
2. If step 1 said `outdated`, skip to step 3. Otherwise, inside a Herdr terminal, run `hc get "$HC_TERMINAL_ID"`. If
   `labels` already has `agent.account`, another hook sets these labels: stop and ask the person, because two would
   overwrite each other.
3. Run `python3 "$H" --install`. Running it again changes nothing, unless the hook is `outdated`: then it updates the
   command.
4. Run `python3 "$H" --check`. Every account should say `installed`; it exits 1 if any doesn't.
5. Tell the person the hook applies to sessions started from now on, so to restart any agents already running.

## Verify

Ask the person to start a new agent from Relevo and send it one message, then run `hc ls` to find its terminal and
`hc get <terminal>`. `labels` should have `agent.account` and `agent.transcript`, plus `agent.jira` when the branch
names a ticket.

## Undo

`python3 "$H" --uninstall` removes only this hook from each account's settings.
