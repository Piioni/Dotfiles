// What the merge box says and does for one pull request; pure (no herdr, no gh), so the tests pin every state.
import { checks, login } from "./timeline.js";

// `git merge-tree --write-tree --name-only --no-messages`: exit 0 = clean (stdout is the tree), 1 = conflicts (tree line, then one file per line).
export function parseMergeTree(stdout, code) {
  if (code === 0) return { clean: true, files: [] };
  if (code !== 1) return null;
  const files = [];
  for (const line of stdout.split("\n").slice(1)) {
    if (!line.trim()) break;
    if (!files.includes(line)) files.push(line);
  }
  return { clean: false, files };
}

// Files both branches touched: where a merge may conflict when git can't say.
export function bothSides(prPaths, basePaths) {
  if (!prPaths.length || !basePaths.length) return [];
  const base = new Set(basePaths);
  return [...new Set(prPaths)].filter((p) => base.has(p)).sort();
}

export function mergeMethods(repo) {
  const methods = ["merge", "squash", "rebase"].filter((m) => repo?.[{ merge: "mergeCommitAllowed", squash: "squashMergeAllowed", rebase: "rebaseMergeAllowed" }[m]]);
  const wanted = repo?.viewerDefaultMergeMethod?.toLowerCase();
  return { methods, preferred: methods.includes(wanted) ? wanted : methods[0] ?? null };
}

// Each reviewer's last verdict, who is reviewing right now (assignees) and my role. The timeline's reviews carry the commit they saw.
export function reviewState(pr, items, me) {
  const author = login(pr.author), last = new Map();
  const reviews = items ? items.filter((e) => e.kind === "review").map((e) => ({ login: e.login, state: e.state.toLowerCase(), sha: e.sha ?? null }))
    : (pr.latestReviews ?? []).map((r) => ({ login: login(r.author), state: r.state.toLowerCase(), sha: null }));
  for (const r of reviews) {
    if (r.login === author) continue;
    const had = last.get(r.login);
    // A plain comment never replaces a verdict.
    if (r.state === "commented" && had) continue;
    last.set(r.login, r);
  }
  const verdicts = [...last.values()].filter((r) => r.state !== "pending").map((r) => ({ login: r.login, state: r.state, stale: Boolean(r.sha && pr.headRefOid && r.sha !== pr.headRefOid) }));
  const reviewing = (pr.assignees ?? []).map((a) => a.login);
  return { verdicts, reviewing, role: author === me ? "author" : reviewing.includes(me) ? "reviewing" : "reviewer" };
}

// The header's main button: the reviewer starts a review, the one reviewing shows it, the author asks again whoever reviewed before new commits.
// { kind: "start" | "reviewing" | "rerequest" | null, stale: [logins] }
export function reviewAction(pr, review) {
  const stale = review.verdicts.filter((v) => v.stale && v.state !== "commented").map((v) => v.login);
  if (pr.state !== "OPEN") return { kind: null, stale };
  if (review.role === "author") return { kind: stale.length ? "rerequest" : null, stale };
  return { kind: review.role === "reviewing" ? "reviewing" : "start", stale };
}

const WRITE = ["WRITE", "MAINTAIN", "ADMIN"], MERGEABLE_STATES = ["CLEAN", "UNSTABLE", "HAS_HOOKS"];
const METHOD = { merge: "Merge commit", squash: "Squash and merge", rebase: "Rebase and merge" };
const RANK = { bad: 5, warn: 4, ok: 3, review: 2, neutral: 1, merged: 0 };
const names = (list) => list.map((v) => v.login).join(", ");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function reviewRows(review) {
  if (!review) return [];
  const by = (state) => review.verdicts.filter((v) => v.state === state);
  const changes = by("changes_requested"), approved = by("approved"), stale = review.verdicts.filter((v) => v.stale && v.state !== "commented");
  const row = changes.length ? { tone: "bad", glyph: "x", title: `Changes requested by ${names(changes)}` }
    : approved.length ? { tone: "ok", glyph: "check", title: `Approved by ${names(approved)}` }
    : review.reviewing.length ? { tone: "review", glyph: "eye", title: `Being reviewed by ${review.reviewing.join(", ")}` }
    : { tone: "neutral", glyph: "dot", title: "No reviews yet" };
  return [{ key: "reviews", ...row },
    ...(stale.length ? [{ key: "stale", tone: "warn", glyph: "alert", title: `New commits since ${names(stale)}'s review` }] : [])];
}

function checkRow(pr) {
  const list = checks(pr.statusCheckRollup);
  if (!list.length) return [];
  const failing = list.filter((c) => c.outcome === "failing").length, pending = list.filter((c) => c.outcome === "pending").length;
  const row = failing ? { tone: "bad", glyph: "x", title: "Some checks were not successful", detail: `${failing} failing, ${list.length - failing} other` }
    : pending ? { tone: "warn", glyph: "dot", title: "Checks are pending", detail: `${pending} of ${list.length} still running` }
    : { tone: "ok", glyph: "check", title: "All checks have passed", detail: plural(list.length, "check") };
  return [{ key: "checks", ...row, items: list }];
}

// ctx: { me, repo (settings), compare: { behind, ahead, baseSha } | null, conflicts: { files, approx } | "loading" | null, review, method?, branchDeleted? }
export function mergeBox(pr, ctx) {
  const { me, compare, conflicts } = ctx, author = login(pr.author), mine = author === me, base = pr.baseRefName;
  const { methods, preferred } = mergeMethods(ctx.repo);
  const none = { show: false, enabled: false, reason: null, note: null, methods, method: preferred };
  const done = (row) => ({ tone: row.tone, rows: [{ key: "state", ...row }], merge: none, draftLink: false });

  if (pr.state === "MERGED") return done({ tone: "merged", glyph: "merged", title: "Pull request successfully merged and closed",
    detail: `${pr.mergedBy ? `${login(pr.mergedBy)} merged` : "Merged"} into ${base}`, at: pr.mergedAt, tail: ctx.branchDeleted ? "branch deleted" : null });
  if (pr.state === "CLOSED") return done({ tone: "bad", glyph: "closed", title: "Closed with unmerged commits", action: { kind: "reopen", label: "Reopen pull request" } });

  const conflicting = pr.mergeable === "CONFLICTING", behind = compare?.behind ?? 0;
  const rows = [...reviewRows(ctx.review), ...checkRow(pr)];
  const behindText = behind > 0 ? `${plural(behind, "commit")} behind ${base}` : null;
  if (pr.isDraft) rows.push({ key: "draft", tone: "neutral", glyph: "draft", title: "This pull request is still a work in progress", action: { kind: "ready", label: "Ready for review" } });
  if (conflicting) rows.push({ key: "conflicts", tone: "bad", glyph: "alert", title: "This branch has conflicts that must be resolved", detail: behindText,
    loading: conflicts === "loading", files: conflicts && conflicts !== "loading" ? conflicts.files : null, approx: Boolean(conflicts?.approx),
    action: { kind: "resolve", label: "Resolve conflicts" } });
  else if (!pr.isDraft) {
    const update = { kind: "update", label: "Update branch", confirm: mine ? null : `Pushes a merge commit to ${author}'s branch` };
    if (pr.mergeable !== "MERGEABLE") rows.push({ key: "status", tone: "neutral", glyph: "spinner", title: "Checking for the ability to merge automatically…" });
    else if (pr.mergeStateStatus === "BLOCKED") rows.push({ key: "status", tone: "warn", glyph: "alert", title: "Merging is blocked",
      detail: { REVIEW_REQUIRED: "Review required", CHANGES_REQUESTED: "Changes were requested" }[pr.reviewDecision] ?? "Required checks or reviews are missing" });
    else if (pr.mergeStateStatus === "BEHIND" || behind > 0) rows.push({ key: "status", tone: "warn", glyph: "behind", title: "This branch is out-of-date with the base branch", detail: behindText, action: update });
    else rows.push({ key: "status", tone: "ok", glyph: "check", title: "This branch has no conflicts with the base branch", detail: "Merging can be performed automatically." });
  }

  const method = methods.includes(ctx.method) ? ctx.method : preferred;
  const reason = !ctx.repo ? "Loading repository settings…"
    : !WRITE.includes(ctx.repo.viewerPermission) ? "You need write access to merge"
    : pr.isDraft ? "Draft pull requests cannot be merged."
    : conflicting ? "Resolve the conflicts to merge."
    : pr.mergeable !== "MERGEABLE" ? "Checking for the ability to merge automatically…"
    : pr.mergeStateStatus === "BLOCKED" ? "Merging is blocked."
    : !MERGEABLE_STATES.includes(pr.mergeStateStatus) ? "Update the branch to merge."
    : !method ? "This repository allows no merge method."
    : null;
  const note = reason || !method ? null : `${METHOD[method]}${ctx.repo.deleteBranchOnMerge ? " · branch deleted after merge" : ""}`;
  const tone = rows.reduce((worst, r) => (RANK[r.tone] > RANK[worst] ? r.tone : worst), "neutral");
  return { tone, rows, merge: { show: true, enabled: reason === null, reason, note, methods, method }, draftLink: mine && !pr.isDraft };
}

export const linearKey = (branch = "", title = "") => (/\b([A-Z][A-Z0-9]+-\d+)\b/i.exec(branch) ?? /\b([A-Z][A-Z0-9]+-\d+)\b/i.exec(title))?.[1].toUpperCase() ?? null;

export const commandLine = (head, base) => `git fetch origin && git switch ${head} && git merge origin/${base}`;

// How soon to look again, in ms: quickly while something is settling, rarely once it's over.
export function nextPoll(pr, { actedAt = 0, now = Date.now() } = {}) {
  if (pr.state !== "OPEN") return 120000;
  if (pr.mergeable === "UNKNOWN" || now - actedAt < 60000 || checks(pr.statusCheckRollup).some((c) => c.outcome === "pending")) return 5000;
  return 30000;
}
