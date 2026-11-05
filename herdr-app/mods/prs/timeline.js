// A pull request's REST timeline as the dialog draws it; pure, so the tests can feed it fixtures.

/** @type {Record<string, string>} */
const EMOJI = {
  "+1": "👍", "-1": "👎", laugh: "😄", hooray: "🎉", confused: "😕", heart: "❤️", rocket: "🚀", eyes: "👀",
  THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀",
};
/** @param {any} user */
export const login = (user) => user?.login ?? "ghost";
/** @param {string} name */
export const shown = (name) => name.replace(/^app\//, "").replace(/\[bot\]$/, "");
/** @param {string} name */
export const bot = (name) => /^app\/|\[bot\]$/.test(name);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// As GitHub says it: "3h ago" this month, "on Sep 21" before that.
/** @param {string} iso */
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  const d = new Date(iso), year = d.getFullYear() === new Date().getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `on ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// Assigning means "being reviewed right now": taking it for yourself reads as starting a review, dropping it as finishing.
// Returns the words and, when someone else was assigned, who.
/** @param {any} e */
export function assignWords(e) {
  if (e.who === e.login) return { text: e.added ? "started reviewing" : "finished reviewing", who: null };
  return { text: e.added ? "assigned" : "unassigned", who: e.who };
}

/** @param {any} r @returns {any[]} */
export function reactions(r) {
  if (Array.isArray(r)) return r.filter((g) => g.users?.totalCount > 0 && EMOJI[g.content]).map((g) => ({ emoji: EMOJI[g.content], count: g.users.totalCount }));
  return Object.entries(r ?? {}).filter(([k, n]) => EMOJI[k] && n > 0).map(([k, n]) => ({ emoji: EMOJI[k], count: n }));
}

// Line comments grouped under the review that made them, replies after their thread's first comment.
export function inlineByReview(/** @type {any[]} */ comments = []) {
  const byReview = new Map();
  for (const c of [...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const list = byReview.get(c.pull_request_review_id) ?? [];
    list.push({ login: login(c.user), avatar: c.user?.avatar_url, at: c.created_at, path: c.path, line: c.line ?? c.original_line ?? null,
      body: c.body, reply: Boolean(c.in_reply_to_id), url: c.html_url });
    byReview.set(c.pull_request_review_id, list);
  }
  return byReview;
}

/** @param {any[]} raw @param {any[]} [inline] @returns {any[]} */
export function timeline(raw, inline = []) {
  /** @type {any[]} */
  const items = [];
  const threads = inlineByReview(inline);
  for (const e of raw) {
    const who = e.actor ?? e.user ?? null, base = { login: login(who), avatar: who?.avatar_url, at: e.created_at ?? e.submitted_at };
    switch (e.event) {
      case "commented":
        items.push({ ...base, kind: "comment", body: e.body, role: e.author_association, reactions: reactions(e.reactions), url: e.html_url });
        break;
      case "reviewed":
        items.push({ ...base, kind: "review", state: e.state, sha: e.commit_id, body: e.body, role: e.author_association, url: e.html_url, comments: threads.get(e.id) ?? [] });
        break;
      case "committed": {
        const last = items.at(-1), at = e.author?.date ?? e.committer?.date, commit = { sha: e.sha, message: e.message ?? "", url: e.html_url };
        if (last?.kind === "commits") { last.commits.push(commit); last.at = at; }
        else items.push({ kind: "commits", login: e.author?.name ?? "", at, commits: [commit] });
        break;
      }
      case "labeled": case "unlabeled": {
        const last = items.at(-1), added = e.event === "labeled";
        if (last?.kind === "labels" && last.login === base.login && Date.parse(base.at) - Date.parse(last.at) < 60000) (added ? last.added : last.removed).push(e.label);
        else items.push({ ...base, kind: "labels", added: added ? [e.label] : [], removed: added ? [] : [e.label] });
        break;
      }
      case "assigned": case "unassigned":
        items.push({ ...base, kind: "assign", added: e.event === "assigned", who: login(e.assignee) });
        break;
      case "review_requested": case "review_request_removed":
        items.push({ ...base, kind: "request", added: e.event === "review_requested", who: e.requested_reviewer?.login ?? e.requested_team?.name ?? "someone" });
        break;
      case "closed": items.push({ ...base, kind: "closed" }); break;
      case "reopened": items.push({ ...base, kind: "reopened" }); break;
      case "merged": items.push({ ...base, kind: "merged", sha: e.commit_id }); break;
      case "ready_for_review": items.push({ ...base, kind: "ready" }); break;
      case "convert_to_draft": items.push({ ...base, kind: "draft" }); break;
      case "head_ref_force_pushed": items.push({ ...base, kind: "forcepush" }); break;
      case "head_ref_deleted": items.push({ ...base, kind: "branchdeleted" }); break;
      case "renamed": items.push({ ...base, kind: "renamed", from: e.rename?.from, to: e.rename?.to }); break;
      case "cross-referenced": {
        const s = e.source?.issue;
        if (s) items.push({ ...base, kind: "mention", number: s.number, title: s.title, state: s.state, pr: Boolean(s.pull_request),
          merged: Boolean(s.pull_request?.merged_at), repo: s.repository?.full_name, url: s.html_url });
        break;
      }
    }
  }
  return items;
}

// A check run or commit status as a row: name, outcome and where to read more.
export function checks(/** @type {any[]} */ rollup = []) {
  const outcome = (/** @type {any} */ c) => {
    const v = c.conclusion || c.state || c.status;
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) return v === "SUCCESS" ? "passing" : "skipped";
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(v)) return "failing";
    return "pending";
  };
  return rollup.map((c) => ({ name: c.name ?? c.context ?? "check", workflow: c.workflowName ?? null, outcome: outcome(c), url: c.detailsUrl ?? c.targetUrl ?? null,
    took: elapsed(c.startedAt, c.completedAt) }));
}

// "45s", "2m 5s", "1h 3m" between two ISO times; null when either is missing or the end isn't after the start (gh sends 0001-01-01 while a check runs).
/** @param {string | undefined} start @param {string | undefined} end */
export function elapsed(start, end) {
  const s = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!(s >= 0)) return null;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
}
