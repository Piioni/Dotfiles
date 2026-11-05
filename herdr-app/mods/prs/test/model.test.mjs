import test from "node:test";
import assert from "node:assert/strict";
import { normalize, reviewOf, ciOf, counts, shown, grouped, lastFromOthers, mergeOf, verdictsOf, sinceReview, activityOf } from "../model.js";

const raw = (number, over = {}) => ({
  number, title: `PR ${number}`, url: `https://github.com/a/b/pull/${number}`, author: { login: "ana" }, assignees: [], reviewRequests: [],
  latestReviews: [], reviewDecision: "", isDraft: false, labels: [], updatedAt: `2026-11-0${number}T00:00:00Z`, statusCheckRollup: [],
  headRefName: `feat/${number}`, baseRefName: "develop", additions: 3, deletions: 1, changedFiles: 2, ...over,
});
const pr = (n, over) => normalize(raw(n, over));

test("review state: drafts first, then changes beat approvals, no review means needs", () => {
  assert.equal(reviewOf(pr(1, { isDraft: true, reviewDecision: "APPROVED" })), "draft");
  assert.equal(reviewOf(pr(1, { latestReviews: [{ author: { login: "x" }, state: "APPROVED" }, { author: { login: "y" }, state: "CHANGES_REQUESTED" }] })), "changes");
  assert.equal(reviewOf(pr(1, { reviewDecision: "APPROVED" })), "approved");
  assert.equal(reviewOf(pr(1, { latestReviews: [{ author: { login: "x" }, state: "COMMENTED" }] })), "needs");
  assert.equal(reviewOf(pr(1)), "needs");
  assert.equal(reviewOf(pr(1, { headRefOid: "new", reviewDecision: "CHANGES_REQUESTED", latestReviews: [{ state: "CHANGES_REQUESTED", commit: { oid: "old" } }] })), "needs");
  assert.equal(reviewOf(pr(1, { headRefOid: "new", reviewDecision: "CHANGES_REQUESTED", latestReviews: [{ state: "CHANGES_REQUESTED", commit: { oid: "new" } }] })), "changes");
});

test("re-requesting the reviewer who asked for changes puts the PR back to needs review", () => {
  const requested = [{ login: "juan" }];
  assert.equal(reviewOf(pr(1, { reviewDecision: "CHANGES_REQUESTED", reviewRequests: requested })), "needs");
  assert.equal(reviewOf(pr(1, { reviewDecision: "CHANGES_REQUESTED", reviewRequests: requested, latestReviews: [{ state: "CHANGES_REQUESTED" }] })), "changes");
});

test("re-requesting the approver puts an approved PR back to needs review, an extra reviewer does not", () => {
  const requested = [{ login: "juan" }];
  assert.equal(reviewOf(pr(1, { reviewDecision: "APPROVED", reviewRequests: requested })), "needs");
  assert.equal(reviewOf(pr(1, { reviewDecision: "APPROVED", reviewRequests: requested, latestReviews: [{ state: "APPROVED" }] })), "approved");
});

test("each reviewer's standing: verdict, stale on an older commit, or asked again", () => {
  const p = raw(1, { headRefOid: "c3", reviewRequests: [{ login: "cy" }, { login: "bo" }, { login: "ana" }], latestReviews: [
    { author: { login: "bo" }, state: "APPROVED", commit: { oid: "c3" }, submittedAt: "2026-11-02T00:00:00Z" },
    { author: { login: "di" }, state: "CHANGES_REQUESTED", commit: { oid: "c1" }, submittedAt: "2026-11-01T00:00:00Z" },
    { author: { login: "linear-code" }, state: "COMMENTED", commit: { oid: "c3" }, submittedAt: "2026-11-02T00:00:00Z" }] });
  assert.deepEqual(verdictsOf(p).map((v) => [v.login, v.kind, v.stale]), [["bo", "approved", false], ["di", "changes", true], ["cy", "pending", false]]);
});

test("since the newest review: commits pushed on top of the one it saw, and the author's replies", () => {
  const review = { author: { login: "bo" }, state: "CHANGES_REQUESTED", commit: { oid: "c2" }, submittedAt: "2026-11-02T00:00:00Z" };
  const reply = (at, who = "ana") => ({ author: { login: who }, createdAt: at, body: "done" });
  const p = raw(1, { headRefOid: "c4", recentCommits: ["c1", "c2", "c3", "c4"], latestReviews: [review],
    comments: [reply("2026-11-03T00:00:00Z"), reply("2026-11-01T00:00:00Z"), reply("2026-11-03T00:00:00Z", "bo")] });
  assert.deepEqual(sinceReview(p), { login: "bo", commits: 2, replies: 1 });
  assert.equal(sinceReview({ ...p, headRefOid: "c2", recentCommits: ["c1", "c2"], comments: [] }), null);
  // The review is older than the commits we fetched: all of them count.
  assert.equal(sinceReview({ ...p, recentCommits: ["c3", "c4"], comments: [] }).commits, 2);
  // No commit data (the lookup failed): only replies show.
  assert.deepEqual(sinceReview({ ...p, latestReviews: [{ ...review, commit: { oid: "" } }], recentCommits: undefined }), { login: "bo", commits: 0, replies: 1 });
  assert.equal(sinceReview(raw(1)), null);
});

test("activity: the last events from anyone, newest first, bots out", () => {
  const p = raw(1, {
    latestReviews: [{ author: { login: "bo" }, state: "CHANGES_REQUESTED", submittedAt: "2026-11-02T00:00:00Z", body: "## Fix the null\nmore" }],
    comments: [{ author: { login: "ana" }, createdAt: "2026-11-03T00:00:00Z", body: "fixed" }, { author: { login: "linear-code" }, createdAt: "2026-11-04T00:00:00Z", body: "link" }] });
  assert.deepEqual(activityOf(p).map((e) => [e.login, e.kind, e.text]), [["ana", "comment", "fixed"], ["bo", "changes", "Fix the null"]]);
  assert.equal(activityOf(p, 1).length, 1);
});

test("ci mixes check runs and commit statuses", () => {
  assert.equal(ciOf([]), null);
  assert.equal(ciOf([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passing");
  assert.equal(ciOf([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "SUCCESS" }]), "pending");
  assert.equal(ciOf([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }]), "failing");
  assert.equal(ciOf([{ state: "PENDING" }]), "pending");
});

test("mine shows only my PRs and its chips split by review outcome", () => {
  const all = [pr(1, { author: { login: "me" }, reviewDecision: "APPROVED" }), pr(2, { author: { login: "me" }, reviewDecision: "CHANGES_REQUESTED" }), pr(3)];
  assert.deepEqual(counts(all, "mine", "me"), { all: 2, conflicts: 0, changes: 1, approved: 1, needs: 0, draft: 0 });
  assert.deepEqual(shown(all, { scope: "mine", chip: "changes", me: "me" }).map((p) => p.number), [2]);
});

test("all has needs review, being reviewed (assigned) and asked-of-me chips", () => {
  const all = [pr(1, { assignees: [{ login: "bo" }], reviewRequests: [{ login: "me" }] }), pr(2), pr(3, { isDraft: true })];
  assert.deepEqual(counts(all, "all", "me"), { all: 3, needs: 1, reviewing: 1, asked: 1, draft: 1 });
  assert.deepEqual(shown(all, { scope: "all", chip: "asked", me: "me" }).map((p) => p.number), [1]);
});

test("query matches number, title, author, branch and label; newest first", () => {
  const all = [pr(1, { title: "Fix login", labels: [{ name: "bug", color: "f00" }] }), pr(2, { author: { login: "luz" } })];
  const q = (query) => shown(all, { scope: "all", chip: "all", query, me: "me" }).map((p) => p.number);
  assert.deepEqual([q("#1"), q("login"), q("luz"), q("feat/2"), q("bug")], [[1], [1], [2], [2], [1]]);
  assert.deepEqual(q(""), [2, 1]);
});

test("merge state: conflicts, behind, clean, or unknown while GitHub computes it", () => {
  assert.equal(mergeOf({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), "conflicts");
  assert.equal(mergeOf({ mergeable: "MERGEABLE", mergeStateStatus: "BEHIND" }), "behind");
  assert.equal(mergeOf({ mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" }), "clean");
  assert.equal(mergeOf({ mergeable: "UNKNOWN" }), "unknown");
});

test("last feedback is the newest review or comment from someone else, ignoring author, bots and minimized", () => {
  const p = {
    author: { login: "me" },
    comments: [
      { author: { login: "me" }, createdAt: "2026-11-05T00:00:00Z", body: "done" },
      { author: { login: "linear-code" }, createdAt: "2026-11-04T00:00:00Z", body: "x" },
      { author: { login: "bo" }, createdAt: "2026-11-02T00:00:00Z", body: "## Looks\nodd" },
      { author: { login: "zed" }, createdAt: "2026-11-06T00:00:00Z", body: "spam", isMinimized: true },
    ],
    latestReviews: [{ author: { login: "ana" }, submittedAt: "2026-11-03T00:00:00Z", state: "CHANGES_REQUESTED", body: "" }, { author: { login: "bo" }, submittedAt: "2026-11-09T00:00:00Z", state: "PENDING" }],
  };
  assert.deepEqual(lastFromOthers(p), { login: "ana", at: "2026-11-03T00:00:00Z", kind: "changes", text: "" });
  assert.deepEqual(lastFromOthers({ ...p, latestReviews: [] }), { login: "bo", at: "2026-11-02T00:00:00Z", kind: "comment", text: "Looks" });
  assert.equal(lastFromOthers({ author: { login: "me" } }), null);
});

test("mine groups put what needs action first; all groups split assigned (being reviewed) from waiting", () => {
  const mine = [pr(1), pr(2, { mergeable: "CONFLICTING" }), pr(3, { reviewDecision: "APPROVED", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }), pr(4, { isDraft: true })];
  assert.deepEqual(grouped(mine, "mine").map((g) => [g.key, g.prs.map((p) => p.number)]), [["attention", [2]], ["ready", [3]], ["waiting", [1]], ["draft", [4]]]);
  const all = [pr(1), pr(2, { assignees: [{ login: "bo" }] })];
  assert.deepEqual(grouped(all, "all").map((g) => [g.key, g.prs.map((p) => p.number)]), [["needs", [1]], ["reviewing", [2]]]);
});

test("a required-review repo needs its decision: one approval of two is not approved, and approved-but-blocked is not ready", () => {
  const one = { latestReviews: [{ author: { login: "x" }, state: "APPROVED" }] };
  assert.equal(reviewOf(pr(1, { ...one, reviewDecision: "REVIEW_REQUIRED" })), "needs");
  assert.equal(reviewOf(pr(1, one)), "approved");
  const mine = [pr(1, { reviewDecision: "APPROVED", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }), pr(2, { reviewDecision: "APPROVED", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" }), pr(3, { statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] })];
  assert.deepEqual(grouped(mine, "mine").map((g) => [g.key, g.prs.map((p) => p.number)]), [["attention", [3]], ["ready", [1]], ["waiting", [2]]]);
});

test("people whose login merely starts like a bot's are not bots", () => {
  const c = (login) => ({ author: { login: "me" }, comments: [{ author: { login }, createdAt: "2026-11-01T00:00:00Z", body: "hi" }] });
  assert.equal(lastFromOthers(c("linear-code")), null);
  assert.equal(lastFromOthers(c("vercel[bot]")), null);
  assert.equal(lastFromOthers(c("linearity")).login, "linearity");
});
