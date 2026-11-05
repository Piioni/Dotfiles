import test from "node:test";
import assert from "node:assert/strict";
import { reviewArgs, commentArgs, stateArgs, readyArgs, assignArgs, labelArgs, mergeArgs, updateBranchArgs, draftArgs, reviewerArgs, finishReviewArgs } from "../actions.js";

test("approving works without text; requesting changes or commenting a review needs it", () => {
  assert.deepEqual(reviewArgs("approve", "  ").args, ["review", "--approve"]);
  assert.deepEqual(reviewArgs("approve", " LGTM ").args, ["review", "--approve", "--body", "LGTM"]);
  assert.equal(reviewArgs("request-changes", " "), null);
  assert.deepEqual(reviewArgs("request-changes", "fix x").args, ["review", "--request-changes", "--body", "fix x"]);
  assert.equal(reviewArgs("comment", ""), null);
  assert.equal(reviewArgs("merge", "x"), null);
});

test("an empty comment is refused, a real one is trimmed", () => {
  assert.equal(commentArgs(" \n"), null);
  assert.deepEqual(commentArgs(" hi \n").args, ["comment", "--body", "hi"]);
});

test("close and reopen carry the comment box along only when it has text", () => {
  assert.deepEqual(stateArgs(true, "").args, ["close"]);
  assert.deepEqual(stateArgs(true, "stale").args, ["close", "--comment", "stale"]);
  assert.deepEqual(stateArgs(false, "back").args, ["reopen", "--comment", "back"]);
});

test("ready, assign and labels", () => {
  assert.deepEqual(readyArgs().args, ["ready"]);
  assert.deepEqual(assignArgs(true).args, ["edit", "--add-assignee", "@me"]);
  assert.deepEqual(assignArgs(false).args, ["edit", "--remove-assignee", "@me"]);
  assert.deepEqual(labelArgs("bug", true).args, ["edit", "--remove-label", "bug"]);
  assert.deepEqual(labelArgs("bug", false).args, ["edit", "--add-label", "bug"]);
});
