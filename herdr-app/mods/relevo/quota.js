import { home, readTextFile } from "herdr";
import { ACCOUNTS } from "./config.js";

// Asks each provider's usage endpoint with that account's own login. Expired tokens are
// skipped, never refreshed: refreshing would rotate the login Claude Code or Codex keep.
/** What the usage read says when the saved login ran out: Claude Code renews it the next time that profile starts. */
export const LOGIN_EXPIRED = "token expired";
const CLAUDE_DIRS = Object.fromEntries(ACCOUNTS.map((a) => [a.key, a.claudeDir]));

/** @typedef {{ utilization?: number|null, resets_at?: string|number|null }} ProviderWindow */
/** @typedef {{ five_hour?: ProviderWindow, seven_day?: ProviderWindow }} ClaudeUsage */
/** @typedef {{used_percentage:number, resets_at?:number|null}} QuotaValue */
/** @typedef {Partial<Record<"five_hour"|"seven_day",QuotaValue>>} RateLimits */
/** @typedef {{ tokens?: { access_token?: string, account_id?: string } }} CodexAuth */
/** @typedef {{ limit_window_seconds?: number, used_percent?: number, reset_at?: string|number|null }} CodexWindow */
/** @typedef {{ rate_limit?: { primary_window?: CodexWindow, secondary_window?: CodexWindow } }} CodexUsage */

/** @param {string|number|null|undefined} v @returns {number|null|undefined} */
const epoch = (v) => {
  if (typeof v === "number") return v;
  if (v == null) return null;
  return Date.parse(String(v)) / 1000;
};

/** @template T @param {string} url @param {Record<string,string>} headers @returns {Promise<T>} */
async function getJSON(url, headers) {
  const r = await fetch(url, { headers: { "User-Agent": "herdr-relevo/1.0", ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return /** @type {Promise<T>} */ (r.json());
}

// Claude Code stores each profile's OAuth credentials in its config directory.
/** @param {string|undefined} dir */
async function claudeToken(dir) {
  const path = `${home()}/${dir || ".claude"}/.credentials.json`;
  let oauth;
  try { oauth = JSON.parse(await readTextFile(path) ?? "{}").claudeAiOauth ?? {}; }
  catch { throw new Error("invalid Claude credentials"); }
  if (!oauth.accessToken) throw new Error("no Claude credentials");
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) throw new Error(LOGIN_EXPIRED);
  return oauth.accessToken;
}

/** @param {string|undefined} dir @returns {Promise<RateLimits>} */
async function claude(dir) {
  const request = /** @type {Promise<ClaudeUsage>} */ (getJSON("https://api.anthropic.com/api/oauth/usage", {
    Authorization: `Bearer ${await claudeToken(dir)}`,
    "anthropic-beta": "oauth-2025-04-20",
  }));
  const data = await request;
  const out = /** @type {RateLimits} */ ({});
  for (const name of /** @type {const} */ (["five_hour", "seven_day"])) {
    const w = data[name];
    if (w?.utilization != null) out[name] = { used_percentage: w.utilization, resets_at: epoch(w.resets_at) };
  }
  return out;
}

async function codex() {
  let auth;
  try { auth = /** @type {CodexAuth} */ (JSON.parse(await readTextFile(`${home()}/.codex/auth.json`) ?? "{}")); }
  catch { throw new Error("invalid Codex credentials"); }
  const tokens = auth?.tokens ?? {};
  if (!tokens.access_token) throw new Error("no Codex credentials");
  const headers = /** @type {Record<string,string>} */ ({ Authorization: `Bearer ${tokens.access_token}` });
  if (tokens.account_id) headers["ChatGPT-Account-Id"] = tokens.account_id;
  const usage = /** @type {Promise<CodexUsage>} */ (getJSON("https://chatgpt.com/backend-api/wham/usage", headers));
  const rate = (await usage).rate_limit ?? {};
  const out = /** @type {RateLimits} */ ({});
  for (const w of [rate.primary_window, rate.secondary_window]) {
    if (w?.used_percent == null) continue;
    out[(w.limit_window_seconds ?? 0) <= 18000 ? "five_hour" : "seven_day"] = {
      used_percentage: w.used_percent,
      resets_at: epoch(w.reset_at),
    };
  }
  return out;
}

// { account: { updated, rate_limits } | { error } }, one account failing leaves the others.
export async function collectQuotas() {
  const jobs = {
    ...Object.fromEntries(Object.entries(CLAUDE_DIRS).map(([key, dir]) => [key, () => claude(dir)])),
    codex,
  };
  const out = /** @type {Record<string, {updated?:number, rate_limits?:RateLimits, error?:string}>} */ ({});
  for (const [key, job] of Object.entries(jobs)) {
    try {
      out[key] = { updated: Math.floor(Date.now() / 1000), rate_limits: await job() };
    } catch (e) {
      out[key] = { error: (e instanceof Error ? e.message : String(e)).slice(0, 80) };
    }
  }
  return out;
}
