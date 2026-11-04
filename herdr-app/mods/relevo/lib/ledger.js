const DAY = 86400;

// Worked time per ticket (or repo without one) between since and until; parallel stretches on one ticket count once.
export function totals(rows, since, until = Infinity, min = 60) {
  const spans = {};
  for (const r of rows) {
    const a = Math.max(r.start, since), b = Math.min(r.end, until);
    if (b <= a) continue;
    const key = r.jira ?? r.repo;
    (spans[key] ??= { key, repo: r.repo, jira: r.jira, list: [] }).list.push([a, b]);
  }
  return Object.values(spans).map((s) => {
    let total = 0, edge = 0;
    for (const [a, b] of s.list.sort((x, y) => x[0] - y[0])) {
      if (b > edge) {
        total += b - Math.max(a, edge);
        edge = b;
      }
    }
    return { key: s.key, repo: s.repo, jira: s.jira, seconds: total };
  }).filter((s) => s.seconds >= min).sort((a, b) => b.seconds - a.seconds);
}

// Monday 00:00 local, `offset` weeks from the one holding `now` (seconds).
export function weekStart(now, offset = 0) {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d.getTime() / 1000;
}

// One row per ticket with its seconds on each of the seven days, newest-heavy first.
export function week(rows, start) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start * 1000);
    d.setDate(d.getDate() + i);
    return d.getTime() / 1000;
  });
  const byKey = {};
  days.forEach((from, i) => {
    const to = i < 6 ? days[i + 1] : from + DAY;
    for (const s of totals(rows, from, to, 0)) {
      (byKey[s.key] ??= { key: s.key, repo: s.repo, jira: s.jira, days: Array(7).fill(0), total: 0 }).days[i] = s.seconds;
      byKey[s.key].total += s.seconds;
    }
  });
  const list = Object.values(byKey).filter((r) => r.total >= 60).sort((a, b) => b.total - a.total);
  const dayTotals = days.map((_, i) => list.reduce((n, r) => n + r.days[i], 0));
  return { days, rows: list, dayTotals, total: dayTotals.reduce((n, s) => n + s, 0) };
}

// Tab-separated, so it pastes as a table into Jira or a spreadsheet.
export function weekTable(w, label, format) {
  const cell = (s) => (s >= 60 ? format(s) : "");
  const lines = [["Ticket", "Repo", ...w.days.map(label), "Total"].join("\t")];
  for (const r of w.rows) lines.push([r.jira ?? "", r.repo ?? "", ...r.days.map(cell), format(r.total)].join("\t"));
  lines.push(["Total", "", ...w.dayTotals.map(cell), format(w.total)].join("\t"));
  return lines.join("\n");
}
