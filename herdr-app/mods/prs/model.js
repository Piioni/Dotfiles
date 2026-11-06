// Pure data shaping for the pull request panel: no herdr, no gh.

// What a PR needs next, in one word: draft, approved, changes (requested) or needs (a review).
export function reviewOf(pr) {
  if (pr.draft) return "draft";
  const states = pr.reviews.filter((r) => !r.stale).map((r) => r.state);
  const hasStaleReview = pr.reviews.some((r) => r.stale);
  // Re-requesting a reviewer drops their verdict from latestReviews while the decision stays on changes: that is back to needs review.
  if ((!hasStaleReview && pr.decision === "CHANGES_REQUESTED" && !pr.requested.length) || states.includes("CHANGES_REQUESTED")) return "changes";
  // Where the repo requires reviews GitHub's decision wins (one approval of two is not approved); without rules, any approval counts.
  // Same re-request rule as above: an approval no longer in latestReviews while someone is asked again is back to needs review.
  if ((!hasStaleReview && pr.decision === "APPROVED" && (!pr.requested.length || states.includes("APPROVED"))) || (!pr.decision && states.includes("APPROVED"))) return "approved";
  return "needs";
}

// Did the author push real work after the commit a review saw? Merging the base back in (conflict fixes, syncing) does not outdate a review.
// A review commit older than the commits we fetched counts as moved.
// ponytail: a merge commit that resolves a conflict could hide a real edit; compare the diff if that ever bites.
const movedSince = (p, oid) => {
  const head = p.headRefOid;
  if (!oid || !head || oid === head) return false;
  const all = p.recentCommits ?? [], seen = all.indexOf(oid);
  return seen < 0 || all.slice(seen + 1).some((c) => !(p.mergeOids ?? []).includes(c));
};

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
const snippet = (body = "", max = 160) => (body.split("\n").map((l) => l.replace(/[#>*_`~[\]]|<[^>]*>/g, "").trim()).find(Boolean) ?? "").slice(0, max);

const isPerson = (login, author) => Boolean(login) && login !== author && !BOT.test(login);

// Where each reviewer stands: their last verdict (stale when left on an older commit) or still asked (pending).
// A reviewer asked again loses their verdict on GitHub, so they show as pending.
export function verdictsOf(p) {
  const author = p.author?.login, seen = new Set();
  const given = (p.latestReviews ?? []).filter((r) => KINDS[r.state] && isPerson(r.author?.login, author)).map((r) => {
    seen.add(r.author.login);
    return { login: r.author.login, kind: KINDS[r.state], stale: movedSince(p, r.commit?.oid), at: r.submittedAt };
  });
  const asked = (p.reviewRequests ?? []).map((r) => r.login).filter((l) => isPerson(l, author) && !seen.has(l)).map((login) => ({ login, kind: "pending", stale: false }));
  return [...given, ...asked];
}

// What happened after the newest review: commits pushed on top of the commit it saw, and the author's replies.
export function sinceReview(p) {
  const author = p.author?.login;
  const r = (p.latestReviews ?? []).filter((x) => KINDS[x.state] && x.submittedAt && isPerson(x.author?.login, author)).sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
  if (!r) return null;
  const oids = p.recentCommits ?? [], seen = r.commit?.oid ? oids.indexOf(r.commit.oid) : -1;
  // Past the commits we fetched: at least all of them are new. Merges of the base are not work.
  const real = (list) => list.filter((c) => !(p.mergeOids ?? []).includes(c)).length;
  const commits = seen >= 0 ? real(oids.slice(seen + 1)) : movedSince(p, r.commit?.oid) ? real(oids) : 0;
  const replies = (p.comments ?? []).filter((c) => c.author?.login === author && !c.isMinimized && Date.parse(c.createdAt) > Date.parse(r.submittedAt)).length;
  return commits || replies ? { login: r.author.login, commits, replies } : null;
}

// The last few reviews and comments from anyone (the author's replies included), newest first: the thread behind the one-line summary.
export function activityOf(p, max = 5) {
  return [
    ...(p.latestReviews ?? []).filter((r) => KINDS[r.state] && r.submittedAt).map((r) => ({ login: r.author?.login, at: r.submittedAt, body: r.body, kind: KINDS[r.state] })),
    ...(p.comments ?? []).filter((c) => !c.isMinimized).map((c) => ({ login: c.author?.login, at: c.createdAt, body: c.body, kind: "comment" })),
  ].filter((e) => e.login && !BOT.test(e.login) && !(e.body ?? "").startsWith("<!--"))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max)
    .map((e) => ({ login: e.login, at: e.at, kind: e.kind, text: snippet(e.body, 220) }));
}

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
    reviews: (p.latestReviews ?? []).map((r) => ({ login: r.author?.login, state: r.state, stale: movedSince(p, r.commit?.oid) })),
    labels: p.labels ?? [], head: p.headRefName, headOid: p.headRefOid, base: p.baseRefName,
    adds: p.additions ?? 0, dels: p.deletions ?? 0, files: p.changedFiles ?? 0,
    updatedAt: p.updatedAt, ci: ciOf(p.statusCheckRollup),
    merge: mergeOf(p), blocked: p.mergeStateStatus === "BLOCKED", last: lastFromOthers(p),
    verdicts: verdictsOf(p), since: sinceReview(p), activity: activityOf(p),
  };
}

// Reviewed by someone, no verdict yet, nobody on it now and nobody asked: the next move is the author's (or an approver's), not a reviewer's.
export const isReviewed = (p) => reviewOf(p) === "needs" && !p.assignees.length && !p.requested.length
  && p.verdicts.some((v) => v.kind === "reviewed" && !v.stale);

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
    needs: { label: "Needs review", test: (p) => reviewOf(p) === "needs" && !p.assignees.length && !isReviewed(p) },
    reviewed: { label: "Reviewed", test: isReviewed },
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
  all: [["needs", "Needs a reviewer"], ["reviewing", "Being reviewed"], ["reviewed", "Reviewed"], ["changes", "Changes requested"], ["approved", "Approved"], ["draft", "Drafts"]],
};

function bucket(p, scope) {
  const review = reviewOf(p);
  if (review === "draft") return "draft";
  if (scope === "mine") return review === "changes" || p.merge === "conflicts" || p.ci === "failing" ? "attention" : review === "approved" && p.merge === "clean" && !p.blocked && p.ci !== "pending" ? "ready" : "waiting";
  return review === "changes" || review === "approved" ? review : p.assignees.length ? "reviewing" : isReviewed(p) ? "reviewed" : "needs";
}

// The list split into titled sections, in the order that puts what needs action first; empty ones are left out.
export function grouped(prs, scope) {
  const by = new Map(GROUPS[scope].map(([key, label]) => [key, { key, label, prs: [] }]));
  for (const p of prs) by.get(bucket(p, scope)).prs.push(p);
  return [...by.values()].filter((g) => g.prs.length);
}
