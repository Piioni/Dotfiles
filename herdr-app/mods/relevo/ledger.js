import { agents, panes, terminals, exec, home, shared, setShared, readTextFile } from "herdr";
import { totals, week, weekStart } from "./lib/ledger.js";
export { duration } from "./lib/time.js";

// One JSON line per stretch an agent worked: {start, end, jira, repo, branch, account}.
export const LEDGER = ".local/state/relevo/ledger.jsonl";
const OPEN = "relevo.ledger.open";
const JIRA = /\b([A-Z][A-Z0-9]+-\d+)\b/;

function append(entries) {
  if (!entries.length) return;
  const text = entries.map((e) => JSON.stringify(e)).join("\n");
  return exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s\\n" "$2" >> "$1"', "sh", `${home()}/${LEDGER}`, text]);
}

// Open stretches live in shared state, so a reload keeps counting.
export function ledgerTick() {
  const open = { ...(shared(OPEN) ?? {}) }, now = Math.round(Date.now() / 1000), closed = [];
  const byPane = new Map(panes().map((p) => [p.pane, p]));
  const labels = new Map(terminals().map((k) => [k.address, k.labels ?? {}]));
  const working = new Map(agents().filter((a) => a.status === "working").map((a) => [a.address, a]));
  for (const [address, entry] of Object.entries(open)) {
    if (working.has(address)) continue;
    closed.push({ ...entry, end: now });
    delete open[address];
  }
  for (const [address, a] of working) {
    if (open[address]) continue;
    const pane = byPane.get(a.pane), l = labels.get(address) ?? {}, branch = pane?.branch ?? null;
    open[address] = {
      start: now,
      jira: l["agent.jira"] || JIRA.exec(branch ?? "")?.[1] || null,
      repo: (pane?.cwd ?? "").split("/").pop() || a.space_name,
      branch,
      account: l["agent.account"] || (a.app === "codex" ? "codex" : null),
    };
  }
  if (closed.length || Object.keys(open).length !== Object.keys(shared(OPEN) ?? {}).length) setShared(OPEN, open);
  return append(closed);
}

// Ledger lines that ended after `since`, plus the stretches still open.
async function rowsSince(since) {
  const now = Date.now() / 1000;
  const text = (await readTextFile(`${home()}/${LEDGER}`).catch(() => null)) ?? "";
  // Lines are appended in end order, so stop at the first one from before `since`.
  const lines = text.split("\n"), rows = Object.values(shared(OPEN) ?? {}).map((e) => ({ ...e, end: now }));
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let r;
    try {
      r = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (r.end <= since) break;
    rows.push(r);
  }
  return rows;
}

// Today's worked time per ticket (or repo without one).
export async function today() {
  const since = new Date().setHours(0, 0, 0, 0) / 1000;
  return totals(await rowsSince(since), since);
}

// Seven days from Monday, `offset` weeks back or ahead of this one.
export async function weekOf(offset = 0) {
  const start = weekStart(Date.now() / 1000, offset);
  return week(await rowsSince(start), start);
}

