// Pure data shaping for the pull request panel: no herdr, no gh.

// What a PR needs next, in one word: draft, approved, changes (requested) or needs (a review).
export function reviewOf(pr) {
  if (pr.draft) return "draft";
  const states = pr.reviews.filter((r) => !r.sha || !pr.headOid || r.sha === pr.headOid).map((r) => r.state);
  const hasStaleReview = pr.reviews.some((r) => r.sha && pr.headOid && r.sha !== pr.headOid);
  if ((!hasStaleReview && pr.decision === "CHANGES_REQUESTED") || states.includes("CHANGES_REQUESTED")) return "changes";
  // Where the repo requires reviews GitHub's decision wins (one approval of two is not approved); without rules, any approval counts.
  if ((!hasStaleReview && pr.decision === "APPROVED") || (!pr.decision && states.includes("APPROVED"))) return "approved";
  return "needs";
}

// GitHub mixes check runs (status/conclusion) and commit statuses (state) in one list.
export function ciOf(rollup = []) {
  if (!rollup.length) return null;
  const failed = (c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(c.conclusion ?? c.state);
  const pending = (c) => (c.status && c.status !== "COMPLETED") || ["PENDING", "EXPECTED"].includes(c.state);
  if (rollup.some(failed)) return "failing";
  return rollup.some(pending) ? "pending" : "passing";
}

// Bots and bot-looking comments (Linear link-backs, CI reports) are not "someone else's feedback".
const BOT = /\[bot\]$|^app\/|^(linear(-code)?|github-actions|copilot|dependabot|vercel|codecov|sonarcloud|sonarqubecloud)$/i;
const KINDS = { CHANGES_REQUESTED: "changes", APPROVED: "approved", COMMENTED: "reviewed" };

// First line of a comment as plain text, short enough to sit on one row.
const snippet = (body = "") => (body.split("\n").map((l) => l.replace(/[#>*_`~[\]]|<[^>]*>/g, "").trim()).find(Boolean) ?? "").slice(0, 160);

// The newest review or comment left by someone other than the PR's author: { login, at, kind, text } or null.
// kind: changes (requested), approved, reviewed (review without a verdict) or comment.
export function lastFromOthers(p) {
  const author = p.author?.login;
  const events = [
    ...(p.latestReviews ?? []).filter((r) => KINDS[r.state] && r.submittedAt).map((r) => ({ login: r.author?.login, at: r.submittedAt, body: r.body, kind: KINDS[r.state] })),
    ...(p.comments ?? []).filter((c) => !c.isMinimized).map((c) => ({ login: c.author?.login, at: c.createdAt, body: c.body, kind: "comment" })),
  ].filter((e) => e.login && e.login !== author && !BOT.test(e.login) && !(e.body ?? "").startsWith("<!--"));
  const last = events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return last ? { login: last.login, at: last.at, kind: last.kind, text: snippet(last.body) } : null;
}

// Can it merge into its base: conflicts, behind (clean but out of date), clean, or unknown while GitHub still works it out.
export function mergeOf(p) {
  if (p.mergeable === "CONFLICTING") return "conflicts";
  if (p.mergeable !== "MERGEABLE") return "unknown";
  return p.mergeStateStatus === "BEHIND" ? "behind" : "clean";
}

export function normalize(p, state = "open") {
  return {
    number: p.number, title: p.title, url: p.url, author: p.author?.login ?? "ghost", bot: Boolean(p.author?.is_bot),
    draft: Boolean(p.isDraft), decision: p.reviewDecision ?? "", state,
    assignees: (p.assignees ?? []).map((a) => a.login),
    requested: (p.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug).filter(Boolean),
    reviews: (p.latestReviews ?? []).map((r) => ({ login: r.author?.login, state: r.state, sha: r.commit?.oid })),
    labels: p.labels ?? [], head: p.headRefName, headOid: p.headRefOid, base: p.baseRefName,
    adds: p.additions ?? 0, dels: p.deletions ?? 0, files: p.changedFiles ?? 0,
    updatedAt: p.updatedAt, ci: ciOf(p.statusCheckRollup),
    merge: mergeOf(p), blocked: p.mergeStateStatus === "BLOCKED", last: lastFromOthers(p),
  };
}

export const SCOPES = { all: "All", mine: "Mine" };

// The chips depend on the scope: what I'm waiting on for mine, what the team is missing for all.
export const CHIPS = {
  mine: {
    all: { label: "All", test: () => true },
    conflicts: { label: "Conflicts", test: (p) => p.merge === "conflicts" },
    changes: { label: "Changes requested", test: (p) => reviewOf(p) === "changes" },
    approved: { label: "Approved", test: (p) => reviewOf(p) === "approved" },
    needs: { label: "Awaiting review", test: (p) => reviewOf(p) === "needs" },
    draft: { label: "Drafts", test: (p) => p.draft },
  },
  all: {
    all: { label: "All", test: () => true },
    needs: { label: "Needs review", test: (p) => reviewOf(p) === "needs" && !p.assignees.length },
    reviewing: { label: "Being reviewed", test: (p) => !p.draft && p.assignees.length > 0 },
    asked: { label: "Asked of me", test: (p, me) => p.requested.includes(me) },
    draft: { label: "Drafts", test: (p) => p.draft },
  },
};

export const inScope = (prs, scope, me) => (scope === "mine" ? prs.filter((p) => p.author === me) : prs);

export function counts(prs, scope, me) {
  const base = inScope(prs, scope, me);
  return Object.fromEntries(Object.entries(CHIPS[scope]).map(([k, c]) => [k, base.filter((p) => c.test(p, me)).length]));
}

export function shown(prs, { scope, chip, query = "", me }) {
  const test = (CHIPS[scope][chip] ?? CHIPS[scope].all).test, q = query.trim().toLowerCase();
  return inScope(prs, scope, me).filter((p) => test(p, me)
    && (!q || `#${p.number} ${p.title} ${p.author} ${p.head} ${p.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

// Assignees mean "someone is reviewing this right now": the team assigns on starting a review and unassigns on finishing it.
const GROUPS = {
  mine: [["attention", "Needs your attention"], ["ready", "Ready to merge"], ["waiting", "Waiting for review"], ["draft", "Drafts"]],
  all: [["needs", "Needs a reviewer"], ["reviewing", "Being reviewed"], ["changes", "Changes requested"], ["approved", "Approved"], ["draft", "Drafts"]],
};

function bucket(p, scope) {
  const review = reviewOf(p);
  if (review === "draft") return "draft";
  if (scope === "mine") return review === "changes" || p.merge === "conflicts" || p.ci === "failing" ? "attention" : review === "approved" && p.merge === "clean" && !p.blocked && p.ci !== "pending" ? "ready" : "waiting";
  return review === "changes" || review === "approved" ? review : p.assignees.length ? "reviewing" : "needs";
}

// The list split into titled sections, in the order that puts what needs action first; empty ones are left out.
export function grouped(prs, scope) {
  const by = new Map(GROUPS[scope].map(([key, label]) => [key, { key, label, prs: [] }]));
  for (const p of prs) by.get(bucket(p, scope)).prs.push(p);
  return [...by.values()].filter((g) => g.prs.length);
}
