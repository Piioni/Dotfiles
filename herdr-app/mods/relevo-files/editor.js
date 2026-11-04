import { div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState } from "gpui-base";
import { exec, readTextFile, writeTextFile, watchFolder, theme, settings } from "herdr";
import { languageOf, textState, parentOf } from "./lib/paths.js";
import { statArgs } from "./lib/platform.js";
import { window } from "herdr";

/** @param {string} path @returns {Promise<number | null>} */
async function sizeOf(path) {
  const [cmd, args] = statArgs(window().platform, path);
  const r = await exec(cmd, args).catch(/** @returns {null} */ () => null);
  return r?.code === 0 ? Number(r.stdout.trim()) : null;
}

export class FileEditor {
  /** @param {string} path @param {boolean} [local] */
  constructor(path, local = true) {
    this.path = path; this.local = local;
    /** @type {import("gpui-base").EditorState | null} */ this.state = null;
    /** @type {string | null} */ this.base = null;
    /** @type {string | null} */ this.error = null;
    this.editable = false; this.editing = false; this.dirty = false;
    /** @type {string | null | undefined} */ this.disk = undefined;
    /** @type {string | null} */ this.note = null;
    this.open = true; this.loadVersion = 0; this.editVersion = 0;
    /** @type {Promise<void> | null} */ this.saving = null;
    this.again = false; this.recheck = false;
  }
  /** @param {import("gpui-kit").AsyncContext} cx @param {(path: string) => Promise<string | null>} [read] @param {boolean} [discard] */
  async load(cx, read = (p) => readTextFile(p), discard = false) {
    if (!this.open || this.saving) return;
    const version = ++this.loadVersion, state = this.state;
    const value = state?.value(), edits = this.editVersion;
    const current = () => this.open && version === this.loadVersion;
    const edited = () => this.state !== state || this.editVersion !== edits || this.state?.value() !== value;
    try {
      const [text, bytes] = await Promise.all([read(this.path), this.local ? sizeOf(this.path) : null]);
      if (!current()) return;
      if (edited() || (this.dirty && !discard)) {
        this.disk = text === this.base ? undefined : text;
        cx.notify(); return;
      }
      const s = textState(text, bytes);
      this.error = s.error ?? null; this.editable = this.local && Boolean(s.editable);
      this.base = s.editable ? text : null; this.disk = undefined; this.dirty = false; this.note = null;
      if (!this.editable) this.editing = false;
      this.make(s.error ? null : s.value);
    } catch {
      if (!current()) return;
      if (edited() || this.dirty) this.note = "Cannot reload this file; your edits were kept";
      else this.error = "Cannot preview this file (binary, too large, or unreadable)";
    }
    cx.notify();
    if (this.local) this.watch(cx);
  }
  /** @param {string | null | undefined} value */
  make(value) {
    this.state?.release(); this.state = null;
    if (value === null) return;
    const t = theme();
    this.state = EditorState.new({ language: languageOf(this.path), readonly: !this.editing, value,
      font_family: /** @type {string} */ (settings().font_family), font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    if (this.editing) this.state.on("change", (_e, cx) => {
      this.editVersion++; if (this.dirty) return; this.dirty = true; cx.notify();
    });
  }
  /** @param {import("gpui-kit").AsyncContext} cx */
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        while (this.open) {
          const changed = await watchFolder(parentOf(this.path));
          if (!this.open) return;
          if (changed.includes(this.path)) await this.changedOnDisk(cx);
        }
      } catch { /* the folder went away; the next read says so */ }
      this.watching = false;
    });
  }
  /** @param {import("gpui-kit").AsyncContext} cx @returns {Promise<void>} */
  async changedOnDisk(cx) {
    if (this.saving) { this.recheck = true; return; }
    const version = this.loadVersion, text = await readTextFile(this.path).catch(/** @returns {null} */ () => null);
    if (!this.open) return;
    if (version !== this.loadVersion) return this.changedOnDisk(cx);
    if (text === this.base) {
      if (this.disk !== undefined) { this.disk = undefined; cx.notify(); }
      return;
    }
    if (this.dirty) { this.disk = text; cx.notify(); } else await this.load(cx);
  }
  /** @param {import("gpui-kit").AsyncContext} cx */
  edit(cx) {
    if (!this.editable || this.editing) return;
    this.editing = true; this.make(this.state?.value() ?? this.base); cx.notify();
  }
  /** @param {import("gpui-kit").AsyncContext} cx @returns {Promise<void> | undefined} */
  save(cx) {
    if (this.saving) { this.again = true; return this.saving; }
    if (!this.open || !this.editing || !this.state) return;
    ++this.loadVersion;
    const state = this.state, text = state.value(), base = this.base;
    this.saving = (async () => {
      let saved = false;
      try {
        await writeTextFile(this.path, text, base);
        if (!this.open) return;
        this.base = text; this.dirty = state.value() !== text; this.disk = undefined;
        this.flash("Saved", cx); saved = true;
      } catch (e) {
        if (!this.open) return;
        const disk = await readTextFile(this.path).catch(/** @returns {null} */ () => null);
        if (!this.open) return;
        if (disk !== this.base) this.disk = disk;
        else this.note = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      } finally { this.saving = null; if (this.open) cx.notify(); }
      const again = saved && this.again && this.dirty, recheck = this.recheck;
      this.again = this.recheck = false;
      if (again) await this.save(cx);
      if (recheck) await this.changedOnDisk(cx);
    })();
    return this.saving;
  }
  /** @param {import("gpui-kit").AsyncContext} cx */
  async keepMine(cx) {
    await this.saving;
    if (this.disk === undefined) return this.dirty ? this.save(cx) : undefined;
    const expected = this.disk; this.disk = undefined; this.base = expected; await this.save(cx);
  }
  /** @param {import("gpui-kit").AsyncContext} cx */
  async reload(cx) {
    if (this.saving) {
      const edits = this.editVersion; await this.saving;
      if (this.disk === undefined || this.editVersion !== edits) return;
    }
    await this.load(cx, undefined, true);
  }
  /** @param {string} text @param {import("gpui-kit").AsyncContext} cx */
  flash(text, cx) {
    this.note = text;
    cx.timer.after(1500, (cx) => { if (!this.open || this.note !== text) return; this.note = null; cx.notify(); });
  }
  close() { this.open = false; this.state?.release(); this.state = null; }
  /** @param {import("gpui-kit").KeyEvent} e @param {import("gpui-kit").Context} cx */
  key(e, cx) {
    if (e.modifiers.platform && !e.modifiers.shift && e.key === "s") {
      cx.stop_propagation(); cx.spawn(async (cx) => this.save(cx));
    }
  }
  /** @param {Record<string, `#${string}`>} t */
  controls(t) {
    /** @param {string} id @param {string} label @param {(cx: import("gpui-kit").Context) => void} onClick @param {boolean} [strong] */
    const button = (id, label, onClick, strong = false) => div().id(id).h(22).px(8).flex_none().flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
      .when(strong, (el) => el.bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground))
      .when(!strong, (el) => el.border(1).border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => onClick(cx)).child(label);
    return h_flex().flex_none().gap(6).items_center()
      .when(Boolean(this.note), (el) => el.child(div().text_size(11).text_color(t.dim).child(this.note)))
      .when(this.dirty, (el) => el.child(div().size(7).rounded_full().bg(t.ansi3).tooltip("Unsaved changes")))
      .when(this.editable && !this.editing, (el) => el.child(button("fe-edit", "Edit", (cx) => this.edit(cx))))
      .when(this.editing && this.dirty, (el) => el.child(button("fe-save", "Save", (cx) => cx.spawn(async (cx) => this.save(cx)), true).tooltip("⌘S")));
  }
  /** @param {Record<string, `#${string}`>} t */
  body(t) {
    const conflict = this.disk !== undefined;
    return v_flex().id("fe-body").flex_1().min_h(0).on_key_down((e, cx) => this.key(e, cx))
      .when(conflict, (el) => el.child(h_flex().h(32).flex_none().px(12).gap(8).items_center().bg(t.raised ?? t.surface).border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(this.disk === null ? "Deleted on disk" : "Changed on disk"))
        .when(this.disk !== null, (el) => el.child(div().id("fe-reload").px(8).h(22).flex().items_center().rounded(5).cursor_pointer().border(1).border_color(t.border).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.reload(cx))).child("Reload")))
        .child(div().id("fe-keep").px(8).h(22).flex().items_center().rounded(5).cursor_pointer().bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground)
          .on_click((_e, cx) => cx.spawn(async (cx) => this.keepMine(cx))).child("Keep mine"))))
      .child(this.state ? Editor.new(this.state).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.error ?? "Loading file…"));
  }
}
