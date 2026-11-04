import { home, readTextFile, run, spaces, shared, setShared, notify } from "herdr";
import * as CONFIG from "./config.js";
import { configuredLaunchers, resolveLauncher } from "./lib/launchers.js";
import { FIVE_HOURS, WEEK, windowOf } from "./lib/time.js";
import { agentIcon } from "./ui.js";

const { ACCOUNTS: CONFIGURED, CODEX: CODEX_ACCOUNT } = CONFIG;
export const API_QUOTAS = "relevo.quota.api";

// `file` is the statusline's quota snapshot for that account.
/** @param {Record<string, any> & {key:string}} a @returns {Record<string, any> & {key:string}} */
const withFile = (a) => ({ ...a, file: `quota-${a.key}.json` });
export const ACCOUNTS = CONFIGURED.map(withFile);
export const CODEX = withFile(CODEX_ACCOUNT);

/** @param {string} key */
export const accountOf = (key) => [...ACCOUNTS, CODEX].find((p) => p.key === key) ?? ACCOUNTS[0];

export const LAUNCHERS = configuredLaunchers(CONFIG);
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

// A launcher opens as configured unless its Claude account is at 100%: then the first Claude launcher of another
// account that has room opens instead (the folder and settings of one Claude profile can't be shared across accounts).
// Pi and Codex never fall back. Every launch path goes through here.
/** @param {Record<string, any>} launcher @param {Record<string, any>} quotas @param {boolean} [announce] tell the user about a fallback */
export function launchChoice(launcher, quotas, announce = false) {
  const own = launcher.account, window = launcher.app === "claude" ? full(quotas?.[own]) : null;
  /** @type {{launcher: Record<string, any>, note: string | null}} */
  let choice = { launcher, note: null };
  if (window) {
    for (const a of ACCOUNTS) {
      const other = a.key !== own && !full(quotas?.[a.key]) && LAUNCHERS.find((l) => l.app === "claude" && l.account === a.key);
      if (other) {
        choice = { launcher: other, note: `${accountOf(own).label} is at 100% (${window}) — using ${a.label}` };
        break;
      }
    }
  }
  if (announce && choice.note) notify({ title: choice.note, level: "info" });
  return choice;
}

// Pull request actions use the first Claude account that has a launcher, with the usage fallback.
/** @param {Record<string, any>} quotas @param {boolean} [announce] */
export function pickAccount(quotas, announce = false) {
  const first = ACCOUNTS.find((a) => LAUNCHERS.some((l) => l.app === "claude" && l.account === a.key)) ?? ACCOUNTS[0];
  const { launcher, note } = launchChoice(launcherOf(first.key), quotas, announce);
  return { key: launcher.account ?? first.key, note };
}

// Runs in the repo's own space (or a new one), not in whichever space is shown.
/** @param {{repo: string, folder: string, tab: string, account: string, prompt: string}} options */
export function launchInRepo({ repo, folder, tab, account, prompt }) {
  const name = repo.split("/").pop();
  const space = spaces().find((s) => !s.machine && s.folder === folder)
    ?? spaces().find((s) => !s.machine && s.name === name);
  const argv = launchArgv(account, prompt);
  if (space) run("tab.new", { space: space.id, name: tab, folder, argv });
  else run("space.new", { name, folder, tab, argv });
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
    accounts: Object.fromEntries(accounts.map((a) => [a.key, { letter: a.letter, bg: a.bg, fg: a.fg, label: a.label }])),
    launchers: launchers.map(({ key, label, app, profile }) => ({ key, label, app, profile })),
  };
  if (JSON.stringify(shared(SHARED_SETUP)) !== JSON.stringify(setup)) setShared(SHARED_SETUP, setup);
}
