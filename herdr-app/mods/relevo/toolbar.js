import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout, shared, setShared } from "herdr";
import { withKey } from "./ui.js";

export const COUNT = "relevo.inbox.count";
// The count when the Inbox was last open: a higher one pulses the badge.
const SEEN_COUNT = "relevo.inbox.seen";

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
};

export function showPanel(child) {
  run("layout.select", { stack: "panel-body", child });
  run("layout.show", { id: "panel" });
}

export class InboxButton {
  render() {
    const t = theme();
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    const on = panel && !panel.hidden && body?.active === "inbox";
    const n = shared(COUNT) ?? 0, stored = shared(SEEN_COUNT), seen = stored ?? n;
    if (stored == null || (on ? seen !== n : n < seen)) setShared(SEEN_COUNT, n);
    const fresh = !on && n > seen;
    return h_flex().id("inbox-button").size_full().items_center().justify_center()
      .bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("inbox-toggle").h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(12)
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .tooltip(withKey(on ? "Hide the Inbox" : "Show the Inbox", "relevo.panel-inbox"))
        .on_click(() => (on ? run("layout.hide", { id: "panel" }) : showPanel("inbox")))
        .child("Inbox")
        .when(n > 0, (el) => el.child(
          div().px(5).rounded(8).bg(t.blocked).text_color(t.background).text_size(10).font_semibold()
            .when(fresh, (b) => b.loop("opacity", { from: 0.45, to: 1, period: 1400 }))
            .child(String(n)))));
  }
}

// Mirrors the left sidebar's toggle at the window's other edge.
export class PanelToggle {
  render() {
    const t = theme(), panel = find(layout(), "panel"), on = Boolean(panel && !panel.hidden);
    return h_flex().id("panel-toggle-bar").size_full().items_center().justify_center()
      .bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().id("panel-toggle").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(withKey(on ? "Hide panel" : "Show panel", "layout.toggle:panel"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => run("layout.toggle", { id: "panel" }))
        .child(svg("mods/relevo/panel.svg").size(15)));
  }
}
