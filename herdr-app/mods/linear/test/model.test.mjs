import test from "node:test";
import assert from "node:assert/strict";
import { normalize, group, matches, counts, age, prepare, facets, hasFilter, DEFAULT_VIEW } from "../model.js";

const raw = (id, over = {}) => ({
  identifier: id, title: `Task ${id}`, url: `https://linear.app/x/issue/${id}`, branchName: id.toLowerCase(), priority: 2,
  updatedAt: "2026-11-01T00:00:00Z", state: { name: "In Progress", type: "started", color: "#f2c94c", position: 2 },
  team: { key: "POS" }, project: null, parent: null, children: { nodes: [] }, labels: { nodes: [] }, attachments: { nodes: [] }, ...over,
});
const task = (id, over) => normalize(raw(id, over));

test("normalize keeps only GitHub pull requests and counts finished sub-issues", () => {
  const t = task("POS-1", {
    attachments: { nodes: [
      { sourceType: "github", url: "https://github.com/a/b/pull/263", title: "x" },
      { sourceType: "github", url: "https://github.com/a/b/issues/9", title: "y" },
      { sourceType: "figma", url: "https://figma.com/f", title: "z" }] },
    children: { nodes: [{ state: { type: "completed" } }, { state: { type: "started" } }, { state: { type: "canceled" } }] },
  });
  assert.deepEqual(t.prs, [{ number: 263, url: "https://github.com/a/b/pull/263" }]);
  assert.deepEqual(t.kids, { total: 3, done: 2 });
});

test("group orders statuses working first and done last, then by Linear position", () => {
  const done = { name: "Done", type: "completed", color: "#0f0", position: 9 };
  const review = { name: "In Review", type: "started", color: "#fa0", position: 3 };
  const todo = { name: "Todo", type: "unstarted", color: "#ccc", position: 1 };
  const names = group([task("A-1", { state: done }), task("A-2", { state: todo }), task("A-3", { state: review }), task("A-4")]).map((g) => g.name);
  assert.deepEqual(names, ["In Progress", "In Review", "Todo", "Done"]);
});

test("a sub-issue nests under its parent only when the parent is listed", () => {
  const all = [task("P-1"), task("P-2", { parent: { identifier: "P-1" } }), task("P-3", { parent: { identifier: "P-99" } })];
  const [g] = group(all);
  assert.deepEqual(g.rows.map((r) => [r.task.id, r.children.map((c) => c.id)]).sort(), [["P-1", ["P-2"]], ["P-3", []]]);
  assert.equal(g.count, 3);
});

test("a filter that hides the parent promotes the sub-issue to a row of its own", () => {
  const all = [task("P-1", { title: "Catalog" }), task("P-2", { title: "Wizard", parent: { identifier: "P-1" } })];
  const [g] = group(all, { query: "wizard" });
  assert.deepEqual(g.rows.map((r) => r.task.id), ["P-2"]);
});

test("query matches id, title, project and label; chips match the status type", () => {
  const t = task("POS-7", { title: "Ticket lateral", project: { name: "POS V4", color: "#00f" }, labels: { nodes: [{ name: "bug", color: "#f00" }] } });
  for (const q of ["pos-7", "lateral", "pos v4", "bug"]) assert.ok(matches(t, q, "all"), q);
  assert.ok(!matches(t, "nope", "all"));
  assert.ok(matches(t, "", "working") && !matches(t, "", "todo"));
});

test("counts per chip", () => {
  const all = [task("A-1"), task("A-2", { state: { name: "Todo", type: "unstarted", color: "#ccc", position: 1 } })];
  assert.deepEqual(counts(all), { all: 2, working: 1, todo: 1, backlog: 0, done: 0 });
});

test("age uses the largest unit", () => {
  const now = Date.parse("2026-11-04T00:00:00Z");
  assert.equal(age("2026-11-03T23:30:00Z", now), "30m");
  assert.equal(age("2026-11-03T00:00:00Z", now), "1d");
  assert.equal(age("2026-10-07T00:00:00Z", now), "4w");
});

test("an unknown or duplicate status type sorts after the working ones and counts as done", () => {
  const dup = { name: "Duplicate", type: "duplicate", color: "#999", position: 5 };
  const odd = { name: "Mystery", type: "future", color: "#999", position: 1 };
  assert.deepEqual(group([task("A-1", { state: dup }), task("A-2", { state: odd }), task("A-3")]).map((g) => g.name), ["In Progress", "Duplicate", "Mystery"]);
  assert.equal(counts([task("A-1", { state: dup })]).done, 1);
});

const view = (over) => ({ ...DEFAULT_VIEW, ...over });
const names = (groups) => groups.map((g) => g.name);
const ids = (g) => g.rows.map((r) => r.task.id);

test("group by priority puts Urgent first and No priority last", () => {
  const all = [task("A-1", { priority: 0 }), task("A-2", { priority: 4 }), task("A-3", { priority: 1 })];
  assert.deepEqual(names(group(all, { view: view({ grouping: "priority" }) })), ["Urgent", "Low", "No priority"]);
});

test("group by project and by label; a task with two labels shows in both, none in No label", () => {
  const bug = { name: "bug", color: "#f00" }, ui = { name: "ui", color: "#00f" };
  const all = [task("A-1", { labels: { nodes: [bug, ui] } }), task("A-2", { labels: { nodes: [ui] } }), task("A-3")];
  const byLabel = group(all, { view: view({ grouping: "label" }) });
  assert.deepEqual(byLabel.map((g) => [g.name, g.count]), [["bug", 1], ["ui", 2], ["No label", 1]]);
  const byProject = group([task("A-1", { project: { name: "Zed", color: "#0f0" } }), task("A-2"), task("A-3", { project: { name: "Alpha", color: "#0f0" } })], { view: view({ grouping: "project" }) });
  assert.deepEqual(names(byProject), ["Alpha", "Zed", "No project"]);
});

test("no grouping gives one headerless group; sub-grouping splits each group", () => {
  const all = [task("A-1", { priority: 1 }), task("A-2", { priority: 3 })];
  const [flat] = group(all, { view: view({ grouping: "none" }) });
  assert.equal(flat.name, ""); assert.equal(flat.rows.length, 2);
  const [g] = group(all, { view: view({ sub: "priority" }) });
  assert.deepEqual(g.subs.map((s) => [s.name, s.count]), [["Urgent", 1], ["Medium", 1]]);
  assert.equal(g.count, 2);
});

test("ordering by title, due date (undated last) and reversed", () => {
  const all = [task("A-1", { title: "b", dueDate: "2026-12-01" }), task("A-2", { title: "a" }), task("A-3", { title: "c", dueDate: "2026-11-05" })];
  const order = (o) => ids(group(all, { view: view({ grouping: "none", ...o }) })[0]);
  assert.deepEqual(order({ order: "title" }), ["A-2", "A-1", "A-3"]);
  assert.deepEqual(order({ order: "due" }), ["A-3", "A-1", "A-2"]);
  assert.deepEqual(order({ order: "title", reverse: true }), ["A-3", "A-1", "A-2"]);
});

test("priority ordering ranks Urgent first and No priority last, ties by recency", () => {
  const all = [task("A-1", { priority: 0 }), task("A-2", { priority: 3, updatedAt: "2026-11-01T00:00:00Z" }), task("A-3", { priority: 3, updatedAt: "2026-11-02T00:00:00Z" }), task("A-4", { priority: 1 })];
  assert.deepEqual(ids(group(all, { view: view({ grouping: "none" }) })[0]), ["A-4", "A-3", "A-2", "A-1"]);
});

test("nested off lists sub-issues flat; showing sub-issues off hides them", () => {
  const all = [task("P-1"), task("P-2", { parent: { identifier: "P-1" } })];
  const flat = group(all, { view: view({ nested: false }) })[0];
  assert.deepEqual(flat.rows.map((r) => [r.task.id, r.children.length]).sort(), [["P-1", 0], ["P-2", 0]]);
  assert.deepEqual(prepare(all, view({ subIssues: false })).map((t) => t.id), ["P-1"]);
});

test("completed window: none hides finished tasks, week keeps only recent ones", () => {
  const done = { name: "Done", type: "completed", color: "#0f0", position: 9 };
  const now = Date.parse("2026-11-04T00:00:00Z");
  const all = [task("A-1"), task("A-2", { state: done, completedAt: "2026-11-02T00:00:00Z" }), task("A-3", { state: done, completedAt: "2026-09-20T00:00:00Z" })];
  const kept = (completed) => prepare(all, view({ completed }), undefined, now).map((t) => t.id);
  assert.deepEqual([kept("none"), kept("week"), kept("month")], [["A-1"], ["A-1", "A-2"], ["A-1", "A-2"]]);
});

test("triage can be hidden", () => {
  const triage = { name: "Triage", type: "triage", color: "#aaa", position: 0 };
  assert.deepEqual(prepare([task("A-1", { state: triage }), task("A-2")], view({ triage: false })).map((t) => t.id), ["A-2"]);
});

test("empty groups list every status of the workflow and every priority", () => {
  const states = [{ name: "Todo", type: "unstarted", color: "#ccc", position: 1 }, { name: "Todo", type: "unstarted", color: "#ccc", position: 3 }, { name: "Done", type: "completed", color: "#0f0", position: 2 }];
  const withEmpty = group([task("A-1")], { view: view({ empty: true }), states });
  assert.deepEqual(withEmpty.map((g) => [g.name, g.count]), [["In Progress", 1], ["Todo", 0], ["Done", 0]]);
  assert.equal(group([task("A-1")], { view: view({ grouping: "priority", empty: true }) }).length, 5);
  assert.equal(group([task("A-1")], { view: view() }).length, 1);
});

test("filters combine across fields and match any value within one", () => {
  const all = [task("A-1", { priority: 1, team: { key: "POS" } }), task("A-2", { priority: 2, team: { key: "AID" } }), task("A-3", { priority: 1, team: { key: "AID" } })];
  const pick = (f) => prepare(all, DEFAULT_VIEW, f).map((t) => t.id);
  assert.deepEqual(pick({ priority: [1] }), ["A-1", "A-3"]);
  assert.deepEqual(pick({ priority: [1], team: ["AID"] }), ["A-3"]);
  assert.deepEqual(pick({ priority: [1, 2] }), ["A-1", "A-2", "A-3"]);
  assert.ok(hasFilter({ team: ["AID"] }) && !hasFilter({}));
});

test("facets count each value; projects and assignees count None", () => {
  const all = [task("A-1", { project: { name: "P", color: "#0f0" }, assignee: { name: "Ana", displayName: "ana" } }), task("A-2", { priority: 1 }), task("A-3")];
  const f = facets(all.map((t) => t));
  assert.deepEqual(f.project.map((p) => [p.name, p.count]), [["(none)", 2], ["P", 1]]);
  assert.deepEqual(f.priority.map((p) => [p.label, p.count]), [["Urgent", 1], ["High", 2]]);
});
