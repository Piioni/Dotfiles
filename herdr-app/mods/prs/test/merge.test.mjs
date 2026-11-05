import test from "node:test";
import assert from "node:assert/strict";
import { parseMergeTree, bothSides, mergeMethods, reviewState, reviewAction, mergeBox, linearKey, commandLine, nextPoll, worktreeFor } from "../merge.js";

const SIPOS = { mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false, deleteBranchOnMerge: true, viewerDefaultMergeMethod: "MERGE", viewerPermission: "WRITE" };
const pr = (over = {}) => ({ state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "", headRefOid: "h1", baseRefName: "develop",
  author: { login: "ana" }, assignees: [], statusCheckRollup: [], latestReviews: [], ...over });
const box = (over, ctx = {}) => mergeBox(pr(over), { me: "bo", repo: SIPOS, compare: null, conflicts: null, review: reviewState(pr(over), [], "bo"), ...ctx });
const keys = (b) => b.rows.map((r) => r.key);
const row = (b, key) => b.rows.find((r) => r.key === key);

test("merge-tree output as git prints it: exit 1 lists the tree, then each conflicting file once", () => {
  const out = "3704ecc3d7cd5049f6e50d53db533d7f850197e0\npackages/sipos_core/assets/changelog.json\nlib/a.dart\nlib/a.dart\n\nAuto-merging x\n";
  assert.deepEqual(parseMergeTree(out, 1), { clean: false, files: ["packages/sipos_core/assets/changelog.json", "lib/a.dart"] });
  assert.deepEqual(parseMergeTree("3704ecc3d7cd5049f6e50d53db533d7f850197e0\n", 0), { clean: true, files: [] });
  assert.equal(parseMergeTree("", 128), null);
});

test("both sides: sorted intersection, empty when either side is", () => {
  assert.deepEqual(bothSides(["b", "a", "c"], ["c", "a", "z"]), ["a", "c"]);
  assert.deepEqual(bothSides([], ["a"]), []);
  assert.deepEqual(bothSides(["a"], []), []);
});

test("merge methods follow the allowed flags, the viewer's default first", () => {
  assert.deepEqual(mergeMethods(SIPOS), { methods: ["merge"], preferred: "merge" });
  assert.deepEqual(mergeMethods({ ...SIPOS, squashMergeAllowed: true, viewerDefaultMergeMethod: "SQUASH" }), { methods: ["merge", "squash"], preferred: "squash" });
  assert.deepEqual(mergeMethods({ ...SIPOS, viewerDefaultMergeMethod: "REBASE" }).preferred, "merge");
  assert.deepEqual(mergeMethods(null), { methods: [], preferred: null });
});

test("review state: last verdict per person, stale when the commit moved, role from assignees", () => {
  const items = [
    { kind: "review", login: "bo", state: "changes_requested", sha: "old" },
    { kind: "review", login: "bo", state: "approved", sha: "old" },
    { kind: "review", login: "bo", state: "commented", sha: "h1" },
    { kind: "review", login: "cy", state: "approved", sha: "h1" },
    { kind: "review", login: "ana", state: "commented", sha: "h1" },
    { kind: "comment", login: "dee" },
  ];
  const s = reviewState(pr({ assignees: [{ login: "cy" }] }), items, "cy");
  assert.deepEqual(s.verdicts, [{ login: "bo", state: "approved", stale: true }, { login: "cy", state: "approved", stale: false }]);
  assert.deepEqual(s.reviewing, ["cy"]);
  assert.equal(s.role, "reviewing");
  assert.equal(reviewState(pr(), items, "ana").role, "author");
  assert.equal(reviewState(pr(), items, "zed").role, "reviewer");
});

test("review state falls back to gh's latest reviews when the timeline is missing", () => {
  const s = reviewState(pr({ latestReviews: [{ author: { login: "bo" }, state: "APPROVED" }] }), null, "x");
  assert.deepEqual(s.verdicts, [{ login: "bo", state: "approved", stale: false }]);
});

test("ready: green, merge enabled with its method and branch deletion", () => {
  const b = box();
  assert.equal(b.tone, "ok");
  assert.deepEqual(keys(b), ["reviews", "status"]);
  assert.equal(row(b, "status").title, "This branch has no conflicts with the base branch");
  assert.deepEqual(b.merge, { show: true, enabled: true, reason: null, note: "Merge commit · branch deleted after merge", methods: ["merge"], method: "merge" });
  assert.equal(b.draftLink, false);
});

test("my own open pull request offers converting to draft", () => assert.equal(box({}, { me: "ana" }).draftLink, true));

test("conflicts: files listed, merge disabled, resolve action; the list may still be loading", () => {
  const b = box({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, { compare: { behind: 85, ahead: 6 }, conflicts: { files: ["changelog.json"], approx: false } });
  assert.equal(b.tone, "bad");
  const c = row(b, "conflicts");
  assert.deepEqual([c.title, c.detail, c.files, c.approx, c.action.kind], ["This branch has conflicts that must be resolved", "85 commits behind develop", ["changelog.json"], false, "resolve"]);
  assert.deepEqual([b.merge.enabled, b.merge.reason], [false, "Resolve the conflicts to merge."]);
  const loading = row(box({ mergeable: "CONFLICTING" }, { conflicts: "loading" }), "conflicts");
  assert.deepEqual([loading.loading, loading.files], [true, null]);
  assert.equal(row(box({ mergeable: "CONFLICTING" }, { conflicts: { files: ["a"], approx: true } }), "conflicts").approx, true);
});

test("behind without conflicts: warns with Update branch, merging stays enabled; confirm only on someone else's branch", () => {
  const b = box({}, { compare: { behind: 10, ahead: 1 } });
  const s = row(b, "status");
  assert.deepEqual([b.tone, s.title, s.detail, s.action.kind, s.action.confirm], ["warn", "This branch is out-of-date with the base branch", "10 commits behind develop", "update", "Pushes a merge commit to ana's branch"]);
  assert.equal(b.merge.enabled, true);
  assert.equal(row(box({}, { me: "ana", compare: { behind: 1 } }), "status").action.confirm, null);
  assert.equal(row(box({}, { compare: { behind: 1 } }), "status").detail, "1 commit behind develop");
});

test("mergeStateStatus BEHIND (strict protection) blocks merging until updated", () => {
  const b = box({ mergeStateStatus: "BEHIND" });
  assert.equal(row(b, "status").action.kind, "update");
  assert.deepEqual([b.merge.enabled, b.merge.reason], [false, "Update the branch to merge."]);
});

test("unknown: spinner row and merge disabled", () => {
  const b = box({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
  assert.deepEqual([row(b, "status").glyph, b.merge.enabled], ["spinner", false]);
});

test("blocked: says why", () => {
  const b = box({ mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" });
  assert.deepEqual([row(b, "status").title, row(b, "status").detail, b.merge.enabled], ["Merging is blocked", "Review required", false]);
  assert.equal(row(box({ mergeStateStatus: "BLOCKED" }), "status").detail, "Required checks or reviews are missing");
});

test("unstable (non-required checks failing) still merges, and the checks row is bad", () => {
  const b = box({ mergeStateStatus: "UNSTABLE", statusCheckRollup: [{ name: "lint", status: "COMPLETED", conclusion: "FAILURE" }, { name: "build", status: "COMPLETED", conclusion: "SUCCESS" }] });
  assert.deepEqual([b.merge.enabled, row(b, "checks").title, row(b, "checks").detail, row(b, "checks").items.length, b.tone], [true, "Some checks were not successful", "1 failing, 1 other", 2, "bad"]);
});

test("checks: pending is a warning, all green is ok, none means no row", () => {
  const pending = box({ statusCheckRollup: [{ name: "ci", status: "IN_PROGRESS" }] });
  assert.deepEqual([row(pending, "checks").tone, row(pending, "checks").title], ["warn", "Checks are pending"]);
  assert.equal(row(box({ statusCheckRollup: [{ name: "ci", conclusion: "SUCCESS" }] }), "checks").tone, "ok");
  assert.equal(row(box(), "checks"), undefined);
});

test("draft: ready for review action, merge refused; a conflict row still shows", () => {
  const b = box({ isDraft: true });
  assert.deepEqual([row(b, "draft").action.kind, b.merge.reason, b.draftLink, row(b, "status")], ["ready", "Draft pull requests cannot be merged.", false, undefined]);
  assert.deepEqual(keys(box({ isDraft: true, mergeable: "CONFLICTING" })), ["reviews", "draft", "conflicts"]);
});

test("merged: one purple row, no footer; closed: reopen, no footer", () => {
  const m = box({ state: "MERGED", mergedAt: "2026-11-01T00:00:00Z", mergedBy: { login: "cy" } }, { branchDeleted: true });
  assert.deepEqual([m.tone, keys(m), m.merge.show, row(m, "state").title, row(m, "state").detail, row(m, "state").tail],
    ["merged", ["state"], false, "Pull request successfully merged and closed", "cy merged into develop", "branch deleted"]);
  const c = box({ state: "CLOSED" });
  assert.deepEqual([row(c, "state").title, row(c, "state").action.kind, c.merge.show], ["Closed with unmerged commits", "reopen", false]);
});

test("no write access: footer disabled with the reason; settings still loading says so", () => {
  const b = box({}, { repo: { ...SIPOS, viewerPermission: "READ" } });
  assert.deepEqual([b.merge.enabled, b.merge.reason], [false, "You need write access to merge"]);
  assert.equal(box({}, { repo: null }).merge.reason, "Loading repository settings…");
});

test("reviews row: changes requested beats approval, approval beats being reviewed, else none yet", () => {
  const rev = (...v) => ({ verdicts: v.map(([login, state, stale = false]) => ({ login, state, stale })), reviewing: [], role: "reviewer" });
  assert.equal(row(box({}, { review: rev(["bo", "approved"], ["cy", "changes_requested"]) }), "reviews").title, "Changes requested by cy");
  assert.equal(row(box({}, { review: rev(["bo", "approved"]) }), "reviews").title, "Approved by bo");
  assert.deepEqual([row(box({}, { review: { verdicts: [], reviewing: ["bo"], role: "reviewing" } }), "reviews").tone], ["review"]);
  assert.equal(row(box(), "reviews").title, "No reviews yet");
});

test("stale review: warns about new commits since it", () => {
  const b = box({}, { review: { verdicts: [{ login: "bo", state: "approved", stale: true }], reviewing: [], role: "reviewer" } });
  assert.deepEqual([keys(b), row(b, "stale").title, b.tone], [["reviews", "stale", "status"], "New commits since bo's review", "warn"]);
});

test("squash-only repo picks squash; a choice among several is honored", () => {
  const repo = { ...SIPOS, mergeCommitAllowed: true, squashMergeAllowed: true, viewerDefaultMergeMethod: "SQUASH" };
  assert.equal(box({}, { repo }).merge.method, "squash");
  assert.deepEqual(box({}, { repo, method: "merge" }).merge.note, "Merge commit · branch deleted after merge");
  assert.equal(box({}, { repo, method: "rebase" }).merge.method, "squash");
});

test("header action: reviewers start, the one reviewing shows it, the author re-requests only after new commits", () => {
  const items = [{ kind: "review", login: "bo", state: "approved", sha: "old" }, { kind: "review", login: "cy", state: "commented", sha: "old" }];
  const act = (over, me, list = items) => reviewAction(pr(over), reviewState(pr(over), list, me));
  assert.deepEqual(act({}, "zed"), { kind: "start", stale: ["bo"] });
  assert.equal(act({ assignees: [{ login: "zed" }] }, "zed").kind, "reviewing");
  assert.equal(act({ assignees: [{ login: "bo" }] }, "zed").kind, "start");
  assert.deepEqual(act({}, "ana"), { kind: "rerequest", stale: ["bo"] });
  assert.equal(act({}, "ana", [{ kind: "review", login: "bo", state: "approved", sha: "h1" }]).kind, null);
  assert.equal(act({ state: "MERGED" }, "zed").kind, null);
});

test("linear key comes from the branch first, then the title", () => {
  assert.equal(linearKey("feat/POS-941-x", "other POS-1"), "POS-941");
  assert.equal(linearKey("fix/thing", "Fix pos-12 crash"), "POS-12");
  assert.equal(linearKey("main", "no key"), null);
});

test("worktree of a branch from git worktree list --porcelain", () => {
  const out = "worktree /r/app\nHEAD aaa\nbranch refs/heads/develop\n\nworktree /r/app.feat\nHEAD bbb\nbranch refs/heads/feat/POS-1-x\n\nworktree /r/detached\nHEAD ccc\ndetached\n";
  assert.equal(worktreeFor(out, "feat/POS-1-x"), "/r/app.feat");
  assert.equal(worktreeFor(out, "develop"), "/r/app");
  assert.equal(worktreeFor(out, "feat/POS-1"), null);
  assert.equal(worktreeFor("", "develop"), null);
});

test("command line instructions", () => assert.equal(commandLine("feat/x", "develop"), "git fetch origin && git switch feat/x && git merge origin/develop"));

test("polling: fast while settling, slow when merged or closed", () => {
  const now = 1_000_000;
  assert.equal(nextPoll(pr(), { now }), 30000);
  assert.equal(nextPoll(pr({ mergeable: "UNKNOWN" }), { now }), 5000);
  assert.equal(nextPoll(pr({ statusCheckRollup: [{ name: "ci", status: "QUEUED" }] }), { now }), 5000);
  assert.equal(nextPoll(pr(), { now, actedAt: now - 59000 }), 5000);
  assert.equal(nextPoll(pr(), { now, actedAt: now - 61000 }), 30000);
  assert.equal(nextPoll(pr({ state: "MERGED" }), { now, actedAt: now }), 120000);
});
