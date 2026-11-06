// Project tasks. The Tasks button in the tab bar opens this: every script in <repo>/.tasks/ is a task.
// A subfolder is a group; a script may set its name with a `# name: dev` header line,
// and "Name · detail" shows the detail muted after the name.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { exec, run, terminals, panes, focused, spaces, theme, props, openOverlay, closeOverlay } from "herdr";

const LABEL = "herdr.task";
// The shell stays open after a task ends, so the task labels its own terminal while it runs
// and clears the label when it exits. `trap : INT` lets Ctrl+C stop the script but not the cleanup.
const WRAP = 'hc label "$HC_TERMINAL_ID" "herdr.task=$2" >/dev/null; trap : INT; bash "$1"; c=$?; hc label "$HC_TERMINAL_ID" herdr.task= >/dev/null; exit $c';
// Groups listed here come first, in this order; other groups follow by name, loose scripts last.
const ORDER = ["backoffice", "pos", "tests"];
const LOOSE = "General";
const WIDTH = 296;
const ICON = "mods/tasks";

// The scripts of one folder. `group` is the subfolder's name ("" for loose scripts).
async function scripts(dir, group, root) {
  let files;
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sh")).sort(); } catch { return []; }
  const tasks = [];
  for (const f of files) {
    const path = `${dir}/${f}`, file = group ? `${group}/${f}` : f;
    try {
      const head = (await fs.readFile(path, "utf8")).split("\n").slice(0, 8);
      const name = (head.map((l) => l.match(/^#\s*name:\s*(.+)$/i)?.[1]).find(Boolean) ?? f.replace(/\.sh$/, "")).trim();
      const [title, ...rest] = name.split(" · ");
      tasks.push({ file, name, title, detail: rest.join(" · "), label: group ? `${group} · ${name}` : name, path, key: `${root}:${file}` });
    } catch {}
  }
  return tasks;
}

const rank = (name) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);

// .tasks is git-ignored, so a worktree doesn't have one: fall back to the main checkout's.
async function discover(cwd) {
  const git = async (...args) => {
    const r = await exec("git", args, { cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const root = await git("rev-parse", "--show-toplevel");
  if (!root) return null;
  const common = await git("rev-parse", "--path-format=absolute", "--git-common-dir");
  const main = common ? common.replace(/\/\.git\/?$/, "") : root;
  for (const base of [root, main]) {
    const dir = `${base}/.tasks`;
    let entries;
    try { entries = (await fs.readdir(dir)).filter((f) => !f.startsWith(".") && !f.endsWith(".sh")); } catch { continue; }
    entries.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const groups = [];
    for (const e of entries) {
      const tasks = await scripts(`${dir}/${e}`, e, root);
      if (tasks.length) groups.push({ name: e, tasks });
    }
    const loose = await scripts(dir, "", root);
    if (loose.length) groups.push({ name: LOOSE, tasks: loose });
    return { root, groups };
  }
  return { root, groups: [] };
}

// Display only: first letter up.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A theme color with alpha, when it is a plain #rrggbb.
const faint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);

export default class Tasks extends View {
  init(_props, cx) {
    // In the tab bar's right-hand strip the mod is only the button that opens this popup.
    if (props()?.button) { this.button = true; return; }
    this.found = undefined;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = spaces().find((p) => p.active);
    this.remote = Boolean(space?.machine);
    cx.spawn(async (cx) => {
      try { this.found = this.remote ? null : await discover(focused()?.cwd ?? space?.folder); }
      catch (e) { this.found = null; this.error = String(e); }
      cx.notify();
    });
  }

  running(task) {
    return terminals().find((x) => x.state === "live" && x.labels?.[LABEL] === task.key);
  }

  start(task) {
    const space = spaces().find((p) => p.active);
    run("tab.new", { name: task.label, space: space?.id, folder: this.found.root, argv: ["bash", "-c", WRAP, "task", task.path, task.key] });
  }

  go(term) {
    const pane = panes().find((p) => p.terminal === term.address);
    closeOverlay(props().overlay);
    if (pane) run("tab.select", { id: pane.tab });
  }

  // Running: go to its tab. Otherwise: start it in a new tab.
  pick(task) {
    const live = this.running(task);
    if (live) return this.go(live);
    closeOverlay(props().overlay);
    this.start(task);
  }

  toolbar(t) {
    const busy = terminals().some((x) => x.state === "live" && x.labels?.[LABEL]);
    return h_flex().size_full().px(4).items_center().justify_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("tasks-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => openOverlay({ mod: "tasks", kind: "popup", width: WIDTH }))
        .child(busy ? svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(900) : svg(`${ICON}/play.svg`).size(14))
        .child("Tasks"));
  }

  render() {
    const t = theme();
    if (this.button) return this.toolbar(t);
    const groups = this.found?.groups ?? [];
    const all = groups.flatMap((g) => g.tasks);
    this.at = Math.max(0, Math.min(this.at, all.length - 1));
    const selected = all[this.at];
    const busy = all.filter((task) => this.running(task)).length;

    const stop = (_e, cx) => cx.stop_propagation();
    const key = (k) => div().px(5).h(16).flex().items_center().rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(k);
    const control = (id, icon, tip, color, action) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover((s) => s.bg(t.raised).text_color(color)).tooltip(tip)
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(`${ICON}/${icon}.svg`).size(13));

    // The pointer moves the selection, so the right-hand hint always says what a click does.
    const row = (task, index) => {
      const live = this.running(task);
      const id = task.file.replace(/[^\w-]/g, "-");
      const on = index === this.at;
      return h_flex().id(`task-${id}`).h(30).px(10).gap(10).rounded(7).items_center().flex_none().cursor_pointer()
        .bg(live ? faint(t.accent, on ? "3d" : "26") : on ? t.hover : "#00000000")
        .on_hover((hovered, cx) => { if (hovered && this.at !== index) { this.at = index; cx.notify(); } })
        .on_click(() => this.pick(task))
        .child(div().size(14).flex_none().flex().items_center().justify_center().child(live
          ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900)
          : svg(`${ICON}/play.svg`).size(11).text_color(on ? t.accent : t.dim)))
        .child(h_flex().flex_1().min_w(0).gap(7).items_baseline()
          .child(div().flex_none().text_size(13).text_color(t.foreground).when(Boolean(live), (d) => d.font_medium()).child(cap(task.title)))
          .when(Boolean(task.detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(task.detail))))
        .when(Boolean(live), (el) => el
          .child(control(`restart-${id}`, "restart", "Restart", t.foreground, (cx) => {
            run("terminal.kill", { terminal: live.address });
            cx.timer.after(500, () => this.start(task));
          }))
          .child(control(`stop-${id}`, "stop", "Stop", t.blocked, () => run("terminal.kill", { terminal: live.address }))))
        .when(!live && on, (el) => el.child(key("↵")));
    };

    const header = (g, first) => {
      const n = g.tasks.filter((task) => this.running(task)).length;
      return h_flex().h(first ? 22 : 30).px(10).pb(3).items_end().flex_none()
        .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.muted).child(g.name.toUpperCase()))
        .when(n > 0, (el) => el.child(div().text_size(10.5).font_medium().text_color(t.accent).child(`${n} running`)));
    };

    const note = (title, body) => v_flex().px(10).py(16).gap(4).items_center()
      .child(div().text_size(13).text_color(t.muted).child(title))
      .when(Boolean(body), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(body)));

    let content;
    if (this.remote) content = note("Tasks run on this computer only.");
    else if (this.found === undefined) content = note("Loading tasks…");
    else if (this.found === null) content = note(this.error ?? "Not inside a git repository.");
    else if (!all.length) content = note("No tasks in this repo yet", "Add scripts to .tasks/*.sh or .tasks/<group>/*.sh");
    else {
      let n = 0;
      content = v_flex().max_h(560).overflow_y_scrollbar().gap(1).children(groups.flatMap((g, i) => [
        header(g, i === 0),
        ...g.tasks.map((task) => row(task, n++)),
      ]));
    }

    const repo = this.found?.root.split("/").pop();

    return v_flex().id("tasks").track_focus(this.handle).w_full().bg(t.popover).p(6).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (!all.length) return;
        if (e.key === "down") this.at = (this.at + 1) % all.length;
        else if (e.key === "up") this.at = (this.at + all.length - 1) % all.length;
        else if (e.key === "enter") return this.pick(selected);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).px(10).gap(8).items_center().flex_none()
        .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child("Tasks"))
        .when(busy > 0, (el) => el.child(h_flex().h(20).px(8).gap(5).items_center().rounded(10).bg(faint(t.accent, "26"))
          .text_size(11).font_medium().text_color(t.accent)
          .child(div().size(6).rounded(3).bg(t.accent))
          .child(`${busy} running`)))
        .child(h_flex().flex_1().min_w(0).justify_end()
          .child(div().truncate().text_size(12).text_color(t.dim).child(cap(repo ?? "")))))
      .child(div().h(1).mx(4).mb(4).flex_none().bg(t.border))
      .child(content)
      .when(all.length > 0, (el) => el
        .child(div().h(1).mx(4).mt(6).flex_none().bg(t.border))
        .child(h_flex().h(30).px(10).gap(5).items_center().flex_none().text_size(11).text_color(t.dim)
          .child(key("↑↓")).child(div().mr(8).child("navigate"))
          .child(key("↵")).child(div().mr(8).child("run"))
          .child(key("esc")).child("close")));
  }
}
