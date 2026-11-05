import test from "node:test";
import assert from "node:assert/strict";
import { timeline, inlineByReview, checks, assignWords } from "../timeline.js";

const actor = (/** @type {string} */ login) => ({ login, avatar_url: `https://a/${login}` });

test("consecutive commits collapse into one entry; other events keep their order", () => {
  const items = timeline([
    { event: "assigned", actor: actor("ana"), assignee: actor("ana"), created_at: "2026-11-01T00:00:00Z" },
    { event: "committed", sha: "a1", message: "feat: one\n\nbody", author: { name: "Ana", date: "2026-11-01T01:00:00Z" } },
    { event: "committed", sha: "b2", message: "fix: two", author: { name: "Ana", date: "2026-11-01T02:00:00Z" } },
    { event: "commented", actor: actor("bo"), body: "hi", created_at: "2026-11-01T03:00:00Z" },
  ]);
  assert.deepEqual(items.map((i) => i.kind), ["assign", "commits", "comment"]);
  assert.deepEqual(items[1].commits.map((/** @type {any} */ c) => c.sha), ["a1", "b2"]);
});

test("a review carries its line comments, matched by review id", () => {
  const inline = [
    { pull_request_review_id: 7, user: actor("bo"), created_at: "2026-11-02T00:00:00Z", path: "lib/a.dart", line: 12, body: "why?" },
    { pull_request_review_id: 7, user: actor("ana"), created_at: "2026-11-02T01:00:00Z", path: "lib/a.dart", original_line: 12, in_reply_to_id: 1, body: "because" },
    { pull_request_review_id: 8, user: actor("cy"), created_at: "2026-11-02T00:00:00Z", path: "b.dart", line: 3, body: "other" },
  ];
  const [review] = timeline([{ event: "reviewed", id: 7, user: actor("bo"), state: "changes_requested", body: "see inline", submitted_at: "2026-11-02T00:00:01Z" }], inline);
  assert.equal(review.state, "changes_requested");
  assert.deepEqual(review.comments.map((/** @type {any} */ c) => [c.login, c.line, c.reply]), [["bo", 12, false], ["ana", 12, true]]);
  assert.equal(inlineByReview(inline).get(8).length, 1);
});

test("review requests name a user or a team; label bursts by one person merge", () => {
  const items = timeline([
    { event: "review_requested", actor: actor("ana"), requested_reviewer: actor("bo"), created_at: "2026-11-01T00:00:00Z" },
    { event: "review_requested", actor: actor("ana"), requested_team: { name: "core" }, created_at: "2026-11-01T00:00:05Z" },
    { event: "labeled", actor: actor("ana"), label: { name: "a" }, created_at: "2026-11-01T00:01:00Z" },
    { event: "labeled", actor: actor("ana"), label: { name: "b" }, created_at: "2026-11-01T00:01:10Z" },
  ]);
  assert.deepEqual(items.map((i) => i.who ?? i.added.map((/** @type {any} */ l) => l.name)), ["bo", "core", ["a", "b"]]);
});

test("assigning yourself reads as starting a review, unassigning as finishing; assigning others stays literal", () => {
  const items = timeline([
    { event: "assigned", actor: actor("ana"), assignee: actor("ana"), created_at: "2026-11-01T00:00:00Z" },
    { event: "unassigned", actor: actor("ana"), assignee: actor("ana"), created_at: "2026-11-01T00:00:01Z" },
    { event: "assigned", actor: actor("ana"), assignee: actor("bo"), created_at: "2026-11-01T00:00:02Z" },
    { event: "unassigned", actor: actor("ana"), assignee: actor("bo"), created_at: "2026-11-01T00:00:03Z" },
  ]);
  assert.deepEqual(items.map(assignWords), [
    { text: "started reviewing", who: null }, { text: "finished reviewing", who: null },
    { text: "assigned", who: "bo" }, { text: "unassigned", who: "bo" },
  ]);
});

test("a review remembers the commit it saw", () => {
  const [r] = timeline([{ event: "reviewed", id: 1, user: actor("bo"), state: "approved", commit_id: "abc", submitted_at: "2026-11-02T00:00:00Z" }]);
  assert.equal(r.sha, "abc");
});

test("checks mix check runs and statuses into passing, failing, pending or skipped", () => {
  const rows = checks([
    { name: "build", workflowName: "CI", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "u1" },
    { name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "deploy", status: "IN_PROGRESS", conclusion: "" },
    { context: "legacy", state: "SUCCESS", targetUrl: "u2" },
    { name: "opt", status: "COMPLETED", conclusion: "SKIPPED" },
  ]);
  assert.deepEqual(rows.map((r) => r.outcome), ["passing", "failing", "pending", "passing", "skipped"]);
  assert.equal(rows[3].name, "legacy");
});
