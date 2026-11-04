// Stable behavior-test setup, independent of this machine's runtime accounts.
import * as legacy from "./legacy-config.mjs";

/** @type {Array<Record<string, any>>} */
export const ACCOUNTS = legacy.ACCOUNTS.map((a) => ({ ...a, defaultLauncher: a.key }));
/** @type {Record<string, any>} */
export const CODEX = { ...legacy.CODEX, launcher: "codex --profile configured", defaultLauncher: "codex" };
// Exports and fields an older config.js still has (CONTEXTS, FALLBACK, defaultLauncher); nothing reads them, and saving drops them.
export const CONTEXTS = [{ key: "personal", label: "Personal", account: "personal", color: "ansi2" }];
export const FALLBACK = ["personal", "work"];
export const REPOS_ROOT = legacy.REPOS_ROOT;
export const SKILLS = { ...legacy.SKILLS };

export const LAUNCHERS = [
  { key: "personal", label: "Claude", app: "claude", profile: "normal", account: "personal", command: "claude", claudeDir: ".claude" },
  { key: "work", label: "Work Claude", app: "claude", profile: "work", account: "work", command: "CLAUDE_CONFIG_DIR=$HOME/.claude-work claude", claudeDir: ".claude-work" },
  { key: "claude-sipos", label: "Claude SIPOS", app: "claude", profile: "SIPOS", account: "personal", command: 'env CLAUDE_CONFIG_DIR="$HOME/.claude-sipos" claude', claudeDir: ".claude-sipos" },
  { key: "pi", label: "Pi", app: "pi", profile: "normal", command: 'env -u PI_CODING_AGENT_DIR -u PI_CODING_AGENT_SESSION_DIR "$HOME/.pi/agent/bin/pi"' },
  { key: "pi-sipos", label: "Pi SIPOS", app: "pi", profile: "SIPOS", command: '"$HOME/bin/pi-sipos"' },
  { key: "codex", label: "Codex CLI", app: "codex", profile: "normal", account: "codex", command: "codex --profile configured" },
  { key: "work-on-personal", label: "Work Claude (personal account)", app: "claude", profile: "work", account: "personal", command: "claude-token personal .claude-work", claudeDir: ".claude-work" },
];
ACCOUNTS[0].futureSetting = "keep me";
export const EXTRA_SETTING = { enabled: true };
