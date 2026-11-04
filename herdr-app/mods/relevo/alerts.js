import { terminals, playSound, notify, shared, setShared } from "herdr";
import { ACCOUNTS, CODEX, accountOf } from "./accounts.js";
import { runsOut, clock, FIVE_HOURS, WEEK } from "./lib/time.js";

const ALERTED = "relevo.alerted";
const KNOWN = "relevo.reviews.known";

// A background task (⧗) that finished: the hook clears agent.wait on the next Stop.
export class BackgroundWatch {
  constructor() {
    this.waiting = new Map();
  }

  tick() {
    const now = new Map(terminals().filter((k) => k.state === "live").map((k) => [k.address, k]));
    for (const [address, before] of this.waiting) {
      const k = now.get(address);
      if (!k || k.labels?.["agent.wait"] === "watch") continue;
      playSound("sounds/bg-done.mp3");
      notify({
        title: "Background work finished",
        body: `${before.where ?? address}: ${before.labels?.["agent.bg"] ?? ""}`.trim(),
        level: "success",
        action: { name: "agent.focus", args: { terminal: address } },
      });
    }
    this.waiting = new Map([...now].filter(([, k]) => k.labels?.["agent.wait"] === "watch"));
  }
}

// One soft alert per account window at 80% and another at 95%, again only after it resets.
// At 95% an account's alert offers to continue its agent with another account, before it stops.
const HANDOFF_AT = 95;
export function quotaAlerts(quotas) {
  const first = shared(ALERTED) == null, seen = { ...(shared(ALERTED) ?? {}) };
  let changed = first;
  for (const [key, q] of Object.entries(quotas)) {
    for (const [name, w] of [["5h", q?.h5], ["7d", q?.d7]]) {
      const full = w?.pct >= HANDOFF_AT, id = `${key}.${name}${full ? ".full" : ""}`;
      // Some sources compute the reset from "now + remaining", so it drifts by seconds.
      const resets = Math.round((w?.resets ?? 0) / 3600);
      if (!w || w.pct < 80 || seen[id] === resets) continue;
      seen[id] = resets;
      changed = true;
      if (first) continue;
      playSound("sounds/quota.mp3");
      const handoff = full && [...ACCOUNTS, CODEX].some((p) => p.key === key);
      const out = runsOut(w, name === "5h" ? FIVE_HOURS : WEEK);
      const when = w.pct >= 100 ? "" : out ? ` · 100% at ${clock(out)}` : "";
      notify({
        title: `${accountOf(key).label} at ${w.pct}% (${name})${when}`,
        level: "warning",
        ...(handoff
          ? { body: "Click to continue its agent with another account", action: { name: `relevo.handoff-from-${key}` } }
          : {}),
      });
    }
  }
  if (changed) setShared(ALERTED, seen);
}

// New review requests since the last look.
export function reviewAlerts(requested) {
  const stored = shared(KNOWN), known = new Set(stored ?? []);
  const fresh = requested.filter((p) => !known.has(p.url));
  if (fresh.length && stored != null) {
    playSound("sounds/review.mp3");
    notify({
      title: fresh.length === 1 ? "Review requested" : `${fresh.length} reviews requested`,
      body: fresh.map((p) => `${p.repo.split("/")[1]} #${p.number} · ${p.title}`).join("\n"),
      level: "info",
      action: { name: "layout.show", args: { id: "panel" } },
    });
  }
  if (fresh.length || stored == null) setShared(KNOWN, requested.map((p) => p.url));
}

// Changes on your PRs; the click opens the Inbox.
const LOUD = new Set(["ci-failed", "threads", "changes"]);
const LEVEL = { "ci-failed": "warning", changes: "warning", threads: "info", "ci-passed": "success", approved: "success" };

export function prAlerts(events) {
  if (events.some((e) => LOUD.has(e.kind))) playSound("sounds/review.mp3");
  for (const e of events) notify({ title: e.title, level: LEVEL[e.kind], action: { name: "relevo.panel-inbox" } });
}
