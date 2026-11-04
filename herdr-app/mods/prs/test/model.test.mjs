import test from "node:test";
import assert from "node:assert/strict";
import { normalize, reviewOf, ciOf, counts, shown } from "../model.js";

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
  assert.deepEqual(counts(all, "mine", "me"), { all: 2, changes: 1, approved: 1, needs: 0, draft: 0 });
  assert.deepEqual(shown(all, { scope: "mine", chip: "changes", me: "me" }).map((p) => p.number), [2]);
});

test("all has unassigned, needs review and asked-of-me chips", () => {
  const all = [pr(1, { assignees: [{ login: "bo" }], reviewRequests: [{ login: "me" }] }), pr(2), pr(3, { isDraft: true })];
  assert.deepEqual(counts(all, "all", "me"), { all: 3, unassigned: 2, needs: 2, asked: 1, draft: 1 });
  assert.deepEqual(shown(all, { scope: "all", chip: "asked", me: "me" }).map((p) => p.number), [1]);
});

test("query matches number, title, author, branch and label; newest first", () => {
  const all = [pr(1, { title: "Fix login", labels: [{ name: "bug", color: "f00" }] }), pr(2, { author: { login: "luz" } })];
  const q = (query) => shown(all, { scope: "all", chip: "all", query, me: "me" }).map((p) => p.number);
  assert.deepEqual([q("#1"), q("login"), q("luz"), q("feat/2"), q("bug")], [[1], [1], [2], [2], [1]]);
  assert.deepEqual(q(""), [2, 1]);
});
