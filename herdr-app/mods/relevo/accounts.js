import { home, readTextFile, shared, setShared } from "herdr";
import * as CONFIG from "./config.js";
import { configuredLaunchers, resolveLauncher } from "./lib/launchers.js";
import { FIVE_HOURS, WEEK, windowOf } from "./lib/time.js";
import { agentIcon } from "./ui.js";

const { ACCOUNTS: CONFIGURED, CODEX: CODEX_ACCOUNT } = CONFIG;
export const API_QUOTAS = "relevo.quota.api";
export const API_QUOTAS_AT = "relevo.quota.api.at";

// `file` is the statusline's quota snapshot for that account.
/** @param {Record<string, any> & {key:string}} a @returns {Record<string, any> & {key:string}} */
const withFile = (a) => ({ ...a, file: `quota-${a.key}.json` });
export const ACCOUNTS = CONFIGURED.map(withFile);
export const CODEX = withFile(CODEX_ACCOUNT);

/** @param {string} key */
export const accountOf = (key) => [...ACCOUNTS, CODEX].find((p) => p.key === key) ?? ACCOUNTS[0];

export const LAUNCHERS = configuredLaunchers(CONFIG);
/** The launcher that starts an account's own login folder: the one that renews that login, whatever the list order. */
/** @param {Record<string, any>} account */
export const loginLauncher = (account) =>
  LAUNCHERS.find((l) => l.app === "claude" && l.account === account.key && l.claudeDir === account.claudeDir) ?? launcherOf(account.key);

/** @param {string} key */
export const launcherOf = (key) => resolveLauncher(key, LAUNCHERS, [...ACCOUNTS, CODEX]);

// Commands are trusted configuration; prompts and flags are separate shell arguments.
/** @param {string | Record<string, any>} key @param {string} [prompt] @param {string[]} [args] */
export function launchArgv(key, prompt, args = []) {
  const p = typeof key === "string" ? launcherOf(key) : key;
  if (args.length && p.app !== "claude") throw new Error("Claude resume flags require a Claude launcher");
  const refs = args.map((_, i) => ` "$${i + 2}"`).join("");
  const endOptions = p.app === "pi" || p.app === "codex" ? " --" : "";
  return prompt ? ["bash", "-ilc", `${p.command}${refs}${endOptions} "$1"`, "bash", prompt, ...args] : ["bash", "-ilc", p.command];
}

/** @param {Record<string, any>} json */
export function fromClaude(json) {
  const r = json?.rate_limits ?? {};
  return {
    updated: json?.updated ?? 0,
    h5: windowOf(r.five_hour?.used_percentage, r.five_hour?.resets_at, FIVE_HOURS),
    d7: windowOf(r.seven_day?.used_percentage, r.seven_day?.resets_at, WEEK),
  };
}

// The newest source that still has this window: one without it, or whose window ended, says nothing about the current one.
/** @param {Array<Record<string, any>>} sources @param {string} name @param {number} now */
export function currentWindow(sources, name, now) {
  const known = sources.map((s) => s.rate_limits?.[name]).filter((w) => w?.used_percentage != null);
  return known.find((w) => !w.resets_at || w.resets_at > now) ?? known[0];
}

// The usage endpoint (shared state) and the statusline snapshot (file), window by window.
export async function loadClaudeQuotas() {
  const out = /** @type {Record<string, any>} */ ({}), api = /** @type {Record<string, any>} */ (shared(API_QUOTAS) ?? {});
  for (const p of [...ACCOUNTS, CODEX]) {
    let file = null;
    try {
      file = JSON.parse(await readTextFile(`${home()}/.cache/herdr-relevo/${p.file}`) ?? "null");
    } catch {
      file = null;
    }
    const fromApi = api[p.key]?.rate_limits ? api[p.key] : null;
    const sources = [fromApi, file].filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (!sources.length) {
      out[p.key] = null;
      continue;
    }
    const now = Date.now() / 1000;
    out[p.key] = fromClaude({
      updated: sources[0].updated,
      rate_limits: { five_hour: currentWindow(sources, "five_hour", now), seven_day: currentWindow(sources, "seven_day", now) },
    });
  }
  return out;
}

/** @param {Record<string, any> | null | undefined} q */
const full = (q) => (q?.h5?.pct >= 100 ? "5h" : q?.d7?.pct >= 100 ? "7d" : null);

// What to offer when a launcher's Claude account is at 100%: a launcher of another account that has room, the one of
// the same profile (same folder and settings) if there is one, else its default launcher. Nothing switches by itself: the caller asks.
// Pi and Codex never get an offer, and neither does a launcher while every account is full.
/** @param {Record<string, any>} launcher @param {Record<string, any>} quotas
 * @returns {{launcher: Record<string, any>, note: string | null}} the launcher to offer, and why (null: just open the requested one) */
export function launchChoice(launcher, quotas) {
  const own = launcher.account, window = launcher.app === "claude" ? full(quotas?.[own]) : null;
  if (window) {
    for (const a of ACCOUNTS) {
      const options = a.key !== own && !full(quotas?.[a.key]) ? LAUNCHERS.filter((l) => l.app === "claude" && l.account === a.key) : [];
      const other = options.find((l) => l.profile === launcher.profile) ?? options.find((l) => l.default) ?? options[0];
      if (other) return { launcher: other, note: `${accountOf(own).label} is at 100% (${window})` };
    }
  }
  return { launcher, note: null };
}

/** @param {typeof import("gpui-kit").div} div @param {Record<string, any>} p @param {number} [size] */
export function chip(div, p, size = 17) {
  return agentIcon(p.key === CODEX.key ? "codex" : "claude", size);
}

// What the agents sidebar needs to draw account chips, published once per change.
export const SHARED_SETUP = "relevo.setup";
/** @param {Array<Record<string, any>>} accounts @param {Array<Record<string, any>>} launchers */
export function publishSetup(accounts, launchers = []) {
  const setup = {
    accounts: Object.fromEntries(accounts.map((a) => [a.key, { bg: a.bg, fg: a.fg, label: a.label }])),
    launchers: launchers.map(({ key, label, app, profile }) => ({ key, label, app, profile })),
  };
  if (JSON.stringify(shared(SHARED_SETUP)) !== JSON.stringify(setup)) setShared(SHARED_SETUP, setup);
}
