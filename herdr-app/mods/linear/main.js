import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, layout, theme, notify, props, appHome, home, shared, setShared } from "herdr";
import * as fs from "fs/promises";
import { readToken, viewer, fetchTasks, SCOPE_NAMES, LinearError } from "./api.js";
import { normalize, group, counts, CHIPS, age, isFinished } from "./model.js";
import { icons, icon, statusIcon, priorityIcon } from "./icons.js";

const REFRESH = 60000;
const DONE_ROWS = 5;
const SCOPE_LABEL = { assigned: "Assigned", created: "Created", subscribed: "Subscribed" };
const SAVE_KEY = `input -s "Linear key: " | save -f ~/.config/linear/token; chmod 600 ~/.config/linear/token`;
const tokenPath = () => `${home()}/.config/linear/token`;
const cachePath = () => `${appHome()}/data/linear/cache.json`;

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
    if (props()?.button) {
      // The tab bar restores each space's panel only if it's one of these.
      const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter((p) => p !== "issues");
      if (!panels.includes("tasks")) setShared("workspace.panels", [...panels, "tasks"]);
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
    this.me = remembered("me", null);
    this.input = InputState.new({ placeholder: "Filter tasks" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => {
      await icons(); this.icons = true;
      const saved = await fs.readFile(cachePath(), "utf8").then(JSON.parse).catch(() => ({}));
      for (const [scope, d] of Object.entries(saved)) this.data[scope] ??= d;
      cx.notify();
      await this.refresh(cx);
    });
    cx.timer.every(REFRESH, (cx) => { if (!hidden()) this.refresh(cx); });
  }

  async refresh(cx, scope = this.scope) {
    if (this.loading) return;
    this.loading = true; cx.notify();
    try {
      const token = await readToken(tokenPath());
      if (!this.me) { this.me = (await viewer(token)).id; keep("me", this.me); }
      const tasks = (await fetchTasks(token, this.me, scope)).map(normalize);
      this.data[scope] = { tasks, at: Date.now() };
      this.error = null;
      await fs.mkdir(`${appHome()}/data/linear`, { recursive: true });
      await fs.writeFile(cachePath(), JSON.stringify(this.data));
    } catch (e) {
      this.error = e instanceof LinearError ? { kind: e.kind, message: e.message } : { kind: "net", message: "Couldn't reach Linear" };
    } finally {
      this.loading = false; cx.notify();
    }
  }

  setScope(scope, cx) {
    this.scope = scope; keep("scope", scope); this.more.clear();
    if (!this.data[scope] || Date.now() - this.data[scope].at > REFRESH) this.refresh(cx, scope);
    cx.notify();
  }

  toggle(key, cx) {
    this.collapsed.has(key) ? this.collapsed.delete(key) : this.collapsed.add(key);
    keep("collapsed", [...this.collapsed]); cx.notify();
  }

  toolbar(t) {
    const root = layout(), panel = find(root, "panel"), on = panel && !panel.hidden && find(root, "panel-body")?.active === "tasks";
    return h_flex().size_full().pr(4).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-tasks").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "tasks" }); run("layout.show", { id: "panel" }); }
        })
        .child(div().size(14).when(this.icons, (e) => e.child(svg(icon("task")).size(14)))).child("Tasks"));
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

  groupView(g, t) {
    const closed = this.collapsed.has(g.key), finished = isFinished(g.type);
    const limit = finished && !this.more.has(g.key) ? DONE_ROWS : Infinity;
    const rows = closed ? [] : g.rows.slice(0, limit).flatMap((r) => [this.row(r.task, t, false), ...r.children.map((c) => this.row(c, t, true))]);
    const hidden = closed ? 0 : g.rows.length - Math.min(g.rows.length, limit);
    return v_flex().flex_none().gap(1)
      .child(h_flex().id(`group-${g.key}`).h(30).flex_none().px(8).gap(8).items_center().rounded(7).bg(t.raised).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(g.key, cx))
        .child(div().size(12).flex_none().when(this.icons, (e) => e.child(svg(icon(closed ? "chev-r" : "chev-d")).size(12).text_color(t.dim))))
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(statusIcon(g.type)).size(14).text_color(g.color))))
        .child(div().font_semibold().text_size(12).child(g.name))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(String(g.count))))
      .children(rows)
      .when(hidden > 0, (e) => e.child(div().id(`more-${g.key}`).flex_none().px(10).py(6).text_size(12).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.more.add(g.key); cx.notify(); }).child(`Show ${hidden} more`)));
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

  render(cx) {
    const t = theme();
    if (this.button) return this.toolbar(t);
    const shell = v_flex().id("linear").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    const entry = this.data[this.scope];
    if (!entry && this.error && ["token", "auth"].includes(this.error.kind)) return shell.child(this.connect(t));
    const tasks = entry?.tasks ?? [], c = counts(tasks), groups = group(tasks, this.query, this.chip);
    const empty = !entry ? (this.error?.message ?? "Loading tasks…") : this.query.trim() ? "No tasks match" : "Nothing here";
    return shell
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(icon("task")).size(14).text_color(t.ansi2))))
        .child(div().font_semibold().child("Tasks"))
        .child(div().flex_1().min_w(0).text_size(11).text_color(this.error ? t.ansi1 : t.dim).text_right().truncate()
          .child(this.error ? this.error.message : entry ? `Updated ${age(new Date(entry.at).toISOString())} ago` : ""))
        .child(h_flex().id("linear-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(7).border_1().border_color(t.border).text_size(12).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .child(this.loading
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12))))
          .child(this.loading ? "Syncing" : "Refresh")))
      .child(v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
          .children(SCOPE_NAMES.map((s) => this.segment(`scope-${s}`, SCOPE_LABEL[s], this.scope === s, t, (_e, cx) => this.setScope(s, cx)))))
        .child(div().id("linear-filter").h(28).px(9).flex().items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(h_flex().gap(4).items_center().flex_wrap()
          .children(Object.entries(CHIPS).filter(([k]) => k === "all" || k === this.chip || c[k] > 0).map(([k, chip]) =>
            this.segment(`chip-${k}`, k === "all" ? chip.label : `${chip.label} ${c[k]}`, this.chip === k, t, (_e, cx) => { this.chip = k; keep("chip", k); cx.notify(); })))))
      .child(v_flex().id("linear-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
        .children(groups.map((g) => this.groupView(g, t)))
        .when(!groups.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
