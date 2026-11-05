import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, writeTextFile, props, openOverlay, closeOverlay, notify, theme, shared, setShared, window } from "herdr";
import { nameError, join, baseName, parentOf, targetFolder } from "./lib/paths.js";
import { trashArgs, revealArgs } from "./lib/platform.js";
import { helixTab, helixPopup } from "./hx.js";

/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {Record<string, `#${string}`>} ThemeColors */
/** @param {Record<string, unknown>} event */
export function announce(event) {
  const previous = /** @type {{n?: number} | undefined} */ (shared("ion-files.event"));
  setShared("ion-files.event", { ...event, n: (previous?.n ?? 0) + 1 });
}
/** @param {Record<string, unknown>} target */
export function openMenu(target) {
  openOverlay({ mod: "ion-files", kind: "popup", width: 210, props: { role: "menu", ...target } });
}
/** @param {string} path */
const exists = async (path) => (await exec("test", ["-e", path])).code === 0 || (await exec("test", ["-L", path])).code === 0;
/** @param {string} root @param {string} rel @param {boolean} dir */
async function create(root, rel, dir) {
  const abs = join(root, rel);
  if (await exists(abs)) throw new Error(`${baseName(rel)} already exists`);
  if (dir) {
    const r = await exec("mkdir", [abs]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot create the folder");
  } else await writeTextFile(abs, "", null);
}
/** @param {string} root @param {string} from @param {string} to */
async function rename(root, from, to) {
  const src = join(root, from), dst = join(root, to);
  if (await exists(dst)) throw new Error(`${baseName(to)} already exists`);
  const r = await exec("mv", ["-n", src, dst]);
  if (r.code !== 0 || (await exists(src)) || !(await exists(dst))) throw new Error(r.stderr.trim() || "Cannot rename");
}

export class FileMenu {
  render() {
    const t = /** @type {ThemeColors} */ (theme()), p = props() ?? {}, { root, path = "", dir, local, overlay } = p;
    const abs = join(root, path), isRoot = !path;
    /** @param {string} id @param {string} label @param {(cx: Context) => unknown} act */
    const item = (id, label, act) => div().id(`fm-${id}`).h(28).px(10).flex().items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { if (act(cx) !== true) closeOverlay(overlay); }).child(label);
    /** @param {string} mode */
    const ask = (mode) => () => openOverlay({ mod: "ion-files", kind: "dialog", width: 380, props: { role: "name", mode, root, path, dir } });
    const sep = () => div().h(1).my(4).mx(6).bg(t.border);
    return v_flex().id("file-menu").w_full().p(4).bg(t.popover ?? t.surface).text_color(t.foreground).text_size(12.5)
      .when(!dir && !isRoot, (el) => el.child(item("open-tab", "Open in tab", () => helixTab(root, abs)))
        .child(item("open-popup", "Open in popup", (cx) => local ? helixPopup(root, abs, cx) : helixTab(root, abs)))
        .child(sep()))
      .when(local, (el) => el.child(item("new-file", "New file", ask("new-file"))).child(item("new-folder", "New folder", ask("new-folder")))
        .when(!isRoot, (el) => el.child(item("rename", "Rename", ask("rename")))
          .child(item("trash", "Move to Trash", () => openOverlay({ mod: "ion-files", kind: "dialog", width: 380, props: { role: "trash-confirm", root, path, dir } }))))
        .child(sep()).child(item("reveal", "Reveal in Folder", () => {
          const [cmd, args] = revealArgs(window().platform, abs);
          return exec(cmd, args);
        })))
      .child(item("copy", "Copy path", (cx) => cx.write_to_clipboard(abs)))
      .when(!isRoot, (el) => el.child(item("copy-rel", "Copy relative path", (cx) => cx.write_to_clipboard(path))));
  }
}

export class TrashConfirm {
  render() {
    const t = /** @type {ThemeColors} */ (theme()), { root, path, dir, overlay } = props() ?? {};
    const finish = async () => {
      const [cmd, args] = trashArgs(window().platform, join(root, path), dir);
      const r = await exec(cmd, args);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot move to Trash");
      announce({ kind: "trashed", root, path });
      notify({ title: "Moved to Trash", body: baseName(path), level: "success", timeout: 2500 });
    };
    /** @param {string} id @param {string} label @param {boolean} action @param {boolean} [strong] */
    const button = (id, label, action, strong = false) => div().id(id).h(30).px(10).flex().items_center().rounded(6).cursor_pointer()
      .when(strong, (el) => el.bg(t.ansi1).text_color(t.solid_foreground ?? t.foreground))
      .when(!strong, (el) => el.border(1).border_color(t.border).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => {
        if (!action) return closeOverlay(overlay);
        cx.spawn(async () => {
          try { await finish(); closeOverlay(overlay); }
          catch (e) { notify({ title: "Not moved to Trash", body: e instanceof Error ? e.message : String(e), level: "error" }); }
        });
      }).child(label);
    return v_flex().id("trash-confirm").w_full().p(16).gap(12).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(div().child(`Move “${baseName(path)}” to Trash?`))
      .child(h_flex().justify_end().gap(8).children([button("trash-cancel", "Cancel", false), button("trash-confirm-action", "Move to Trash", true, true)]));
  }
}

/** @type {Record<string, string>} */
const TITLES = { "new-file": "New file", "new-folder": "New folder", rename: "Rename" };
export class NameDialog {
  init() {
    const { mode, path = "" } = props() ?? {};
    /** @type {import("gpui-base").InputState} */ this.input = InputState.new({ value: mode === "rename" ? baseName(path) : "", placeholder: "Name" });
    /** @type {string | null} */ this.error = null;
    /** @type {boolean} */ this.busy = false;
    this.input.on("change", (_e, cx) => { if (!this.error) return; this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx)); this.input.focus();
  }
  /** @param {Context} cx */
  submit(cx) {
    if (this.busy) return;
    const { mode, root, path = "", dir, overlay } = props() ?? {}, name = this.input.value();
    this.error = nameError(name, window().platform); if (this.error) return cx.notify();
    const folder = mode === "rename" ? parentOf(path) : targetFolder({ path, dir }), rel = join(folder, name);
    if (mode === "rename" && rel === path) return closeOverlay(overlay);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        if (mode === "rename") { await rename(root, path, rel); announce({ kind: "moved", root, path, to: rel }); }
        else { await create(root, rel, mode === "new-folder"); announce({ kind: mode === "new-folder" ? "folder" : "open", root, path: rel }); }
        closeOverlay(overlay);
      } catch (e) { this.error = e instanceof Error ? e.message : String(e); this.busy = false; cx.notify(); }
    });
  }
  close() { this.input.release(); }
  render() {
    const t = /** @type {ThemeColors} */ (theme()), { mode, path = "", dir } = props() ?? {}, where = mode === "rename" ? parentOf(path) : targetFolder({ path, dir });
    return v_flex().id("name-dialog").w_full().p(16).gap(10).bg(t.popover ?? t.surface).text_color(t.foreground).text_size(12.5)
      .on_key_down((e) => { if (e.key === "escape") closeOverlay(props().overlay); })
      .child(h_flex().gap(6).items_center().child(div().font_semibold().child(TITLES[mode] ?? ""))
        .when(Boolean(where), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`in ${where}`))))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.error ? t.ansi1 : t.accent).bg(t.background))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(this.error)));
  }
}
