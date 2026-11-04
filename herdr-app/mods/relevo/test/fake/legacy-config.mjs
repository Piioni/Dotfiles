// Everything one setup needs: accounts, folders and skills. Copy to config.js and edit.

// Each Claude account: `launcher` is the shell command that starts it, `claudeDir` its
// CLAUDE_CONFIG_DIR under home, `bg`/`fg` its chip colors.
export const ACCOUNTS = [
  { key: "personal", label: "Personal", letter: "P", launcher: "claude", claudeDir: ".claude", bg: "#c3e88d", fg: "#1e2030" },
  {
    key: "work", label: "Work", letter: "W", launcher: "CLAUDE_CONFIG_DIR=$HOME/.claude-work claude", claudeDir: ".claude-work",
    bg: "#82aaff", fg: "#1e2030",
  },
];

export const CODEX = { key: "codex", label: "Codex", letter: "X", launcher: "codex", bg: "#4fd6be", fg: "#1e2030" };

// Clones live directly under this folder in home.
export const REPOS_ROOT = "code";

// The slash commands the Inbox launches on a PR: a review, a CI fix and answering review comments.
export const SKILLS = { review: "review", fix: "fix-ci", comments: "address-comments" };
