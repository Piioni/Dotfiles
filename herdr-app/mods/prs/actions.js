// The `gh pr` arguments for what the dialog can do; pure, so the tests pin them without touching GitHub.

// A review: approving may go without words, the other two need them. null = not allowed yet.
/** @param {string} kind @param {string} body */
export function reviewArgs(kind, body) {
  const text = body.trim();
  if (!["approve", "request-changes", "comment"].includes(kind)) return null;
  if (kind !== "approve" && !text) return null;
  return { label: { approve: "Approved", "request-changes": "Changes requested", comment: "Review sent" }[/** @type {"approve" | "request-changes" | "comment"} */ (kind)], busy: kind === "approve" ? "Approving…" : "Sending review…",
    args: ["review", `--${kind}`, ...(text ? ["--body", text] : [])] };
}

/** @param {string} body */
export const commentArgs = (body) => (body.trim() ? { label: "Comment posted", busy: "Posting comment…", args: ["comment", "--body", body.trim()] } : null);

// Closing or reopening takes what's in the comment box along, as on GitHub.
/** @param {boolean} close @param {string} body */
export function stateArgs(close, body) {
  const text = body.trim();
  return { label: close ? "Pull request closed" : "Pull request reopened", busy: close ? "Closing…" : "Reopening…", args: [close ? "close" : "reopen", ...(text ? ["--comment", text] : [])] };
}

export const readyArgs = () => ({ label: "Marked ready for review", busy: "Marking ready…", args: ["ready"] });
/** @param {boolean} on */
export const assignArgs = (on) => ({ label: on ? "Review started" : "Review finished", busy: on ? "Starting review…" : "Stopping review…", args: ["edit", on ? "--add-assignee" : "--remove-assignee", "@me"] });
// Always names a method: without one gh asks interactively and would hang. --match-head-commit refuses a merge if the branch moved since it was read.
/** @param {string} method @param {string} headOid */
export function mergeArgs(method, headOid) {
  if (!["merge", "squash", "rebase"].includes(method) || !headOid) return null;
  return { label: "Merged", busy: "Merging…", args: ["merge", `--${method}`, "--match-head-commit", headOid] };
}

/** @param {boolean} [rebase] */
export const updateBranchArgs = (rebase = false) => ({ label: "Branch updated", busy: "Updating branch…", args: ["update-branch", ...(rebase ? ["--rebase"] : [])] });
export const draftArgs = () => ({ label: "Converted to draft", busy: "Converting to draft…", args: ["ready", "--undo"] });
/** @param {string} login */
export const reviewerArgs = (login) => ({ label: "Review requested", busy: "Requesting review…", args: ["edit", "--add-reviewer", login] });

// A review, then taking myself off the assignees: the review is done. Both or none, in order.
/** @param {string} kind @param {string} body */
export function finishReviewArgs(kind, body) {
  const review = reviewArgs(kind, body);
  return review ? [review, assignArgs(false)] : null;
}

/** @param {string} name @param {boolean} has */
export const labelArgs = (name, has) => ({ label: "Labels saved", busy: "Saving labels…", args: ["edit", has ? "--remove-label" : "--add-label", name] });
