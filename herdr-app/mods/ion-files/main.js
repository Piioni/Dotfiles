import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, props, shared, window } from "herdr";
import { iconFor } from "./icons.js";
import { helixTab, helixPopup } from "./hx.js";
import { FileEditor } from "./editor.js";
import { FileMenu, NameDialog, TrashConfirm, openMenu } from "./actions.js";
import { FileView } from "./view.js";
import { moved, isUnder, parentOf } from "./lib/paths.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;
const store = {
  /** @param {string} k */ get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  /** @param {string} k @param {string} v */ set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* remembering the choice is optional */ } },
};
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {{key: string, cwd?: string | null, on?: string | null}} FileContext */
/** @typedef {{name: string, dir: boolean}} DirectoryEntry */
/** @typedef {Record<string, `#${string}`>} ThemeColors */
/** @typedef {{n: number, root: string, path: string, kind: "moved", to: string} | {n: number, root: string, path: string, kind: "trashed" | "folder" | "open"}} FileEvent */
/** @typedef {{init?: (props: unknown, cx: AsyncContext) => void, close?: (cx: AsyncContext) => void, render: (cx: AsyncContext) => import("gpui-kit").Element}} FilePart */

/** @param {string} path @param {string | null | undefined} on */
export async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    const quoted = path.replaceAll("'", "''");
    const r = await exec("powershell", ["-NoProfile", "-Command", `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-ChildItem -LiteralPath '${quoted}' -Force -ErrorAction Stop | Where-Object { $_.Name -ne '.git' -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=$_.PSIsContainer } }) | ConvertTo-Json -Compress`]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    let result;
    try { result = JSON.parse(r.stdout || "[]"); }
    catch { throw new Error("Cannot list this folder"); }
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; [ -L "$p" ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export class Files {
  /** @param {unknown} _props @param {AsyncContext} cx */
  init(_props, cx) {
    this.saved = new Map();
    this.trackedOnly = store.get("trackedOnly") === "1";
    /** @type {{files: Set<string>, dirs: Set<string>} | null} */ this.tracked = null;
    /** @type {Map<string, DirectoryEntry[]>} */ this.entries = new Map();
    /** @type {Set<string>} */ this.folders = new Set();
    /** @type {Set<string>} */ this.pending = new Set();
    /** @type {Record<string, string>} */ this.marks = {};
    /** @type {FileContext | undefined} */ this.context = undefined;
    /** @type {string | null} */ this.watched = null;
    /** @type {number | undefined} */ this.seen = undefined;
    this.refresh(cx); cx.timer.every(10000, cx => this.refresh(cx));
  }
  /** @param {string} root @param {AsyncContext} cx */
  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root; const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }
  /** @param {FileContext} context */
  current(context) { return this.context === context && key() === context.key; }
  /** @param {string} path @param {FileContext} context */
  async loadFolder(path, context) {
    const { on, cwd: root } = context, entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }
  /** @param {AsyncContext} cx */
  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key && this.editor?.dirty) return;
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.tracked = null; this.show(null); this.watched = null; this.error = null; this.limited = false; this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context; this.loading = true; this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) { if (!this.current(context)) return; await this.loadFolder(path, context); }
        /** @type {import("herdr").ExecResult | null} */ const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(/** @returns {null} */ () => null);
        /** @type {Record<string, string>} */ const marks = {};
        if (top?.code === 0) {
          /** @type {import("herdr").ExecResult | null} */ const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(/** @returns {null} */ () => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
        if (this.trackedOnly) this.loadTracked(cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }
  /** What git versions here: the file set, and every folder that holds one. @param {AsyncContext} cx */
  loadTracked(cx) {
    const context = this.context;
    if (!context?.cwd) return;
    cx.spawn(async cx => {
      /** @type {import("herdr").ExecResult | null} */ const r = await exec("git", ["--no-optional-locks", "ls-files", "-z"], { cwd: context.cwd, on: context.on }).catch(/** @returns {null} */ () => null);
      if (!this.current(context)) return;
      const files = new Set(), dirs = new Set();
      if (r?.code === 0) for (const p of r.stdout.split("\0")) {
        if (!p) continue;
        files.add(p);
        for (let d = parentOf(p); d && !dirs.has(d); d = parentOf(d)) dirs.add(d);
      }
      this.tracked = { files, dirs }; cx.notify();
    });
  }
  /** @param {boolean} on @param {AsyncContext} cx */
  setTrackedOnly(on, cx) {
    this.trackedOnly = on; store.set("trackedOnly", on ? "1" : "0");
    if (on) this.loadTracked(cx);
    cx.notify();
  }
  /** @param {string} path @param {boolean} dir */
  isTracked(path, dir) { return !this.trackedOnly || Boolean(this.tracked?.[dir ? "dirs" : "files"].has(path)); }
  /** @param {string} path @param {AsyncContext} cx */
  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) { this.folders.delete(folder); this.entries.delete(folder); }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context; this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }
  /** @param {string | null} path @param {AsyncContext} [cx] */
  show(path, cx) {
    this.editor?.close(); this.editor = null; this.file = path; this.leaving = false;
    if (!path || !cx) return;
    this.editor = new FileEditor(`${this.root}/${path}`, !this.on);
    this.editor.load(cx, p => readTextFile(p, { on: this.on }));
  }
  /** @param {string} path @param {boolean} popup @param {AsyncContext} cx */
  openInHelix(path, popup, cx) {
    if (!this.root) return;
    const abs = `${this.root}/${path}`;
    if (popup && !this.on) helixPopup(this.root, abs, cx); else helixTab(this.root, abs);
  }
  /** @param {AsyncContext} cx */
  back(cx) { if (this.editor?.dirty) this.leaving = true; else this.show(null); cx.notify(); }
  /** @param {AsyncContext} cx */
  follow(cx) {
    /** @type {FileEvent | undefined} */ const e = /** @type {FileEvent | undefined} */ (shared("ion-files.event"));
    if (!e || e.n === this.seen) return;
    const first = this.seen === undefined; this.seen = e.n;
    if (first || e.root !== this.root) return;
    if (e.kind === "moved") {
      if (this.file && isUnder(this.file, e.path)) { this.file = moved(this.file, e.path, e.to); if (this.editor) this.editor.path = `${this.root}/${this.file}`; }
      this.folders = new Set([...this.folders].map(f => moved(f, e.path, e.to)));
    } else if (e.kind === "trashed") {
      if (this.file && isUnder(this.file, e.path)) { if (this.editor?.dirty) this.editor.disk = null; else this.show(null); }
      for (const f of [...this.folders]) if (isUnder(f, e.path)) this.folders.delete(f);
    } else {
      for (let f = e.kind === "folder" ? e.path : parentOf(e.path); f; f = parentOf(f)) this.folders.add(f);
      if (e.kind === "open") this.openInHelix(e.path, false, cx);
    }
    this.refresh(cx);
  }
  /** @param {string} prefix @param {number} depth @param {import("gpui-kit").Element[]} out @param {ThemeColors} t */
  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      if (!this.isTracked(path, entry.dir)) continue;
      out.push(h_flex().id(`file-${path}`).h(30).flex_none().pl(8 + depth * 18).pr(8).gap(8).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((e, cx) => entry.dir ? this.toggle(path, cx) : this.openInHelix(path, e.modifiers.shift, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu({ root: this.root, path, dir: entry.dir, local: !this.on }); })
        .child(entry.dir ? svg(`mods/ion-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(image(iconFor(entry.name, entry.dir, open)).size(18).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }
  close() { this.editor?.close(); }
  /** @param {AsyncContext} cx */
  render(cx) {
    this.follow(cx); if (key() !== this.context?.key) this.refresh(cx);
    const t = /** @type {ThemeColors} */ (theme()), ed = this.editor, list = this.rows("", 0, [], t);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.back(cx)).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).children([[false, "All"], [true, "Tracked"]].map(([on, label]) =>
          div().id(`files-${label}`).h(22).px(10).flex().items_center().rounded(6).text_size(11).cursor_pointer()
            .when(this.trackedOnly === on, el => el.bg(t.selected).text_color(t.foreground)).when(this.trackedOnly !== on, el => el.text_color(t.muted).hover(s => s.text_color(t.foreground)))
            .on_click((_e, cx) => this.setTrackedOnly(on, cx)).child(label))))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(ed), el => el.child(ed.controls(t))))
      .when(this.leaving, el => el.child(h_flex().h(32).flex_none().px(12).gap(8).items_center().bg(t.raised ?? t.surface).border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_1().child("Unsaved changes"))
        .child(div().id("files-discard").px(8).h(22).flex().items_center().rounded(5).cursor_pointer().border(1).border_color(t.border).hover(s => s.bg(t.hover)).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("Discard"))
        .child(div().id("files-save").px(8).h(22).flex().items_center().rounded(5).cursor_pointer().bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground)
          .on_click((_e, cx) => cx.spawn(async cx => { await ed.save(cx); if (!ed.dirty) { this.show(null); cx.notify(); } })).child("Save"))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(list)
        .when(this.trackedOnly && !list.length && !this.error && Boolean(this.root), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.tracked ? "No tracked files here" : "Loading tracked files…")))
        .on_mouse_down("right", () => { if (this.root) openMenu({ root: this.root, path: "", dir: true, local: !this.on }); })
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(ed), el => el.child(ed.body(t)));
  }
}
const ROLES = { menu: FileMenu, name: NameDialog, "trash-confirm": TrashConfirm, view: FileView };
export default class RelevoFiles extends View {
  /** @param {unknown} _props @param {AsyncContext} cx */
  init(_props, cx) {
    /** @type {keyof typeof ROLES} */ const role = props()?.role;
    /** @type {FilePart} */ this.part = new (ROLES[role] ?? Files)();
    this.part.init?.(props(), cx);
  }
  /** @param {AsyncContext} cx */
  close(cx) { return this.part.close?.(cx); }
  /** @param {AsyncContext} cx */
  render(cx) { return this.part.render(cx); }
}
