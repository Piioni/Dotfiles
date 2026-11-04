// Pure data shaping for the Linear panel: no herdr, no network.

const TYPE_ORDER = ["started", "unstarted", "triage", "backlog", "completed", "canceled", "duplicate"];

export const CHIPS = {
  all: { label: "All statuses", types: null },
  working: { label: "Working", types: ["started"] },
  todo: { label: "Todo", types: ["unstarted", "triage"] },
  backlog: { label: "Backlog", types: ["backlog"] },
  done: { label: "Done", types: ["completed", "canceled", "duplicate"] },
};

const PULL = /\/pull\/(\d+)/;

// A type Linear adds later sorts last instead of first.
const rank = (type) => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? TYPE_ORDER.length : i; };
export const isFinished = (type) => ["completed", "canceled", "duplicate"].includes(type);

export function normalize(n) {
  const kids = n.children?.nodes ?? [];
  const prs = (n.attachments?.nodes ?? []).flatMap((a) => {
    const number = PULL.exec(a.url ?? "")?.[1];
    return a.sourceType === "github" && number ? [{ number: Number(number), url: a.url }] : [];
  });
  return {
    id: n.identifier, title: n.title, url: n.url, branch: n.branchName, priority: n.priority, updatedAt: n.updatedAt,
    state: { name: n.state.name, type: n.state.type, color: n.state.color, position: n.state.position },
    team: n.team?.key ?? "", project: n.project ?? null, parent: n.parent?.identifier ?? null,
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

// Status groups in Linear's order; a task whose parent is listed too nests under it.
export function group(tasks, query = "", chip = "all") {
  const shown = tasks.filter((t) => matches(t, query, chip));
  const ids = new Set(shown.map((t) => t.id));
  const children = new Map();
  for (const t of shown) if (t.parent && ids.has(t.parent)) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
  const byRecent = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const roots = shown.filter((t) => !(t.parent && ids.has(t.parent)));
  const groups = new Map();
  for (const t of roots) {
    const key = `${t.state.type}:${t.state.name}`;
    if (!groups.has(key)) groups.set(key, { key, name: t.state.name, type: t.state.type, color: t.state.color, position: t.state.position, count: 0, rows: [] });
    groups.get(key).rows.push({ task: t, children: (children.get(t.id) ?? []).sort(byRecent) });
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => byRecent(a.task, b.task));
    g.count = g.rows.reduce((n, r) => n + 1 + r.children.length, 0);
  }
  return [...groups.values()].sort((a, b) => rank(a.type) - rank(b.type) || a.position - b.position);
}

export function age(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}
