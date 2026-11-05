import { run, agents, notify, spaces, openOverlay } from "herdr";
import { focusedCwd } from "./panelbar.js";
import { shortcut } from "./ui.js";

// Waiting agents in list order, starting after the focused one so repeats cycle.
export function nextWaiting() {
  const all = agents(), at = all.findIndex((a) => a.focused);
  const waiting = [...all.slice(at + 1), ...all.slice(0, at + 1)].filter((a) => a.status === "blocked" && !a.focused);
  if (!waiting.length) {
    notify({ title: "No agent is waiting for you", body: agentSummary(all), level: "info", timeout: 2500 });
    return;
  }
  run("agent.focus", { terminal: waiting[0].address });
  // The count left tells you when the round is done.
  const rest = waiting.length - 1;
  const key = shortcut("relevo.next-waiting");
  if (rest) notify({ title: `${rest} more waiting`, body: key ? `${key} for the next` : undefined, level: "info", timeout: 2000 });
}

// "2 working · 1 done", or nothing when no agent runs.
/** @param {Array<{status: string}>} all */
function agentSummary(all) {
  /** @type {Record<string, number>} */
  const count = {};
  for (const a of all) count[a.status] = (count[a.status] ?? 0) + 1;
  return ["working", "done", "idle"].filter((s) => count[s]).map((s) => `${count[s]} ${s}`).join(" · ") || undefined;
}

/** @param {string} action */
export function worktrees(action) {
  const folder = focusedCwd(), space = spaces().find((s) => s.active)?.id;
  if (folder) openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { folder, space, action } });
}
