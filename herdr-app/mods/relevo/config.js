// Relevo Settings: provider accounts, named launch profiles and slash commands.

export const ACCOUNTS = [
  {
    key: "personal", label: "Claude", letter: "C", claudeDir: ".claude", bg: "#c3e88d",
    fg: "#1e2030",
  },
];

export const CODEX = { key: "codex", label: "Codex", letter: "X", bg: "#4fd6be", fg: "#1e2030" };

export const LAUNCHERS = [
  {
    key: "claude", label: "Claude Code", app: "claude", profile: "normal", account: "personal",
    command: "env -u CLAUDE_CONFIG_DIR claude", claudeDir: ".claude",
  },
  {
    key: "claude-sipos", label: "Claude SIPOS", app: "claude", profile: "SIPOS", account: "personal",
    command: "env CLAUDE_CONFIG_DIR=\"$HOME/.claude-sipos\" claude", claudeDir: ".claude-sipos",
  },
  {
    key: "pi", label: "Pi", app: "pi", profile: "normal",
    command: "env -u PI_CODING_AGENT_DIR -u PI_CODING_AGENT_SESSION_DIR \"$HOME/.pi/agent/bin/pi\"",
  },
  { key: "pi-sipos", label: "Pi SIPOS", app: "pi", profile: "SIPOS", command: "\"$HOME/bin/pi-sipos\"" },
  { key: "codex", label: "Codex CLI", app: "codex", profile: "normal", account: "codex", command: "codex" },
];

export const REPOS_ROOT = "code";

export const SKILLS = { review: "review", fix: "fix-ci", comments: "address-comments" };
