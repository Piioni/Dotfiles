// Pure data shaping for the issues panel: no herdr, no network.

const TYPE_ORDER = ["started", "unstarted", "triage", "backlog", "completed", "canceled", "duplicate"];
const DAY = 86400000;
const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];

// A type Linear adds later sorts last instead of first.
const rank = (type) => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? TYPE_ORDER.length : i; };
export const isFinished = (type) => ["completed", "canceled", "duplicate"].includes(type);

export const GROUPINGS = { status: "Status", priority: "Priority", project: "Project", assignee: "Assignee", team: "Team", label: "Label", none: "No grouping" };
export const ORDERS = { priority: "Priority", updated: "Updated", created: "Created", due: "Due date", title: "Title" };
export const COMPLETED = { none: "None", week: "Past week", month: "Past month", all: "All" };

// The display options a Linear view was saved with, as ours. What we can't show falls back to the default.
const GROUP_OF = { workflowState: "status", priority: "priority", project: "project", assignee: "assignee", team: "team", label: "label" };
const ORDER_OF = { priority: "priority", dateUpdated: "updated", dateCreated: "created", dueDate: "due", title: "title" };
const NATURAL = { updated: "desc", created: "desc", due: "asc", title: "asc" };
const COMPLETED_OF = { all: "all", none: "none", week: "week", month: "month" };
export function fromPrefs(p = {}) {
  const order = ORDER_OF[p.viewOrdering] ?? DEFAULT_VIEW.order;
  return {
    ...DEFAULT_VIEW,
    grouping: GROUP_OF[p.issueGrouping] ?? (p.issueGrouping === "none" ? "none" : DEFAULT_VIEW.grouping),
    sub: GROUP_OF[p.issueSubGrouping] ?? "none",
    order, reverse: Boolean(NATURAL[order] && p.viewOrderingDirection && p.viewOrderingDirection !== NATURAL[order]),
    completed: COMPLETED_OF[p.showCompletedIssues] ?? "all",
    subIssues: p.showSubIssues ?? true, triage: p.showTriageIssues ?? true,
  };
}

export const DEFAULT_VIEW = {
  grouping: "status", sub: "none", order: "priority", reverse: false, completed: "month",
  subIssues: true, triage: true, nested: true, empty: false,
};

const PULL = /\/pull\/(\d+)/;

export function normalize(n) {
  const kids = n.children?.nodes ?? [];
  const prs = (n.attachments?.nodes ?? []).flatMap((a) => {
    const number = PULL.exec(a.url ?? "")?.[1];
    return a.sourceType === "github" && number ? [{ number: Number(number), url: a.url }] : [];
  });
  return {
    id: n.identifier, title: n.title, url: n.url, branch: n.branchName, priority: n.priority ?? 0,
    createdAt: n.createdAt ?? n.updatedAt, updatedAt: n.updatedAt, completedAt: n.completedAt ?? null, dueDate: n.dueDate ?? null,
    state: { name: n.state.name, type: n.state.type, color: n.state.color, position: n.state.position },
    team: n.team?.key ?? "", project: n.project ?? null, parent: n.parent?.identifier ?? null,
    assignee: n.assignee ? (n.assignee.displayName || n.assignee.name) : null, avatar: n.assignee?.avatarUrl ?? null,
    blocking: n.blocks?.on ?? 0, blockedBy: n.blocks?.by ?? 0,
    kids: { total: kids.length, done: kids.filter((k) => isFinished(k.state.type)).length },
    labels: n.labels?.nodes ?? [], prs,
  };
}

export function matches(task, query) {
  const q = query.trim().toLowerCase();
  return !q || `${task.id} ${task.title} ${task.project?.name ?? ""} ${task.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(q);
}

// What the display options leave of the tasks, before the text query.
export function prepare(tasks, view = DEFAULT_VIEW, now = Date.now()) {
  const span = { none: 0, week: 7 * DAY, month: 30 * DAY, all: Infinity }[view.completed] ?? 30 * DAY;
  return tasks.filter((t) => {
    if (isFinished(t.state.type) && (!span || now - Date.parse(t.completedAt ?? t.updatedAt) > span)) return false;
    if (!view.subIssues && t.parent) return false;
    if (!view.triage && t.state.type === "triage") return false;
    return true;
  });
}

const KEYERS = {
  status: (t) => [{ key: `${t.state.type}:${t.state.name}`, name: t.state.name, color: t.state.color, type: t.state.type, order: rank(t.state.type) * 1000 + t.state.position, icon: "status" }],
  priority: (t) => [{ key: `p${t.priority}`, name: PRIORITIES[t.priority] ?? "No priority", priority: t.priority, order: t.priority || 5, icon: "priority" }],
  project: (t) => [t.project ? { key: `project:${t.project.name}`, name: t.project.name, color: t.project.color, order: 0, icon: "dot" } : { key: "project:", name: "No project", order: 1, icon: "dot" }],
  assignee: (t) => [t.assignee ? { key: `assignee:${t.assignee}`, name: t.assignee, order: 0, icon: "dot" } : { key: "assignee:", name: "Unassigned", order: 1, icon: "dot" }],
  team: (t) => [{ key: `team:${t.team}`, name: t.team || "No team", order: 0, icon: "dot" }],
  label: (t) => (t.labels.length ? t.labels.map((l) => ({ key: `label:${l.name}`, name: l.name, color: l.color, order: 0, icon: "dot" })) : [{ key: "label:", name: "No label", order: 1, icon: "dot" }]),
  none: () => [{ key: "all", name: "", order: 0, icon: null }],
};

// Groups that exist even when empty: every status of the workflow, every priority.
function known(grouping, states) {
  if (grouping === "priority") return PRIORITIES.map((_, p) => KEYERS.priority({ priority: p })[0]);
  if (grouping === "status") {
    const seen = new Map();
    for (const s of states) { const k = `${s.type}:${s.name}`; if (!seen.has(k) || seen.get(k).position > s.position) seen.set(k, s); }
    return [...seen.values()].map((s) => KEYERS.status({ state: s })[0]);
  }
  return [];
}

const time = (iso) => Date.parse(iso);
const due = (t) => (t.dueDate ? time(t.dueDate) : Number.MAX_SAFE_INTEGER);
const ORDER_BY = {
  priority: (a, b) => (a.priority || 5) - (b.priority || 5),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
  created: (a, b) => time(b.createdAt) - time(a.createdAt),
  due: (a, b) => due(a) - due(b),
  title: (a, b) => a.title.localeCompare(b.title),
};

export function comparator(view = DEFAULT_VIEW) {
  const by = ORDER_BY[view.order] ?? ORDER_BY.priority;
  return (a, b) => { const r = by(a, b) || ORDER_BY.updated(a, b); return view.reverse ? -r : r; };
}

function bucket(items, by, extra = []) {
  const groups = new Map(extra.map((m) => [m.key, { ...m, items: [] }]));
  for (const item of items) for (const m of KEYERS[by](item.task ?? item)) {
    if (!groups.has(m.key)) groups.set(m.key, { ...m, items: [] });
    groups.get(m.key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export const DEFAULT_ORDER = { order: [], hidden: [] };

// The person's order for the groups (the ones they never placed follow, in the default order), minus the hidden ones.
function arrange(groups, { order = [], hidden = [] } = DEFAULT_ORDER, keepHidden = false) {
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = (g) => (rank.has(g.key) ? rank.get(g.key) : Infinity);
  const kept = groups.filter((g) => keepHidden || !hidden.includes(g.key));
  return kept.sort((a, b) => (at(a) === at(b) ? 0 : at(a) - at(b)));
}

// Every group the current grouping can show, in the person's order, with whether it's hidden: what the ordering list draws.
export function groupMetas(tasks, { view = DEFAULT_VIEW, states = [], order = DEFAULT_ORDER } = {}) {
  const all = group(tasks, { view: { ...view, sub: "none", empty: true, nested: false }, states, order, keepHidden: true });
  return all.filter((g) => view.grouping !== "none").map(({ key, name, color, type, priority, icon }) => ({ key, name, color, type, priority, icon, hidden: order.hidden.includes(key) }));
}

// Moves one key to the slot another key holds, over a full list of keys.
export function moveKey(keys, key, target) {
  const from = keys.indexOf(key), to = keys.indexOf(target);
  if (from < 0 || to < 0 || from === to) return keys;
  const next = keys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

const size = (rows) => rows.reduce((n, r) => n + 1 + size(r.children), 0);

// Groups of rows (and sub-groups when asked); a task whose parent is listed nests under it.
export function group(tasks, { query = "", view = DEFAULT_VIEW, states = [], order = DEFAULT_ORDER, keepHidden = false } = {}) {
  const shown = tasks.filter((t) => matches(t, query));
  const ids = new Set(shown.map((t) => t.id)), cmp = comparator(view);
  const nest = view.nested && view.subIssues;
  const children = new Map();
  if (nest) for (const t of shown) if (t.parent && ids.has(t.parent)) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
  const roots = nest ? shown.filter((t) => !(t.parent && ids.has(t.parent))) : shown;
  // A sub-issue can have sub-issues of its own: the tree goes all the way down.
  const build = (task) => ({ task, children: (children.get(task.id) ?? []).sort(cmp).map(build) });
  const rows = roots.map(build);
  const finish = (items) => items.sort((a, b) => cmp(a.task, b.task));
  return arrange(bucket(rows, view.grouping, view.empty ? known(view.grouping, states) : []), order, keepHidden).map(({ items, ...meta }) => {
    if (view.sub === "none") return { ...meta, count: size(items), rows: finish(items), subs: null };
    const subs = bucket(items, view.sub).map(({ items: inner, ...m }) => ({ ...m, count: size(inner), rows: finish(inner) }));
    return { ...meta, count: size(items), rows: [], subs };
  });
}

export function age(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}
