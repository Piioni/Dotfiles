// Pure data shaping for the issues panel: no herdr, no network.

const TYPE_ORDER = ["started", "unstarted", "triage", "backlog", "completed", "canceled", "duplicate"];
const DAY = 86400000;
const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];

// A type Linear adds later sorts last instead of first.
const rank = (type) => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? TYPE_ORDER.length : i; };
export const isFinished = (type) => ["completed", "canceled", "duplicate"].includes(type);

export const CHIPS = {
  all: { label: "All statuses", types: null },
  working: { label: "Working", types: ["started"] },
  todo: { label: "Todo", types: ["unstarted", "triage"] },
  backlog: { label: "Backlog", types: ["backlog"] },
  done: { label: "Done", types: ["completed", "canceled", "duplicate"] },
};

export const GROUPINGS = { status: "Status", priority: "Priority", project: "Project", assignee: "Assignee", team: "Team", label: "Label", none: "No grouping" };
export const ORDERS = { priority: "Priority", updated: "Updated", created: "Created", due: "Due date", title: "Title" };
export const COMPLETED = { none: "None", week: "Past week", month: "Past month" };

export const DEFAULT_VIEW = {
  grouping: "status", sub: "none", order: "priority", reverse: false, completed: "month",
  subIssues: true, triage: true, nested: true, empty: false,
};
export const DEFAULT_FILTER = { priority: [], project: [], label: [], team: [], assignee: [] };
export const NONE = "(none)";

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
    assignee: n.assignee ? (n.assignee.displayName || n.assignee.name) : null,
    kids: { total: kids.length, done: kids.filter((k) => isFinished(k.state.type)).length },
    labels: n.labels?.nodes ?? [], prs,
  };
}

export function matches(task, query, chip) {
  const types = CHIPS[chip]?.types;
  if (types && !types.includes(task.state.type)) return false;
  const q = query.trim().toLowerCase();
  return !q || `${task.id} ${task.title} ${task.project?.name ?? ""} ${task.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(q);
}

export const counts = (tasks) => Object.fromEntries(Object.entries(CHIPS).map(([key, c]) =>
  [key, tasks.filter((t) => !c.types || c.types.includes(t.state.type)).length]));

export const hasFilter = (f) => Object.values({ ...DEFAULT_FILTER, ...f }).some((list) => list.length > 0);

function passes(t, f) {
  const has = (list, v) => !list.length || list.includes(v);
  return has(f.priority, t.priority) && has(f.team, t.team) && has(f.project, t.project?.name ?? NONE)
    && has(f.assignee, t.assignee ?? NONE) && (!f.label.length || t.labels.some((l) => f.label.includes(l.name)));
}

// What the display options and the filter leave of the tasks, before chips and the text query.
export function prepare(tasks, view = DEFAULT_VIEW, filter = DEFAULT_FILTER, now = Date.now()) {
  const f = { ...DEFAULT_FILTER, ...filter }, span = { none: 0, week: 7 * DAY, month: 30 * DAY }[view.completed] ?? 30 * DAY;
  return tasks.filter((t) => {
    if (isFinished(t.state.type) && (!span || now - Date.parse(t.completedAt ?? t.updatedAt) > span)) return false;
    if (!view.subIssues && t.parent) return false;
    if (!view.triage && t.state.type === "triage") return false;
    return passes(t, f);
  });
}

// The values a filter can pick, with how many tasks each has.
export function facets(tasks) {
  const tally = (pick) => {
    const m = new Map();
    for (const t of tasks) for (const v of pick(t)) m.set(v.name, { ...v, count: (m.get(v.name)?.count ?? 0) + 1 });
    return [...m.values()];
  };
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    priority: tally((t) => [{ name: String(t.priority), label: PRIORITIES[t.priority] }]).sort((a, b) => (+a.name || 5) - (+b.name || 5)),
    team: tally((t) => (t.team ? [{ name: t.team }] : [])).sort(byName),
    project: tally((t) => [{ name: t.project?.name ?? NONE, color: t.project?.color }]).sort(byName),
    assignee: tally((t) => [{ name: t.assignee ?? NONE }]).sort(byName),
    label: tally((t) => t.labels.map((l) => ({ name: l.name, color: l.color }))).sort(byName),
  };
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

const size = (rows) => rows.reduce((n, r) => n + 1 + r.children.length, 0);

// Groups of rows (and sub-groups when asked); a task whose parent is listed nests under it.
export function group(tasks, { query = "", chip = "all", view = DEFAULT_VIEW, states = [] } = {}) {
  const shown = tasks.filter((t) => matches(t, query, chip));
  const ids = new Set(shown.map((t) => t.id)), cmp = comparator(view);
  const nest = view.nested && view.subIssues;
  const children = new Map();
  if (nest) for (const t of shown) if (t.parent && ids.has(t.parent)) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
  const roots = nest ? shown.filter((t) => !(t.parent && ids.has(t.parent))) : shown;
  const rows = roots.map((task) => ({ task, children: (children.get(task.id) ?? []).sort(cmp) }));
  const finish = (items) => items.sort((a, b) => cmp(a.task, b.task));
  return bucket(rows, view.grouping, view.empty ? known(view.grouping, states) : []).map(({ items, ...meta }) => {
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
