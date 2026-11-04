// Legacy account commands become named profiles without changing their command text.
/** @param {Record<string, any>} config @returns {Array<Record<string, any>>} */
export function configuredLaunchers(config) {
  if (Array.isArray(config.LAUNCHERS)) return config.LAUNCHERS;
  return [...(config.ACCOUNTS ?? []), config.CODEX].filter(Boolean).map((a) => ({
    key: a.key, label: a.label, app: a === config.CODEX ? "codex" : "claude",
    profile: "default", command: a.launcher, ...(a.claudeDir ? { claudeDir: a.claudeDir } : {}), account: a.key,
  }));
}

/** @param {string} key @param {Array<Record<string, any>>} launchers @param {Array<Record<string, any>>} accounts */
export function resolveLauncher(key, launchers, accounts) {
  // An account key means its default launcher: the one marked `default`, else the first that names it as its account.
  const named = accounts.some((a) => a.key === key) ? launchers.filter((l) => l.account === key) : [];
  const launcher = named.find((l) => l.default) ?? named[0] ?? launchers.find((l) => l.key === key);
  if (!launcher) throw new Error(`Unknown launcher: ${key}`);
  return launcher;
}
