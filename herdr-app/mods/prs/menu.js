import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, closeOverlay, openOverlay, notify } from "herdr";
import { icons, icon } from "./icons.js";

export function openUrl(url) {
  exec("sh", ["-c", 'xdg-open "$1" >/dev/null 2>&1 &', "sh", url]).catch(() => exec("open", [url]).catch(() => null));
}

const ROW = 44, PAD = 12;
// Popups take their height from the root element, so it is worked out from the rows.
const menuHeight = (items) => items.length * ROW + PAD * 2;

export const openMenu = (items) => openOverlay({ mod: "prs", kind: "popup", at: "pointer", width: 340, height: menuHeight(items), props: { menu: { items } } });

// A popup menu: props().menu = { items: [{ label, detail?, glyph?, copy? | url? }] }; a click does it and closes the popup.
export class Menu {
  constructor({ items }, overlay, cx) {
    this.items = items; this.overlay = overlay;
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
  }

  pick(item, cx) {
    if (item.copy) { cx.write_to_clipboard(item.copy); notify({ title: "Copied", body: item.copy, level: "success", timeout: 2500 }); }
    if (item.url) openUrl(item.url);
    closeOverlay(this.overlay);
  }

  render() {
    const t = theme();
    return v_flex().id("prs-menu").w_full().h(menuHeight(this.items)).p(6).bg(t.popover).text_color(t.foreground)
      .children(this.items.map((item, n) => h_flex().id(`prs-menu-${n}`).h(ROW).px(8).gap(10).flex_none().items_center().rounded(7).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(item, cx))
        .child(div().size(14).flex_none().when(this.icons && Boolean(item.glyph), (e) => e.child(svg(icon(item.glyph)).size(14).text_color(t.muted))))
        .child(v_flex().flex_1().min_w(0).child(div().text_size(13).font_medium().child(item.label))
          .when(Boolean(item.detail), (e) => e.child(div().text_size(11).text_color(t.dim).truncate().child(item.detail))))));
  }
}
