import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, layout, theme, notify, props, appHome, home, shared, setShared, openOverlay, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { readToken, viewer, fetchTasks, fetchViews, searchTasks, MINE, LinearError } from "./api.js";
import {
  normalize, prepare, group, groupMetas, moveKey, GROUPINGS, ORDERS, COMPLETED, DEFAULT_VIEW, fromPrefs, DEFAULT_ORDER, age, isFinished,
} from "./model.js";
import { icons, icon, statusIcon, statusName, priorityIcon } from "./icons.js";

const REFRESH = 60000;
const DONE_ROWS = 5;
const VIEWS_TTL = 10 * 60000;
// Popups take their height from the root element: a percentage of an unsized popup is zero.
const VIEW_HEIGHT = 405;
const SAVE_KEY = `input -s "Linear key: " | save -f ~/.config/linear/token; chmod 600 ~/.config/linear/token`;
const tokenPath = () => `${home()}/.config/linear/token`;
const cachePath = () => `${appHome()}/data/linear/cache.json`;

// What the display options hold, shared so the panel and its popups agree.
// SOURCE is what the panel lists: My issues or a saved view. VIEWS lists the saved views, BASE holds the display options the source was saved with.
const VIEW = "issues.view", ORDER = "issues.groupOrder", GROUPS = "issues.groups", SOURCE = "issues.source", VIEWS = "issues.views", BASE = "issues.base";
// The display options the person changed, kept per source so each view remembers its own.
const savedPrefs = () => remembered("prefs", {});
const baseOf = () => ({ ...DEFAULT_VIEW, ...(shared(BASE) ?? {}) });
const viewOf = () => ({ ...DEFAULT_VIEW, ...(shared(VIEW) ?? {}) });
// The order and hidden groups the person set, per way of grouping.
const orderOf = (grouping) => ({ ...DEFAULT_ORDER, ...((shared(ORDER) ?? {})[grouping] ?? {}) });

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
      this.menu = menu; this.overlay = overlay; this.picking = null; this.page = props().page ?? "main"; this.drag = null; this.over = null; this.landed = null;
      cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
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
    const last = remembered("scope", MINE);
    this.scope = typeof last === "string" && !["created", "subscribed"].includes(last) ? last : MINE;
    this.views = [];
    this.viewsAt = 0;
    setShared(SOURCE, this.scope);
    this.collapsed = new Set(remembered("collapsed", []));
    this.more = new Set();
    this.query = "";
    this.data = {};
    this.states = [];
    this.me = remembered("me", null);
    this.input = InputState.new({ placeholder: "Search" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.find(cx); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => {
      await icons(); this.icons = true;
      const saved = await fs.readFile(cachePath(), "utf8").then(JSON.parse).catch(() => ({}));
      this.states = saved.states ?? [];
      this.views = saved.views ?? [];
      setShared(VIEWS, this.views);
      this.activate(this.scope);
      for (const [scope, d] of Object.entries(saved.scopes ?? {})) this.data[scope] ??= d;
      cx.notify();
      await this.refresh(cx);
    });
    cx.timer.every(REFRESH, (cx) => { if (!hidden()) this.refresh(cx); });
  }

  // The ordering popup lists the groups the panel is showing; published after the render, only when they change.
  publishGroups(tasks, view, order, cx) {
    const next = { grouping: view.grouping, metas: groupMetas(tasks, { view, states: this.states, order }) };
    if (JSON.stringify(next) === JSON.stringify(shared(GROUPS))) return;
    cx.spawn(async () => { setShared(GROUPS, next); });
  }

  // Typing searches the whole workspace, so an issue that isn't yours is found too; until the answer arrives the cached ones are matched.
  find(cx) {
    const term = this.query.trim();
    if (!term) { this.found = null; this.looking = false; return; }
    if (this.found?.term === term) return;
    this.looking = true;
    cx.spawn(async (cx) => {
      await cx.sleep(300);
      if (this.query.trim() !== term) return;
      try {
        const tasks = (await searchTasks(await readToken(tokenPath()), term)).map(normalize);
        if (this.query.trim() === term) this.found = { term, tasks };
      } catch (e) {
        this.error = e instanceof LinearError ? { kind: e.kind, message: e.message } : { kind: "net", message: "Couldn't reach Linear" };
      }
      if (this.query.trim() === term) this.looking = false;
      cx.notify();
    });
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
      await this.loadViews(token);
      await fs.writeFile(cachePath(), JSON.stringify({ scopes: this.data, states, views: this.views }));
    } catch (e) {
      this.error = e instanceof LinearError ? { kind: e.kind, message: e.message } : { kind: "net", message: "Couldn't reach Linear" };
    } finally {
      this.loading = false; cx.notify();
    }
  }

  // The source's own display options, unless the person changed them.
  activate(source) {
    const view = this.views.find((v) => v.slug === source);
    const base = view ? fromPrefs(view.prefs) : DEFAULT_VIEW;
    setShared(SOURCE, source); setShared(BASE, base); setShared(VIEW, savedPrefs()[source] ?? base);
  }

  // The saved views change rarely; a failure leaves the ones already known.
  async loadViews(token) {
    if (this.views.length && Date.now() - this.viewsAt < VIEWS_TTL) return;
    try {
      this.views = await fetchViews(token, this.me);
      this.viewsAt = Date.now();
      setShared(VIEWS, this.views);
      if (this.scope !== MINE && !this.views.some((v) => v.slug === this.scope)) this.setScope(MINE, { notify() {} });
      else this.activate(this.scope);
    } catch {}
  }

  setScope(scope, cx) {
    if (scope === this.scope) return;
    this.scope = scope; keep("scope", scope); this.more.clear(); this.activate(scope);
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

  // A tab of the header: the active one is underlined with the accent.
  tab(id, t, on, onClick, ...kids) {
    return h_flex().id(id).h_full().px(8).gap(6).flex_none().items_center().text_size(13).cursor_pointer()
      .border_b(2).border_color(on ? t.accent : "#00000000").text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.text_color(t.foreground)).on_click(onClick).children(kids.filter(Boolean));
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

  iconButton(id, glyph, tip, onClick, t) {
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).border_1()
      .border_color(t.border).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(onClick)
      .when(this.icons, (e) => e.child(svg(icon(glyph)).size(14)));
  }

  // ---- popup: display options ----

  // Both the shared options and the per-source copy, so a restart keeps them.
  // As tall as its rows need, up to what fits the window.
  viewsHeight() {
    const list = shared(VIEWS) ?? [], mine = list.filter((v) => v.mine).length;
    return Math.min(480, 64 + list.length * 31 + (mine && list.length > mine ? 2 : 1) * 26);
  }

  viewsMenu(t) {
    const list = shared(VIEWS) ?? [], current = shared(SOURCE) ?? MINE;
    const row = (v) => {
      const on = v.slug === current;
      return h_flex().id(`view-${v.slug}`).h(30).px(8).gap(8).flex_none().items_center().rounded(7).cursor_pointer()
        .bg(on ? t.selected : t.popover).hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click(() => { setShared(SOURCE, v.slug); closeOverlay(this.overlay); })
        .child(div().size(8).flex_none().rounded(4).bg(v.color ?? t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(13).child(v.name))
        .when(!v.mine && v.owner, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(v.owner)))
        .when(on, (e) => e.child(this.glyph("check", 14, t.accent)));
    };
    const section = (title, items) => items.length ? [div().pt(8).pb(4).px(4).text_size(11).font_semibold().text_color(t.dim).child(title), ...items.map(row)] : [];
    const mine = list.filter((v) => v.mine), others = list.filter((v) => !v.mine);
    return v_flex().id("issues-views").w_full().h(this.viewsHeight()).overflow_y_scrollbar().px(10).py(10).gap(1).bg(t.popover).text_color(t.foreground)
      .child(div().px(4).pb(2).text_size(12).font_semibold().text_color(t.dim).child("Views"))
      .children([...section(others.length ? "Yours" : "", mine), ...section("Shared with you", others)])
      .when(!list.length, (e) => e.child(div().pt(10).px(4).text_size(12).text_color(t.muted).child("Loading…")));
  }

  setView(patch) { this.saveView({ ...viewOf(), ...patch }); }

  saveView(next) {
    setShared(VIEW, next);
    const source = shared(SOURCE) ?? MINE;
    if (JSON.stringify(next) === JSON.stringify(baseOf())) { const { [source]: _drop, ...rest } = savedPrefs(); keep("prefs", rest); }
    else keep("prefs", { ...savedPrefs(), [source]: next });
  }

  glyph(name, size, color) {
    return div().size(size).flex_none().flex().items_center().justify_center().when(this.icons, (e) => e.child(svg(icon(name)).size(size).text_color(color)));
  }

  title(text, t) { return div().pt(2).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text); }

  rule(t) { return div().flex_none().h(1).my(8).bg(t.border); }

  // A row: its label on the left, its control on the right.
  field(label, control, t, lead = null) {
    return h_flex().h(34).flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(label))
      .when(Boolean(lead), (e) => e.child(lead))
      .child(control);
  }

  select(key, label, options, t, lead = null) {
    const v = viewOf(), open = this.picking === key;
    return v_flex().flex_none().gap(4)
      .child(this.field(label,
        h_flex().id(`pick-${key}`).h(28).w(136).pl(10).pr(8).gap(6).items_center().rounded(8).bg(t.raised).border_1().border_color(open ? t.accent : t.border)
          .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.picking = open ? null : key; cx.notify(); })
          .child(div().flex_1().truncate().child(options[v[key]]))
          .child(this.glyph(open ? "chev-u" : "chev-d", 12, t.dim)), t, lead))
      .when(open, (e) => e.child(v_flex().p(4).gap(1).rounded(8).bg(t.raised).border_1().border_color(t.border)
        .children(Object.entries(options).map(([k, l]) => h_flex().id(`opt-${key}-${k}`).h(28).px(8).gap(8).items_center().rounded(6).text_size(12).cursor_pointer()
          .bg(v[key] === k ? t.selected : t.raised).hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.setView({ [key]: k }); this.picking = null; cx.notify(); })
          .child(div().flex_1().child(l))
          .child(this.glyph("check", 13, v[key] === k ? t.accent : "#00000000"))))));
  }

  switch(key, label, t) {
    const on = viewOf()[key];
    return h_flex().id(`switch-${key}`).h(34).flex_none().gap(8).items_center().cursor_pointer().on_click(() => this.setView({ [key]: !on }))
      .child(div().flex_1().text_size(13).text_color(t.foreground).child(label))
      .child(h_flex().w(36).h(20).px(2).items_center().rounded(10).border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.raised).when(on, (e) => e.justify_end())
        .child(div().size(14).rounded(7).bg(on ? "#ffffff" : t.dim)));
  }

  // The small square button beside a select.
  tool(id, glyph, tip, onClick, t) {
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(8).border_1().border_color(t.border)
      .bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tip).on_click(onClick)
      .child(this.glyph(glyph, 14, t.muted));
  }

  viewMenu(t) {
    if (this.page === "groups") return this.groupsMenu(t);
    const v = viewOf(), same = JSON.stringify(v) === JSON.stringify(baseOf()) && !Object.values(shared(ORDER) ?? {}).some(Boolean);
    return v_flex().id("issues-view").w_full().h(VIEW_HEIGHT).overflow_y_scrollbar().px(14).py(12).bg(t.popover).text_color(t.foreground)
      .child(this.title("Display options", t))
      .child(this.select("grouping", "Grouping", GROUPINGS, t, v.grouping === "none" ? null
        : this.tool("group-order", "swap", "Group ordering", (_e, cx) => { this.page = "groups"; this.picking = null; cx.notify(); }, t)))
      .child(this.select("sub", "Sub-grouping", GROUPINGS, t))
      .child(this.select("order", "Ordering", ORDERS, t, this.tool("reverse", "swap", "Reverse the order", () => this.setView({ reverse: !v.reverse }), t)))
      .child(this.rule(t))
      .child(this.select("completed", "Completed issues", COMPLETED, t))
      .child(this.switch("subIssues", "Show sub-issues", t))
      .child(this.switch("triage", "Show triage issues", t))
      .child(this.rule(t))
      .child(this.title("List options", t))
      .child(this.switch("nested", "Nested sub-issues", t))
      .child(this.switch("empty", "Show empty groups", t))
      .child(div().flex_1())
      .child(div().id("reset-view").mt(10).h(28).flex_none().flex().items_center().justify_center().rounded(8).text_size(12)
        .text_color(same ? t.dim : t.foreground).border_1().border_color(t.border)
        .when(!same, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => { this.saveView(baseOf()); setShared(ORDER, null); }))
        .child("Reset to defaults"));
  }

  // ---- group ordering: drag a row onto another, or use the arrows; the eye hides a group ----

  saveOrder(keys, hidden) {
    const grouping = viewOf().grouping;
    setShared(ORDER, { ...(shared(ORDER) ?? {}), [grouping]: { order: keys, hidden } });
  }

  groupsMenu(t) {
    const grouping = viewOf().grouping, metas = (shared(GROUPS)?.grouping === grouping ? shared(GROUPS).metas : []) ?? [];
    const keys = metas.map((m) => m.key), hidden = metas.filter((m) => m.hidden).map((m) => m.key);
    const dragging = this.drag ? metas.find((m) => m.key === this.drag) : null, from = dragging ? keys.indexOf(this.drag) : -1;
    const drop = (cx) => { this.drag = null; this.over = null; cx.notify(); };
    // The moved row dips and comes back, so the eye follows where it went.
    const move = (key, target, cx) => {
      this.saveOrder(moveKey(keys, key, target), hidden);
      this.landed = key; cx.notify();
      cx.spawn(async (cx) => { await cx.sleep(280); this.landed = null; cx.notify(); });
    };
    const row = (m, i) => {
      const lifted = this.drag === m.key, target = Boolean(dragging) && !lifted && this.over === m.key;
      const mark = m.icon === "status" ? this.glyph(statusName(m.type), 16, m.color)
        : m.icon === "priority" ? this.glyph(`p${m.priority}`, 16, m.priority === 1 ? t.ansi3 : t.dim)
        : div().size(10).flex_none().rounded(5).bg(m.color ?? t.dim);
      const arrow = (id, glyph, enabled, by) => div().id(`${id}-${m.key}`).size(22).flex_none().flex().items_center().justify_center().rounded(5)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => move(m.key, keys[i + by], cx)))
        .child(this.glyph(glyph, 13, enabled ? t.muted : "#00000000"));
      // Dropping on a row puts the dragged one in its place: the bar shows which edge it lands on.
      const bar = (on) => div().flex_none().h(2).mx(10).rounded(1).bg(on ? t.foreground : "#00000000");
      const above = target && from > i, below = target && from < i;
      return v_flex().flex_none()
        .child(bar(above))
        .child(h_flex().id(`grp-${m.key}`).h(34).flex_none().px(8).gap(10).items_center().rounded(8).cursor_grab()
          .bg(lifted ? t.selected : target ? t.hover : t.popover).border_1().border_color(lifted ? t.dim : "#00000000")
          .opacity(lifted ? 0.55 : this.landed === m.key ? 0.3 : 1).transition("opacity", { duration: 240, easing: "ease-out" })
          .hover((s) => s.bg(lifted ? t.selected : t.hover))
          .on_hover((over, cx) => {
            if (!this.drag) return;
            if (over) this.over = m.key; else if (this.over === m.key) this.over = null;
            cx.notify();
          })
          .on_mouse_down("left", (_e, cx) => { this.drag = m.key; cx.notify(); })
          .on_mouse_up("left", (_e, cx) => { const was = this.drag; drop(cx); if (was && was !== m.key) move(was, m.key, cx); })
          .child(this.glyph("grip", 14, lifted || target ? t.foreground : t.dim))
          .child(mark)
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(m.hidden ? t.dim : t.foreground).child(m.name))
          .child(arrow("up", "chev-u", i > 0, -1)).child(arrow("down", "chev-d", i < keys.length - 1, 1))
          .child(div().id(`eye-${m.key}`).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.raised))
            .tooltip(m.hidden ? "Show this group" : "Hide this group")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click(() => this.saveOrder(keys, m.hidden ? hidden.filter((k) => k !== m.key) : [...hidden, m.key]))
            .child(this.glyph(m.hidden ? "eye-off" : "eye", 15, m.hidden ? t.dim : t.foreground))))
        .child(bar(below));
    };
    const custom = Boolean((shared(ORDER) ?? {})[grouping]);
    return v_flex().id("issues-groups").w_full().h(VIEW_HEIGHT).bg(t.popover).text_color(t.foreground)
      .when(Boolean(dragging), (e) => e.cursor_grabbing())
      .on_mouse_up("left", (_e, cx) => drop(cx))
      .child(h_flex().h(46).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("groups-back").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.page = "main"; this.drag = null; this.over = null; cx.notify(); }).child(this.glyph("back", 15, t.muted)))
        .child(div().flex_1().text_size(13).font_semibold().child(`Group ordering · ${GROUPINGS[grouping]}`))
        .when(custom, (e) => e.child(div().id("groups-reset").text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground).underline())
          .on_click(() => setShared(ORDER, { ...(shared(ORDER) ?? {}), [grouping]: null })).child("Reset"))))
      .child(v_flex().id("groups-list").flex_1().min_h(0).overflow_y_scrollbar().p(8)
        .children(metas.map(row))
        .when(!metas.length, (e) => e.child(div().p(12).text_size(12).text_color(t.muted).child("Nothing to order yet"))))
      .child(h_flex().flex_none().h(34).px(14).gap(6).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(dragging
          ? h_flex().gap(4).child("Moving").child(div().font_semibold().text_color(t.foreground).child(dragging.name)).child("· release over a row")
          : "Drag a row onto another, or use the arrows. The eye hides a group."));
  }

  render(cx) {
    const t = theme();
    if (this.menu === "view") return this.viewMenu(t);
    if (this.menu === "views") return this.viewsMenu(t);
    if (this.button) return this.toolbar(t);
    const shell = v_flex().id("linear").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    const wanted = shared(SOURCE) ?? this.scope;
    if (wanted !== this.scope) cx.spawn(async (cx) => this.setScope(wanted, cx));
    const entry = this.data[this.scope];
    if (!entry && this.error && ["token", "auth"].includes(this.error.kind)) return shell.child(this.connect(t));
    const view = viewOf();
    const term = this.query.trim(), order = orderOf(view.grouping), current = this.views.find((v) => v.slug === this.scope);
    let groups;
    if (term) {
      const answer = this.found?.term === term ? this.found.tasks : null;
      const cached = [...new Map(Object.values(this.data).flatMap((d) => d.tasks).map((t) => [t.id, t])).values()];
      groups = group(answer ?? cached, { query: answer ? "" : term, view, states: this.states, order: { ...order, hidden: [] } });
    } else {
      const tasks = prepare(entry?.tasks ?? [], view);
      groups = group(tasks, { view, states: this.states, order });
      this.publishGroups(tasks, view, order, cx);
    }
    const empty = !entry ? (this.error?.message ?? "Loading issues…") : term ? (this.looking ? "Searching…" : "No issues match") : "Nothing here";
    return shell
      .child(h_flex().h(42).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
        .child(h_flex().h_full().flex_none().min_w(0).gap(2)
          .child(this.tab("source-mine", t, this.scope === MINE, () => setShared(SOURCE, MINE), "My issues"))
          .child(this.tab("source-views", t, Boolean(current), () => openOverlay({ mod: "linear", kind: "popup", at: "pointer", width: 300, height: this.viewsHeight(), props: { menu: "views" } }),
            current ? div().size(8).flex_none().rounded(4).bg(current.color ?? t.dim) : null,
            div().min_w(0).max_w(130).truncate().child(current ? current.name : "Views"),
            div().size(12).flex_none().when(this.icons, (e) => e.child(svg(icon("chev-d")).size(12))))))
        .child(div().flex_1())
        .child(div().id("linear-filter").w(120).min_w(60).h(28).px(9).flex().items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("linear-refresh").size(28).flex_none().flex().items_center().justify_center().rounded(7).border_1().border_color(t.border).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .tooltip(entry ? `Refresh · updated ${age(new Date(entry.at).toISOString())} ago` : "Refresh")
          .child(this.loading || this.looking
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12)))))
        .child(this.iconButton("open-view", "sliders", "Display options", () => openOverlay({ mod: "linear", kind: "popup", at: "pointer", width: 320, height: VIEW_HEIGHT, props: { menu: "view" } }), t)))
      .when(this.error && entry, (e) => e.child(div().flex_none().px(14).py(6).text_size(11).text_color(t.ansi1).border_b(1).border_color(t.border).truncate().child(this.error.message)))
      .child(v_flex().id("linear-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
        .children(groups.map((g) => this.groupView(g, view, t)))
        .when(!groups.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
