// The `gh pr` arguments for what the dialog can do; pure, so the tests pin them without touching GitHub.

// A review: approving may go without words, the other two need them. null = not allowed yet.
export function reviewArgs(kind, body) {
  const text = body.trim();
  if (!["approve", "request-changes", "comment"].includes(kind)) return null;
  if (kind !== "approve" && !text) return null;
  return { label: { approve: "Approved", "request-changes": "Changes requested", comment: "Review sent" }[kind],
    args: ["review", `--${kind}`, ...(text ? ["--body", text] : [])] };
}

export const commentArgs = (body) => (body.trim() ? { label: "Comment posted", args: ["comment", "--body", body.trim()] } : null);

// Closing or reopening takes what's in the comment box along, as on GitHub.
export function stateArgs(close, body) {
  const text = body.trim();
  return { label: close ? "Pull request closed" : "Pull request reopened", args: [close ? "close" : "reopen", ...(text ? ["--comment", text] : [])] };
}

export const readyArgs = () => ({ label: "Marked ready for review", args: ["ready"] });
export const assignArgs = (on) => ({ label: on ? "Assigned to you" : "Unassigned", args: ["edit", on ? "--add-assignee" : "--remove-assignee", "@me"] });
export const labelArgs = (name, has) => ({ label: "Labels saved", args: ["edit", has ? "--remove-label" : "--add-label", name] });
