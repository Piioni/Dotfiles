// Pure data shaping for the pull request panel: no herdr, no gh.

// What a PR needs next, in one word: draft, approved, changes (requested) or needs (a review).
export function reviewOf(pr) {
  if (pr.draft) return "draft";
  const states = pr.reviews.map((r) => r.state);
  if (pr.decision === "CHANGES_REQUESTED" || states.includes("CHANGES_REQUESTED")) return "changes";
  if (pr.decision === "APPROVED" || states.includes("APPROVED")) return "approved";
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

export function normalize(p, state = "open") {
  return {
    number: p.number, title: p.title, url: p.url, author: p.author?.login ?? "ghost", bot: Boolean(p.author?.is_bot),
    draft: Boolean(p.isDraft), decision: p.reviewDecision ?? "", state,
    assignees: (p.assignees ?? []).map((a) => a.login),
    requested: (p.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug).filter(Boolean),
    reviews: (p.latestReviews ?? []).map((r) => ({ login: r.author?.login, state: r.state })),
    labels: p.labels ?? [], head: p.headRefName, base: p.baseRefName,
    adds: p.additions ?? 0, dels: p.deletions ?? 0, files: p.changedFiles ?? 0,
    updatedAt: p.updatedAt, ci: ciOf(p.statusCheckRollup),
  };
}

export const SCOPES = { all: "All", mine: "Mine" };

// The chips depend on the scope: what I'm waiting on for mine, what the team is missing for all.
export const CHIPS = {
  mine: {
    all: { label: "All", test: () => true },
    changes: { label: "Changes requested", test: (p) => reviewOf(p) === "changes" },
    approved: { label: "Approved", test: (p) => reviewOf(p) === "approved" },
    needs: { label: "Awaiting review", test: (p) => reviewOf(p) === "needs" },
    draft: { label: "Drafts", test: (p) => p.draft },
  },
  all: {
    all: { label: "All", test: () => true },
    unassigned: { label: "Unassigned", test: (p) => !p.assignees.length },
    needs: { label: "Needs review", test: (p) => reviewOf(p) === "needs" },
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
