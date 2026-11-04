import test from "node:test";
import assert from "node:assert/strict";
import { normalize, group, matches, counts, age } from "../model.js";

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
  const [g] = group(all, "wizard");
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
