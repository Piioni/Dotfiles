import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, run, appHome } from "herdr";
import { helixTab, helixPopup, openTab, openPopup } from "./hx.js";
import { iconFor } from "./icons.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* remembering the choice is optional */ } },
};

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.message = ""; this.handle = cx.focus_handle();
    this.view = store.get("view") === "folders" ? "folders" : "flat"; this.collapsed = new Set(); this.hover = null;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.collapsed = new Set();
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  // The file itself in Helix. A deleted file has nothing to open.
  openFile(file, popup, cx) {
    if (!this.root || file.status === "D") return;
    const abs = `${this.root}/${file.path}`;
    if (popup && !this.on) helixPopup(this.root, abs, cx); else helixTab(this.root, abs);
  }

  // Side-by-side diff: Neovim's diff mode through git difftool, in a tab or (popup) over the current one.
  // New (untracked) files have nothing to compare against, so they open read-only.
  openDiff(file, popup, cx) {
    if (!this.root) return;
    this.open = file.path;
    const name = `diff · ${file.path.split("/").pop()}`;
    const init = `VIMINIT=source ${appHome()}/mods/relevo-changes/diff.lua`;
    const argv = file.fresh || (!this.hasHead && file.status === "A")
      ? ["env", init, "nvim", "-R", file.path]
      : ["env", init, "git", "-c", "diff.tool=nvimdiff", "difftool", "-y", ...(this.hasHead ? ["HEAD"] : []), "--", file.path];
    if (popup && !this.on) openPopup(this.root, argv, name, cx); else openTab(this.root, argv, name);
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  setView(view, cx) { this.view = view; store.set("view", view); cx.notify(); }

  // The changed files as a folder tree.
  tree() {
    const root = { name: "", path: "", dirs: new Map(), files: [] };
    for (const f of this.files) {
      let node = root;
      for (const part of f.path.split("/").slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      node.files.push(f);
    }
    return root;
  }

  // A folder with no files of its own and a single subfolder shows as one row ("a/b").
  fold(node) {
    let n = node, label = node.name;
    while (!n.files.length && n.dirs.size === 1) { n = n.dirs.values().next().value; label += `/${n.name}`; }
    return { n, label };
  }

  under(node) { return [...node.files, ...[...node.dirs.values()].flatMap((d) => this.under(d))]; }

  // The key of every folder row the tree shows, for Collapse all.
  dirKeys(node = this.tree(), keys = []) {
    for (const d of node.dirs.values()) { const { n } = this.fold(d); keys.push(n.path); this.dirKeys(n, keys); }
    return keys;
  }

  seg(t, options, current, pick) {
    return h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).children(options.map(([id, label]) =>
      div().id(`seg-${id}`).h(22).px(10).flex().items_center().rounded(6).text_size(11).cursor_pointer()
        .when(current === id, (e) => e.bg(t.selected).text_color(t.foreground)).when(current !== id, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => pick(id, cx)).child(label)));
  }

  // Subfolders first, then files, like Files. `depth` is how many folder levels sit above these entries.
  entries(node, depth, t) {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
    return [...dirs.flatMap((d) => this.dirNode(d, depth, t)), ...files.map((f) => this.row(f, t, depth))];
  }

  // One folder row, then what it holds indented under it with a guide line.
  dirNode(node, depth, t) {
    const { n, label } = this.fold(node), closed = this.collapsed.has(n.path), files = this.under(n);
    const add = files.reduce((s, f) => s + f.add, 0), del = files.reduce((s, f) => s + f.del, 0);
    const head = h_flex().id(`dir-${n.path}`).h(30).flex_none().pl(8 + depth * 18).pr(8).gap(8).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (closed) this.collapsed.delete(n.path); else this.collapsed.add(n.path); cx.notify(); })
      .child(div().w(12).flex_none().text_size(10).text_color(t.dim).child(closed ? "▸" : "▾"))
      .child(image(iconFor(n.name, true, !closed)).size(18).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(13).child(label))
      .child(div().px(6).h(16).flex().items_center().rounded(8).bg(t.raised).text_size(10).text_color(t.dim).child(String(files.length)))
      .when(add > 0, (e) => e.child(div().text_size(10).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().text_size(10).text_color(t.ansi1).child(`−${del}`)));
    if (closed) return [head];
    // The guide runs under this folder's icon: 8 padding + 12 arrow + 8 gap + half of the 18px icon, plus 18 per level.
    const guide = t.dim.length === 7 ? t.dim + "55" : t.dim;
    return [head, v_flex().flex_none().relative().children(this.entries(n, depth + 1, t))
      .child(div().absolute().left(37 + depth * 18).top(0).bottom(0).w(1).bg(guide))];
  }

  // `depth` undefined is the flat list (icon, name and folder); a number is a file under that many folders.
  row(f, t, depth) {
    const flat = depth === undefined, showPath = flat;
    const parts = f.path.split("/"), name = parts.pop();
    const color = f.status === "A" ? t.ansi2 : f.status === "M" ? t.blocked : t.ansi1;
    const gone = f.status === "D", hovered = this.hover === f.path;
    return h_flex().id(`change-${f.path}`).h(flat ? 38 : 30).flex_none().pl(flat ? 8 : 28 + depth * 18).pr(8).gap(9).items_center().rounded(7).cursor_pointer()
      .when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_hover((over, cx) => { if (over) this.hover = f.path; else if (this.hover === f.path) this.hover = null; cx.notify(); })
      .on_click((e, cx) => this.openDiff(f, e.modifiers.shift, cx))
      .child(image(iconFor(name, false, false)).size(showPath ? 20 : 17).flex_none())
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).when(gone, (e) => e.text_color(t.dim).line_through()).child(name))
        .when(showPath && parts.length > 0, (e) => e.child(div().truncate().text_size(10).text_color(t.dim).child(parts.join("/")))))
      .when(hovered && !gone, (e) => e.child(div().id(`open-${f.path}`).h(20).px(8).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted)
        .hover((s) => s.bg(t.selected).text_color(t.foreground))
        .on_click((ev, cx) => { cx.stop_propagation(); this.openFile(f, ev.modifiers.shift, cx); }).child("open")))
      .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
      .child(div().w(12).flex_none().text_size(11).font_semibold().text_color(color).text_center().child(f.status));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .child(h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(this.seg(t, [["flat", "Flat"], ["folders", "Folders"]], this.view, (id, cx) => this.setView(id, cx)))
        .child(div().flex_1())
        .when(this.view === "folders" && this.files.length > 0, (e) => {
          const dirs = this.dirKeys(), all = dirs.length > 0 && dirs.every((d) => this.collapsed.has(d));
          if (!dirs.length) return e;
          return e.child(div().id("collapse-all").h(22).px(8).flex().items_center().rounded(6).text_size(11).text_color(t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.collapsed = all ? new Set() : new Set(dirs); cx.notify(); }).child(all ? "Expand all" : "Collapse all"));
        }))
      .child(v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(this.view === "folders" ? this.entries(this.tree(), 0, t) : this.files.map((f) => this.row(f, t)))
        .when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}
