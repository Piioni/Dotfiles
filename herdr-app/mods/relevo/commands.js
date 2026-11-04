import { exec, run, agents, notify, spaces, openOverlay } from "herdr";
import { pickAccount, loadClaudeQuotas } from "./accounts.js";
import { launchSkill } from "./skills.js";
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
function agentSummary(all) {
  const count = {};
  for (const a of all) count[a.status] = (count[a.status] ?? 0) + 1;
  return ["working", "done", "idle"].filter((s) => count[s]).map((s) => `${count[s]} ${s}`).join(" · ") || undefined;
}

async function currentPR() {
  const cwd = focusedCwd();
  if (!cwd) return null;
  const r = await exec("gh", [
    "pr", "view", "--json", "number,url,title,updatedAt,author,headRepository,headRepositoryOwner,statusCheckRollup",
  ], { cwd });
  if (r.code !== 0) {
    notify({ title: "No pull request for this branch", body: r.stderr.trim().split("\n")[0], level: "info" });
    return null;
  }
  const pr = JSON.parse(r.stdout);
  const top = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
  return { ...pr, repo: `${pr.headRepositoryOwner.login}/${pr.headRepository.name}`, top };
}

export async function openPR() {
  const pr = await currentPR();
  if (pr && /^https:\/\//i.test(pr.url)) exec("open", [pr.url]);
}

// Someone else's PR gets a review; yours gets its CI fixed or its comments answered.
export async function respondPR() {
  const pr = await currentPR();
  if (!pr) return;
  const me = (await exec("gh", ["api", "user", "--jq", ".login"])).stdout.trim();
  const failing = (pr.statusCheckRollup ?? []).some((c) => ["FAILURE", "ERROR", "TIMED_OUT"].includes(c.conclusion ?? c.state));
  const skill = pr.author?.login !== me ? "review" : failing ? "fix" : "comments";
  launchSkill(pr, skill, pickAccount(await loadClaudeQuotas(), true).key, pr.top);
}

export function worktrees(action) {
  const folder = focusedCwd(), space = spaces().find((s) => s.active)?.id;
  if (folder) openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { folder, space, action } });
}
