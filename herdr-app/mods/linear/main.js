import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, layout, theme, notify, props, appHome, home, shared, setShared, openOverlay, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { readToken, viewer, fetchTasks, SCOPE_NAMES, LinearError } from "./api.js";
import {
  normalize, prepare, group, counts, facets, hasFilter, CHIPS, GROUPINGS, ORDERS, COMPLETED, DEFAULT_VIEW, DEFAULT_FILTER, age, isFinished,
} from "./model.js";
import { icons, icon, statusIcon, priorityIcon } from "./icons.js";

const REFRESH = 60000;
const DONE_ROWS = 5;
const SCOPE_LABEL = { assigned: "Assigned", created: "Created", subscribed: "Subscribed" };
// Popups take their height from the root element: a percentage of an unsized popup is zero.
const VIEW_HEIGHT = 405;
const FILTERS = [["priority", "Priority"], ["team", "Team"], ["project", "Project"], ["assignee", "Assignee"], ["label", "Label"]];
const SAVE_KEY = `input -s "Linear key: " | save -f ~/.config/linear/token; chmod 600 ~/.config/linear/token`;
const tokenPath = () => `${home()}/.config/linear/token`;
const cachePath = () => `${appHome()}/data/linear/cache.json`;

// What the display options and the filter hold, shared so the panel and its popups agree.
const VIEW = "issues.view", FILTER = "issues.filter", FACETS = "issues.facets";
const viewOf = () => ({ ...DEFAULT_VIEW, ...(shared(VIEW) ?? {}) });
const filterOf = () => ({ ...DEFAULT_FILTER, ...(shared(FILTER) ?? {}) });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

// Nothing to fetch while another panel (or none) is showing.
function hidden() {
  const root = layout(), body = find(root, "panel-body");
  return find(root, "panel")?.hidden || find(body, body?.active)?.content?.mod !== "linear";
}

const openUrl = (url) => exec("sh", ["-c", 'xdg-open "$1" >/dev/null 2>&1 &', "sh", url]).catch(() => exec("open", [url]).catch(() => null));
const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export default class Linear extends View {
  init(_props, cx) {
    const { menu, overlay, button } = props() ?? {};
    if (menu) {
      this.menu = menu; this.overlay = overlay; this.picking = null;
      return;
    }
    if (button) {
      // The tab bar restores each space's panel only if it's one of these.
      const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter((p) => p !== "tasks");
      if (!panels.includes("issues")) setShared("workspace.panels", [...panels, "issues"]);
      this.button = true;
      cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
      return;
    }
    this.scope = SCOPE_NAMES.includes(remembered("scope")) ? remembered("scope") : "assigned";
    this.chip = CHIPS[remembered("chip")] ? remembered("chip") : "all";
    this.collapsed = new Set(remembered("collapsed", []));
    this.more = new Set();
    this.query = "";
    this.data = {};
    this.states = [];
    this.me = remembered("me", null);
    this.input = InputState.new({ placeholder: "Filter issues" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => {
      await icons(); this.icons = true;
      const saved = await fs.readFile(cachePath(), "utf8").then(JSON.parse).catch(() => ({}));
      this.states = saved.states ?? [];
      for (const [scope, d] of Object.entries(saved.scopes ?? {})) this.data[scope] ??= d;
      this.publish(); cx.notify();
      await this.refresh(cx);
    });
    cx.timer.every(REFRESH, (cx) => { if (!hidden()) this.refresh(cx); });
  }

  // The filter popup lists what the current tasks have.
  publish() {
    const tasks = this.data[this.scope]?.tasks;
    if (!tasks) return;
    const next = facets(tasks);
    if (JSON.stringify(next) !== JSON.stringify(shared(FACETS))) setShared(FACETS, next);
  }

  async refresh(cx, scope = this.scope) {
    if (this.loading) return;
    this.loading = true; cx.notify();
    try {
      const token = await readToken(tokenPath());
      if (!this.me) { this.me = (await viewer(token)).id; keep("me", this.me); }
      const { tasks, states } = await fetchTasks(token, this.me, scope);
      this.data[scope] = { tasks: tasks.map(normalize), at: Date.now() };
      this.states = states;
      this.error = null;
      await fs.mkdir(`${appHome()}/data/linear`, { recursive: true });
      await fs.writeFile(cachePath(), JSON.stringify({ scopes: this.data, states }));
      if (scope === this.scope) this.publish();
    } catch (e) {
      this.error = e instanceof LinearError ? { kind: e.kind, message: e.message } : { kind: "net", message: "Couldn't reach Linear" };
    } finally {
      this.loading = false; cx.notify();
    }
  }

  setScope(scope, cx) {
    this.scope = scope; keep("scope", scope); this.more.clear(); this.publish();
    if (!this.data[scope] || Date.now() - this.data[scope].at > REFRESH) this.refresh(cx, scope);
    cx.notify();
  }

  toggle(key, cx) {
    this.collapsed.has(key) ? this.collapsed.delete(key) : this.collapsed.add(key);
    keep("collapsed", [...this.collapsed]); cx.notify();
  }

  toolbar(t) {
    const root = layout(), panel = find(root, "panel"), on = panel && !panel.hidden && find(root, "panel-body")?.active === "issues";
    return h_flex().size_full().pr(4).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-issues").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "issues" }); run("layout.show", { id: "panel" }); }
        })
        .child(div().size(14).when(this.icons, (e) => e.child(svg(icon("task")).size(14)))).child("Issues"));
  }

  segment(id, label, on, t, onClick) {
    return div().id(id).h(24).px(9).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.bg(on ? t.selected : t.hover)).on_click(onClick).child(label);
  }

  pill(id, t, color, ...kids) {
    return h_flex().id(id).h(18).px(6).gap(4).flex_none().items_center().rounded(9).border_1().border_color(t.border).text_size(11).text_color(color).children(kids);
  }

  row(task, t, nested) {
    const finished = isFinished(task.state.type);
    const meta = [];
    if (this.icons) meta.push(svg(priorityIcon(task.priority)).size(13).flex_none().text_color(task.priority === 1 ? t.ansi3 : t.dim));
    if (task.project) meta.push(h_flex().gap(4).items_center().min_w(0).max_w(130).text_size(11).text_color(t.muted)
      .child(div().size(7).flex_none().rounded(4).bg(task.project.color ?? t.dim)).child(div().truncate().child(task.project.name)));
    for (const l of task.labels.slice(0, 2)) meta.push(h_flex().gap(4).items_center().flex_none().text_size(11).text_color(t.muted)
      .child(div().size(6).flex_none().rounded(3).bg(l.color ?? t.dim)).child(l.name));
    if (task.kids.total > 0) meta.push(this.pill(`kids-${task.id}`, t, t.muted, `${task.kids.done}/${task.kids.total}`));
    for (const pr of task.prs.slice(0, 2)) meta.push(this.pill(`pr-${task.id}-${pr.number}`, t, t.ansi2,
      this.icons ? svg(icon("pull")).size(11) : "", `#${pr.number}`));
    return v_flex().id(`task-${task.id}`).flex_none().min_w(0).pl(nested ? 26 : 10).pr(10).py(6).gap(3).rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip("Click: open in Linear · Right click: copy branch name")
      .on_click(() => openUrl(task.url))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation(); cx.write_to_clipboard(task.branch);
        notify({ title: "Branch copied", body: task.branch, level: "success", timeout: 2500 });
      })
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(statusIcon(task.state.type)).size(14).text_color(task.state.color))))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(finished ? t.muted : t.foreground).child(task.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(task.id)))
      .child(h_flex().gap(8).pl(22).items_center().min_w(0).text_size(11).text_color(t.dim)
        .child(h_flex().gap(8).items_center().flex_1().min_w(0).overflow_hidden().children(meta))
        .child(div().flex_none().child(age(task.updatedAt))));
  }

  mark(g, t, size = 14) {
    if (g.icon === "status") return svg(statusIcon(g.type)).size(size).text_color(g.color);
    if (g.icon === "priority") return svg(priorityIcon(g.priority)).size(size).text_color(g.priority === 1 ? t.ansi3 : t.dim);
    return div().size(8).rounded(4).bg(g.color ?? t.dim);
  }

  header(id, g, closed, t, onClick, sub) {
    return h_flex().id(id).h(sub ? 26 : 30).flex_none().px(8).gap(8).items_center().rounded(7).bg(sub ? t.background : t.raised).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(div().size(12).flex_none().when(this.icons, (e) => e.child(svg(icon(closed ? "chev-r" : "chev-d")).size(12).text_color(t.dim))))
      .child(div().size(14).flex_none().flex().items_center().justify_center().when(this.icons, (e) => e.child(this.mark(g, t, sub ? 12 : 14))))
      .child(div().font_semibold().text_size(12).text_color(sub ? t.muted : t.foreground).child(g.name))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child(String(g.count)));
  }

  // Finished statuses show a few rows and a "Show more".
  rowsOf(rows, key, finished, t) {
    const limit = finished && !this.more.has(key) ? DONE_ROWS : Infinity;
    const list = rows.slice(0, limit).flatMap((r) => [this.row(r.task, t, false), ...r.children.map((c) => this.row(c, t, true))]);
    const left = rows.length - Math.min(rows.length, limit);
    return [...list, ...(left > 0 ? [div().id(`more-${key}`).flex_none().px(10).py(6).text_size(12).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.more.add(key); cx.notify(); }).child(`Show ${left} more`)] : [])];
  }

  groupView(g, view, t) {
    const key = `${view.grouping}|${g.key}`, finished = isFinished(g.type);
    if (view.grouping === "none") return v_flex().flex_none().gap(1).children(g.subs ? g.subs.flatMap((s) => this.subView(s, key, finished, t)) : this.rowsOf(g.rows, key, false, t));
    const closed = this.collapsed.has(key);
    return v_flex().flex_none().gap(1)
      .child(this.header(`group-${key}`, g, closed, t, (_e, cx) => this.toggle(key, cx), false))
      .children(closed ? [] : g.subs ? g.subs.flatMap((s) => this.subView(s, key, finished, t)) : this.rowsOf(g.rows, key, finished, t));
  }

  subView(s, parent, finished, t) {
    const key = `${parent}/${s.key}`, closed = this.collapsed.has(key);
    return [this.header(`sub-${key}`, s, closed, t, (_e, cx) => this.toggle(key, cx), true), ...(closed ? [] : this.rowsOf(s.rows, key, finished, t))];
  }

  notice(t, title, text, action) {
    return v_flex().flex_1().items_center().justify_center().gap(10).px(32)
      .child(div().size(28).when(this.icons, (e) => e.child(svg(icon("key")).size(28).text_color(t.dim))))
      .child(div().font_semibold().text_color(t.muted).child(title))
      .child(div().text_size(12).text_color(t.dim).text_center().child(text))
      .when(Boolean(action), (e) => e.child(action));
  }

  connect(t) {
    const copy = h_flex().id("linear-copy").h(26).px(10).items_center().rounded(6).border_1().border_color(t.border).text_size(12).text_color(t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.write_to_clipboard(SAVE_KEY); notify({ title: "Command copied", body: "Paste it in a nushell terminal", level: "success", timeout: 2500 }); })
      .child("Copy the command");
    const bad = this.error.kind === "auth";
    return this.notice(t, bad ? "Linear rejected the key" : "Connect Linear",
      bad ? "Create a new personal API key (Read) and save it again." : "Create a personal API key (Read) in Linear → Settings → Security & access, then save it with the command below in a nushell terminal.", copy);
  }

  iconButton(id, glyph, active, tip, onClick, t) {
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).border_1()
      .border_color(active ? t.accent : t.border).text_color(active ? t.accent : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(onClick)
      .when(this.icons, (e) => e.child(svg(icon(glyph)).size(14)));
  }

  // ---- popups: display options and filter ----

  // As tall as its sections need, up to what fits the window.
  filterHeight() {
    const facet = shared(FACETS) ?? {}, sections = FILTERS.filter(([k]) => facet[k]?.length);
    return Math.min(540, 70 + sections.length * 36 + sections.reduce((n, [k]) => n + facet[k].length * 28, 0));
  }

  setView(patch) { setShared(VIEW, { ...viewOf(), ...patch }); }

  select(key, label, options, t, extra = null) {
    const v = viewOf(), open = this.picking === key;
    return v_flex().flex_none().gap(2)
      .child(h_flex().h(32).gap(8).items_center()
        .child(div().flex_1().text_size(13).text_color(t.muted).child(label))
        .when(Boolean(extra), (e) => e.child(extra))
        .child(h_flex().id(`pick-${key}`).h(26).w(130).px(8).gap(6).items_center().rounded(6).bg(t.raised).border_1().border_color(open ? t.accent : t.border)
          .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.picking = open ? null : key; cx.notify(); })
          .child(div().flex_1().truncate().child(options[v[key]]))
          .child(div().text_size(9).text_color(t.dim).child(open ? "▲" : "▼"))))
      .when(open, (e) => e.child(v_flex().p(4).gap(1).rounded(6).bg(t.raised).border_1().border_color(t.border)
        .children(Object.entries(options).map(([k, l]) => h_flex().id(`opt-${key}-${k}`).h(26).px(8).gap(8).items_center().rounded(5).text_size(12).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.setView({ [key]: k }); this.picking = null; cx.notify(); })
          .child(div().w(12).text_color(t.accent).child(v[key] === k ? "✓" : "")).child(l)))));
  }

  switch(key, label, t) {
    const on = viewOf()[key];
    return h_flex().id(`switch-${key}`).h(32).flex_none().gap(8).items_center().cursor_pointer().on_click(() => this.setView({ [key]: !on }))
      .child(div().flex_1().text_size(13).text_color(t.muted).child(label))
      .child(h_flex().w(34).h(20).px(2).items_center().rounded(10).bg(on ? t.accent : t.border).when(on, (e) => e.justify_end())
        .child(div().size(16).rounded(8).bg("#ffffff")));
  }

  viewMenu(t) {
    const same = JSON.stringify(viewOf()) === JSON.stringify(DEFAULT_VIEW);
    const reverse = div().id("reverse").size(26).flex_none().flex().items_center().justify_center().rounded(6).border_1().border_color(viewOf().reverse ? t.accent : t.border)
      .text_color(viewOf().reverse ? t.accent : t.muted).text_size(13).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Reverse the order")
      .on_click(() => this.setView({ reverse: !viewOf().reverse })).child("⇅");
    return v_flex().id("issues-view").w_full().h(VIEW_HEIGHT).overflow_y_scrollbar().p(14).gap(2).bg(t.popover).text_color(t.foreground)
      .child(div().pb(6).text_size(12).text_color(t.dim).child("Display options"))
      .child(this.select("grouping", "Grouping", GROUPINGS, t))
      .child(this.select("sub", "Sub-grouping", GROUPINGS, t))
      .child(this.select("order", "Ordering", ORDERS, t, reverse))
      .child(div().flex_none().h(1).my(6).bg(t.border))
      .child(this.select("completed", "Completed issues", COMPLETED, t))
      .child(this.switch("subIssues", "Show sub-issues", t))
      .child(this.switch("triage", "Show triage issues", t))
      .child(div().flex_none().h(1).my(6).bg(t.border))
      .child(div().pb(4).text_size(12).text_color(t.dim).child("List options"))
      .child(this.switch("nested", "Nested sub-issues", t))
      .child(this.switch("empty", "Show empty groups", t))
      .child(div().id("reset-view").pt(10).text_size(12).text_color(same ? t.dim : t.accent).when(!same, (e) => e.cursor_pointer().hover((s) => s.underline()).on_click(() => setShared(VIEW, null)))
        .child("Reset to defaults"));
  }

  toggleFilter(field, value) {
    const f = filterOf(), list = f[field], next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    setShared(FILTER, { ...f, [field]: next });
  }

  filterMenu(t) {
    const f = filterOf(), facet = shared(FACETS) ?? {};
    const section = ([field, title]) => {
      const values = facet[field] ?? [];
      if (!values.length) return [];
      return [div().pt(10).pb(4).text_size(11).text_color(t.dim).child(title),
        ...values.map((v) => {
          const on = f[field].includes(field === "priority" ? Number(v.name) : v.name);
          const value = field === "priority" ? Number(v.name) : v.name;
          return h_flex().id(`flt-${field}-${v.name}`).h(28).px(6).gap(8).flex_none().items_center().rounded(6).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click(() => this.toggleFilter(field, value))
            .child(h_flex().size(16).flex_none().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.popover)
              .text_size(11).text_color("#ffffff").child(on ? "✓" : ""))
            .when(Boolean(v.color), (e) => e.child(div().size(8).flex_none().rounded(4).bg(v.color)))
            .child(div().flex_1().min_w(0).truncate().text_size(13).child(v.label ?? v.name))
            .child(div().text_size(11).text_color(t.dim).child(String(v.count)));
        })];
    };
    const any = hasFilter(f);
    return v_flex().id("issues-filter-menu").w_full().h(this.filterHeight()).overflow_y_scrollbar().p(14).gap(1).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(12).text_color(t.dim).child("Filter issues"))
        .child(div().id("clear-filter").text_size(12).text_color(any ? t.accent : t.dim).when(any, (e) => e.cursor_pointer().hover((s) => s.underline()).on_click(() => setShared(FILTER, null))).child("Clear")))
      .children(FILTERS.flatMap(section))
      .when(!Object.keys(facet).length, (e) => e.child(div().pt(10).text_size(12).text_color(t.muted).child("Loading…")));
  }

  render(cx) {
    const t = theme();
    if (this.menu === "view") return this.viewMenu(t);
    if (this.menu === "filter") return this.filterMenu(t);
    if (this.button) return this.toolbar(t);
    const shell = v_flex().id("linear").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    const entry = this.data[this.scope];
    if (!entry && this.error && ["token", "auth"].includes(this.error.kind)) return shell.child(this.connect(t));
    const view = viewOf(), filter = filterOf();
    const tasks = prepare(entry?.tasks ?? [], view, filter), c = counts(tasks);
    const groups = group(tasks, { query: this.query, chip: this.chip, view, states: this.states });
    const empty = !entry ? (this.error?.message ?? "Loading issues…") : this.query.trim() || hasFilter(filter) ? "No issues match" : "Nothing here";
    const custom = JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW);
    return shell
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(icon("task")).size(14).text_color(t.ansi2))))
        .child(div().font_semibold().child("Issues"))
        .child(div().flex_1().min_w(0).text_size(11).text_color(this.error ? t.ansi1 : t.dim).text_right().truncate()
          .child(this.error ? this.error.message : entry ? `Updated ${age(new Date(entry.at).toISOString())} ago` : ""))
        .child(h_flex().id("linear-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(7).border_1().border_color(t.border).text_size(12).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .child(this.loading
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12))))
          .child(this.loading ? "Syncing" : "Refresh")))
      .child(v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
            .children(SCOPE_NAMES.map((s) => this.segment(`scope-${s}`, SCOPE_LABEL[s], this.scope === s, t, (_e, cx) => this.setScope(s, cx)))))
          .child(div().flex_1())
          .child(this.iconButton("open-filter", "filter", hasFilter(filter), "Filter", () => openOverlay({ mod: "linear", kind: "popup", at: "pointer", width: 280, height: this.filterHeight(), props: { menu: "filter" } }), t))
          .child(this.iconButton("open-view", "sliders", custom, "Display options", () => openOverlay({ mod: "linear", kind: "popup", at: "pointer", width: 320, height: VIEW_HEIGHT, props: { menu: "view" } }), t)))
        .child(div().id("linear-filter").h(28).px(9).flex().items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(h_flex().gap(4).items_center().flex_wrap()
          .children(Object.entries(CHIPS).filter(([k]) => k === "all" || k === this.chip || c[k] > 0).map(([k, chip]) =>
            this.segment(`chip-${k}`, k === "all" ? chip.label : `${chip.label} ${c[k]}`, this.chip === k, t, (_e, cx) => { this.chip = k; keep("chip", k); cx.notify(); })))))
      .child(v_flex().id("linear-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
        .children(groups.map((g) => this.groupView(g, view, t)))
        .when(!groups.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
