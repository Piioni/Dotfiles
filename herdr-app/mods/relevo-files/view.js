import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme } from "herdr";
import { FileEditor } from "./editor.js";

/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {Record<string, `#${string}`>} ThemeColors */
export class FileView {
  /** @param {unknown} _props @param {AsyncContext} cx */
  init(_props, cx) {
    const { root, file } = props() ?? {};
    this.file = file ?? "";
    if (!root || !file) return;
    this.editor = new FileEditor(`${root}/${file}`);
    this.editor.load(cx);
  }
  close() { this.editor?.close(); }
  render() {
    const t = /** @type {ThemeColors} */ (theme()), ed = this.editor;
    return v_flex().id("relevo-file-view").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12).text_color(t.muted)
        .child(div().flex_1().min_w(0).truncate().child(this.file)).when(Boolean(ed), el => el.child(ed.controls(t))))
      .child(ed ? ed.body(t) : div().p(12).text_color(t.dim).child("No file"));
  }
}
