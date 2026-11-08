// Project tasks. The Tasks button in the tab bar opens this: every script in <repo>/.tasks/ is a task.
// A subfolder is a group; a script may set its name with a `# name: dev` header line,
// and "Name · detail" shows the detail muted after the name.
// Tasks run in the background as sub-agents of the focused agent (they show under it in the agents panel,
// no tab); click a running one to peek at its terminal. The always-alive bar button records how each ends.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { parseWorktrees, wtName, compile, parseHeader, dropKeys, failure } from "./model.js";
import { exec, run, terminals, agents, panes, focused, spaces, settings, theme, props, shared, setShared, notify, openOverlay, closeOverlay } from "herdr";

const LABEL = "herdr.task";
const RESULTS = "tasks.last";
const PATTERN = "herdr.ready"; // label on a task's terminal: regex that says it is up and usable
const BUSY = "tasks.busy"; // address -> { since, re }: tasks reloading right now, until their screen stops matching `re`
const READY = "tasks.ready"; // addresses of running tasks whose output has matched it
const PIN = "tasks.pinned"; // { root }: the worktree kept on screen whatever the focus
const WORKTREE = "tasks.worktree"; // tab id -> the worktree picked for it
const DAY = 24 * 3600 * 1000;
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
      const { name, ready, reload, busy, problems } = parseHeader(await fs.readFile(path, "utf8"), f.replace(/\.sh$/, ""));
      const [title, ...rest] = name.split(" · ");
      tasks.push({ file, name, ready, reload, busy, problems, title, detail: rest.join(" · "), label: group ? `${group} · ${name}` : name, path, key: `${root}:${file}` });
    } catch {}
  }
  return tasks;
}

const rank = (name) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);

async function worktreeList(cwd) {
  const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd });
  return r.code === 0 ? parseWorktrees(r.stdout) : [];
}

// .tasks is git-ignored, so a worktree doesn't have one: fall back to the main checkout's.
// `override` is a worktree the user picked for this tab; it only counts while it is still a worktree.
async function discover(cwd, override) {
  const git = async (...args) => {
    const r = await exec("git", args, { cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const top = await git("rev-parse", "--show-toplevel");
  if (!top) return null;
  const worktrees = await worktreeList(cwd);
  const root = override && worktrees.some((w) => w.path === override) ? override : top;
  const main = worktrees[0]?.path ?? root;
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
    return { root, main, worktrees, groups };
  }
  return { root, main, worktrees, groups: [] };
}

// Display only: first letter up.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ago = (ms) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

// A theme color with alpha, when it is a plain #rrggbb.
const faint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);

export default class Tasks extends View {
  init(_props, cx) {
    // In the tab bar's right-hand strip the mod is only the button that opens this popup.
    if (props()?.button) { this.button = true; return; }
    const log = props()?.log;
    if (log) {
      this.info = log;
      cx.spawn(async (cx) => {
        try {
          const r = await exec("hc", ["read", log.address, "--lines", "400"]);
          if (r.code === 0) this.text = r.stdout;
          else { this.text = ""; this.gone = failure(r.stderr || r.stdout) || "the terminal was removed"; }
        } catch (e) { this.text = ""; this.gone = String(e.message ?? e); }
        cx.notify();
      });
      return;
    }
    this.found = undefined;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.remote = Boolean(spaces().find((p) => p.active)?.machine);
    this.tab = focused()?.tab;
    this.load(cx);
  }

  // Where the user is working: the focused terminal, else the tab's agent, else any terminal in the tab.
  // A focused bar button or mod pane has no cwd, and the space's own folder is its first terminal's,
  // often another worktree.
  where() {
    const f = focused(), inTab = panes().filter((p) => p.tab === f?.tab && p.terminal && p.cwd), parent = this.parent();
    return f?.cwd ?? inTab.find((p) => p.terminal === parent)?.cwd ?? inTab[0]?.cwd ?? spaces().find((p) => p.active)?.folder;
  }

  load(cx) {
    const cwd = this.where(), override = shared(WORKTREE)?.[this.tab], pin = shared(PIN);
    cx.spawn(async (cx) => {
      try {
        if (this.remote) this.found = null;
        else {
          // A pinned worktree wins over the focus. If it is gone (nothing found, or git cannot even run
          // in its folder) the pin is dropped and the focus is followed again.
          const pinned = pin ? await discover(pin.root, pin.root).catch(() => null) : null;
          if (pin && !pinned) {
            setShared(PIN, null);
            notify({ title: "Tasks", body: "The pinned worktree is gone: following the focus again.", level: "info" });
          }
          this.found = pinned ?? await discover(cwd, override);
        }
      } catch (e) { this.found = null; this.error = String(e); }
      cx.notify();
    });
  }

  // Pin the worktree on screen, or release it to follow the focus again.
  togglePin(cx) {
    setShared(PIN, shared(PIN)?.root === this.found.root ? null : { root: this.found.root });
    this.load(cx);
  }

  choose(path, cx) {
    if (shared(PIN)) setShared(PIN, { root: path });
    else setShared(WORKTREE, { ...shared(WORKTREE), [this.tab]: path });
    this.picking = false;
    this.at = 0;
    this.load(cx);
  }

  running(task) {
    return terminals().find((x) => x.state === "live" && x.labels?.[LABEL] === task.key);
  }

  last(task) {
    const r = shared(RESULTS)?.[task.key];
    return r && Date.now() - r.at < DAY ? r : null;
  }

  // The agent the task hangs from: one working in the task's worktree (the focused one first), else the
  // focused one, else one in this tab, else one in this space.
  parent(root) {
    const f = focused(), all = agents();
    const inRoot = (a) => root && panes().some((p) => p.terminal === a.address && p.cwd && (p.cwd === root || p.cwd.startsWith(`${root}/`)));
    return (all.find((a) => a.address === f?.agent && inRoot(a)) ?? all.find(inRoot) ?? all.find((a) => a.address === f?.agent)
      ?? all.find((a) => a.tab === f?.tab) ?? all.find((a) => a.space === f?.space))?.address;
  }

  async start(task) {
    if (task.problems.length) notify({ title: task.label, body: `${task.problems.join("; ")} in ${task.file}: ignored`, level: "warning" });
    const parent = this.parent(this.found.root);
    const base = task.file.replace(/\.sh$/, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 28);
    let name = base, n = 1;
    while (terminals().some((x) => x.name === name)) name = `${base}-${++n}`;
    const args = ["run", "--bg", "--json", "--outlive-parent", "--no-notify", "--name", name, "--label", `${LABEL}=${task.key}`, ...(task.ready ? ["--label", `${PATTERN}=${task.ready}`] : []), "--cwd", this.found.root, ...(parent ? ["--parent", parent] : ["--no-parent"]), "--", "bash", task.path];
    try {
      const r = await exec("hc", args);
      if (r.code !== 0) throw new Error(failure(r.stderr || r.stdout));
      if (!parent) notify({ title: task.label, body: "Started. No agent in this space to hang it from: open Tasks to see it.", level: "info" });
    } catch (e) {
      notify({ title: `${task.label} didn't start`, body: String(e.message ?? e), level: "error" });
    }
  }

  // Sends the task's reload key (`# reload: r`) to its terminal, as a bare keypress, no Enter.
  reload(task, live, cx) {
    exec("hc", ["keys", live.address, task.reload]).then((r) => {
      if (r.code !== 0) notify({ title: `${task.label}: reload failed`, body: failure(r.stderr || r.stdout), level: "error" });
    }).catch((e) => notify({ title: `${task.label}: reload failed`, body: String(e.message ?? e), level: "error" }));
    if (task.busy) setShared(BUSY, { ...shared(BUSY), [live.address]: { since: Date.now(), re: task.busy } });
    this.flash = live.address;
    cx.notify();
    cx.timer.after(900, (cx) => { this.flash = null; cx.notify(); });
  }

  // Running: peek at its terminal. Otherwise: start it in the background.
  pick(task) {
    const live = this.running(task);
    closeOverlay(props().overlay);
    if (live) run("terminal.peek", { terminal: live.address });
    else this.start(task);
  }

  log(task, last) {
    closeOverlay(props().overlay);
    openOverlay({ mod: "tasks", kind: "dialog", width: 720, height: 520, props: { log: { title: task.label, address: last.address, code: last.code } } });
  }

  // Runs in the bar button, which is always alive: when a task leaves the live set on its own
  // (not killed), remember how it ended and say so.
  async finished(address, key) {
    const ready = shared(READY) ?? [];
    if (ready.includes(address)) setShared(READY, ready.filter((a) => a !== address));
    if (shared(BUSY)?.[address]) { const { [address]: _gone, ...rest } = shared(BUSY); setShared(BUSY, rest); }
    let t;
    try {
      const r = await exec("hc", ["ls", "--all", "--json", "--label", `${LABEL}=${key}`]);
      t = JSON.parse(r.stdout).terminals.find((x) => x.address === address);
    } catch { return; }
    if (t?.reason !== "exited" || typeof t.exit_code !== "number") return;
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(shared(RESULTS) ?? {}).filter(([, v]) => now - v.at < DAY));
    setShared(RESULTS, { ...kept, [key]: { code: t.exit_code, at: now, address } });
    const title = key.slice(key.lastIndexOf(":") + 1).replace(/\.sh$/, "").replace("/", " · ");
    notify({ title, body: t.exit_code === 0 ? "Finished" : `Failed (exit ${t.exit_code})`, level: t.exit_code === 0 ? "success" : "error" });
  }

  // Tasks that declare a `# ready:` pattern and haven't matched it yet, or are reloading right now.
  waiting() {
    const ready = new Set(shared(READY) ?? []), busy = shared(BUSY) ?? {};
    return terminals().filter((x) => x.state === "live" && x.labels?.[LABEL] && ((x.labels?.[PATTERN] && !ready.has(x.address)) || busy[x.address]));
  }

  // Runs in the bar button, and only while something is waiting: a render that sees a waiting task starts the
  // loop, and it stops itself once nothing is. With no such task there is no timer at all.
  watch(cx) {
    if (this.watching || !this.waiting().length) return;
    this.watching = true;
    cx.timer.after(Object.keys(shared(BUSY) ?? {}).length ? 500 : 3000, async (cx) => {
      this.watching = false;
      await this.poll();
      this.watch(cx);
    });
  }

  // Until a task's output matches its `# ready:` pattern, look at its screen.
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const live = terminals().filter((x) => x.state === "live" && x.labels?.[LABEL]);
      const alive = new Set(live.map((x) => x.address));
      // A read can take a while and another copy may change these lists meanwhile, so each write below
      // starts from the list as it is at that moment and applies only what this pass learned.
      const matched = [];
      for (const x of live) {
        const re = x.labels[PATTERN] && compile(x.labels[PATTERN]);
        if (!re || (shared(READY) ?? []).includes(x.address)) continue;
        try {
          const r = await exec("hc", ["read", x.address, "--lines", "120"]);
          if (r.code === 0 && re.test(r.stdout)) matched.push(x.address);
        } catch {}
      }
      const was = shared(READY) ?? [];
      const ready = was.filter((a) => alive.has(a));
      for (const a of matched) if (!ready.includes(a)) ready.push(a);
      if (ready.join() !== was.join()) setShared(READY, ready);
      // Reloading: busy until its screen stops matching the task's `# busy:` pattern (it gets a moment to start first).
      const freed = [];
      for (const [a, b] of Object.entries(shared(BUSY) ?? {})) {
        const age = Date.now() - b.since;
        let still = alive.has(a) && age < 30000;
        if (still && age > 800) {
          const re = compile(b.re);
          try {
            const r = re ? await exec("hc", ["read", a, "--lines", "40"]) : null;
            still = Boolean(r) && r.code === 0 && re.test(r.stdout);
          } catch { still = false; }
        }
        if (!still) freed.push([a, b.since]);
      }
      // Only entries that are still the very ones judged: a reload pressed meanwhile stays.
      const now = shared(BUSY) ?? {};
      const drop = freed.filter(([a, since]) => now[a]?.since === since).map(([a]) => a);
      if (drop.length) setShared(BUSY, dropKeys(now, drop));
    } finally { this.polling = false; }
  }

  toolbar(t, cx) {
    const live = new Map(terminals().filter((x) => x.state === "live" && x.labels?.[LABEL]).map((x) => [x.address, x.labels[LABEL]]));
    for (const [address, key] of this.seen ?? []) if (!live.has(address)) this.finished(address, key);
    this.watch(cx);
    this.seen = live;
    // Compiling (or anything without a ready pattern) spins; everything running and ready turns the button green.
    const ready = new Set(shared(READY) ?? []);
    const reloading = shared(BUSY) ?? {};
    const busy = [...live.keys()].some((a) => !ready.has(a) || reloading[a]), fine = live.size > 0 && !busy;
    return h_flex().size_full().px(4).items_center().justify_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("tasks-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .text_color(fine ? t.ansi2 : t.muted).hover((s) => s.bg(t.hover).text_color(fine ? t.ansi2 : t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => openOverlay({ mod: "tasks", kind: "popup", width: WIDTH }))
        .child(busy ? svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(900) : svg(`${ICON}/play.svg`).size(14))
        .child("Tasks"));
  }

  logView(t) {
    const { title, code } = this.info;
    const lines = (this.text ?? "").replace(/\s+$/, "").split("\n");
    return v_flex().size_full().bg(t.popover).p(14).gap(10).text_color(t.foreground)
      .child(h_flex().items_center().gap(8).flex_none()
        .child(div().text_size(13).font_semibold().child(title))
        .child(h_flex().h(20).px(8).items_center().rounded(10).text_size(11).font_medium()
          .bg(faint(code === 0 ? t.ansi2 : t.ansi1, "26")).text_color(code === 0 ? t.ansi2 : t.ansi1)
          .child(code === 0 ? "Finished" : `Exit ${code}`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.dim).child("Esc to close")))
      .child(v_flex().id("task-log").flex_1().min_h(0).p(10).rounded(8).bg(t.background).overflow_hidden().justify_end()
        .text_size(12).font_family(settings().font_family).text_color(t.muted)
        .children(this.text === undefined ? [div().child("Loading…")] : this.gone ? [div().child(`The output is no longer available (${this.gone}).`)] : lines.map((l, i) => div().id(`l${i}`).flex_none().child(l || " "))));
  }

  render(cx) {
    const t = theme();
    if (this.button) return this.toolbar(t, cx);
    if (this.info) return this.logView(t);
    const groups = this.found?.groups ?? [];
    const all = groups.flatMap((g) => g.tasks);
    this.at = Math.max(0, Math.min(this.at, all.length - 1));
    const selected = all[this.at];
    const ready = new Set(shared(READY) ?? []);
    const reloading = shared(BUSY) ?? {};
    const isReady = (live) => Boolean(live) && ready.has(live.address) && !reloading[live.address];
    const busy = all.filter((task) => this.running(task)).length;
    const waiting = all.filter((task) => { const l = this.running(task); return l && !isReady(l); }).length;
    const tone = waiting > 0 ? t.accent : t.ansi2;

    const selLive = selected ? this.running(selected) : null;
    const canReload = Boolean(selected?.reload && isReady(selLive));
    const stop = (_e, cx) => cx.stop_propagation();
    const key = (k) => div().px(5).h(16).flex().items_center().rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(k);
    const control = (id, icon, tip, color, action, active = false) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(active ? color : t.muted).hover((s) => s.bg(t.raised).text_color(color)).tooltip(tip)
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(`${ICON}/${icon}.svg`).size(13));

    // The pointer moves the selection, so the right-hand hint always says what a click does.
    const row = (task, index) => {
      const live = this.running(task);
      const last = live ? null : this.last(task);
      const id = task.file.replace(/[^\w-]/g, "-");
      const on = index === this.at;
      return h_flex().id(`task-${id}`).h(30).px(10).gap(10).rounded(7).items_center().flex_none().cursor_pointer()
        .bg(live ? faint(isReady(live) ? t.ansi2 : t.accent, on ? "3d" : "26") : on ? t.hover : "#00000000")
        .on_hover((hovered, cx) => { if (hovered && this.at !== index) { this.at = index; cx.notify(); } })
        .on_click(() => this.pick(task))
        .child(div().size(14).flex_none().flex().items_center().justify_center().child(isReady(live)
          ? div().size(7).rounded(4).bg(t.ansi2)
          : live
            ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900)
            : svg(`${ICON}/play.svg`).size(11).text_color(on ? t.accent : t.dim)))
        .child(h_flex().flex_1().min_w(0).gap(7).items_baseline()
          .child(div().flex_none().text_size(13).text_color(t.foreground).when(Boolean(live), (d) => d.font_medium()).child(cap(task.title)))
          .when(Boolean(task.detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(task.detail))))
        .when(Boolean(live), (el) => el
          .when(Boolean(task.reload) && isReady(live), (e) => e.child(control(`reload-${id}`, "reload", "Hot reload", t.ansi3, (cx) => this.reload(task, live, cx), this.flash === live.address)))
          .child(control(`restart-${id}`, "restart", "Restart", t.foreground, (cx) => {
            run("terminal.kill", { terminal: live.address });
            cx.timer.after(500, () => this.start(task));
          }))
          .child(control(`stop-${id}`, "stop", "Stop", t.blocked, () => run("terminal.kill", { terminal: live.address }))))
        .when(Boolean(last), (el) => el.child(h_flex().gap(4).items_center().flex_none().text_size(11).text_color(last.code === 0 ? t.ansi2 : t.ansi1)
          .child(svg(`${ICON}/${last.code === 0 ? "check" : "x"}.svg`).size(11)).child(ago(last.at))))
        .when(Boolean(last) && on, (el) => el.child(control(`log-${id}`, "log", "Show output", t.foreground, () => this.log(task, last))))
        .when(!live && on, (el) => el.child(key("↵")));
    };

    const header = (g, first) => {
      const n = g.tasks.filter((task) => this.running(task)).length;
      return h_flex().h(first ? 22 : 30).px(10).pb(3).items_end().flex_none()
        .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.muted).child(g.name.toUpperCase()))
        .when(n > 0, (el) => el.child(div().text_size(10.5).font_medium().text_color(t.accent).child(`${n} running`)));
    };

    const wtRow = (w) => {
      const cur = w.path === this.found.root;
      return h_flex().id(`wt-${w.path.replace(/[^\w-]/g, "-")}`).h(30).px(10).gap(8).rounded(7).items_center().flex_none().cursor_pointer()
        .hover((s) => s.bg(t.selected)).on_click((_e, cx) => this.choose(w.path, cx))
        .child(div().size(12).flex_none().flex().items_center().justify_center()
          .when(cur, (d) => d.child(svg(`${ICON}/check.svg`).size(11).text_color(t.accent))))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).when(cur, (d) => d.font_medium()).child(cap(wtName(w.path, this.found.main))))
        .when(Boolean(w.branch), (el) => el.child(div().max_w(110).truncate().text_size(11).text_color(t.dim).child(w.branch)));
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

    if (this.picking && this.found) {
      content = v_flex().max_h(560).overflow_y_scrollbar().gap(1)
        .child(div().px(10).pt(2).pb(4).text_size(10.5).font_semibold().text_color(t.muted).child("WORKTREE"))
        .children(this.found.worktrees.map(wtRow));
    }
    const wtLabel = this.found ? wtName(this.found.root, this.found.main) : "";
    const switcher = (this.found?.worktrees.length ?? 0) > 1;
    const pinned = Boolean(this.found) && shared(PIN)?.root === this.found.root;

    return v_flex().id("tasks").track_focus(this.handle).w_full().bg(t.popover).p(6).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.picking) { this.picking = false; cx.stop_propagation(); cx.notify(); return; }
        if (this.picking || !all.length) return;
        if (e.key === "down") this.at = (this.at + 1) % all.length;
        else if (e.key === "up") this.at = (this.at + all.length - 1) % all.length;
        else if (e.key === "enter") return this.pick(selected);
        else if (e.key === "r" && canReload && !e.modifiers?.control && !e.modifiers?.alt && !e.modifiers?.platform) this.reload(selected, selLive, cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).px(10).gap(8).items_center().flex_none()
        .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child("Tasks"))
        .when(busy > 0, (el) => el.child(h_flex().h(20).px(8).gap(5).items_center().rounded(10).bg(faint(tone, "26"))
          .text_size(11).font_medium().text_color(tone)
          .child(div().size(6).rounded(3).bg(tone))
          .child(`${busy} running`)))
        .child(h_flex().flex_1().min_w(0).justify_end()
          .child(h_flex().id("worktree").h(22).px(7).gap(4).min_w(0).rounded(6).items_center().text_size(12)
            .text_color(this.picking ? t.foreground : t.dim)
            .when(switcher, (el) => el.cursor_pointer().bg(this.picking ? t.hover : "#00000000")
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => { this.picking = !this.picking; cx.notify(); }))
            .child(div().truncate().child(cap(wtLabel)))
            .when(switcher, (el) => el.child(svg("mods/files/chevron-down.svg").size(10).flex_none()))))
        .when(Boolean(this.found), (el) => el.child(div().id("pin").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .border_1().border_color(pinned ? t.accent : t.border).text_color(pinned ? t.accent : t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.togglePin(cx))
          .tooltip(pinned ? `Unpin ${cap(wtLabel)}` : `Pin ${cap(wtLabel)}: keep showing it when the focus moves elsewhere`)
          .child(svg(`${ICON}/pin.svg`).size(12)))))
      .child(div().h(1).mx(4).mb(4).flex_none().bg(t.border))
      .child(content)
      .when(all.length > 0 && !this.picking, (el) => el
        .child(div().h(1).mx(4).mt(6).flex_none().bg(t.border))
        .child(h_flex().h(30).px(10).gap(5).items_center().flex_none().text_size(11).text_color(t.dim)
          .child(key("↑↓")).child(div().mr(8).child("navigate"))
          .child(key("↵")).child(div().mr(8).child("run"))
          .child(key("esc")).child("close")
          .when(canReload, (e) => e.child(div().w(6)).child(key("r")).child("reload"))));
  }
}
