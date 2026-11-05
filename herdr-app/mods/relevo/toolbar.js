import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout } from "herdr";
import { withKey } from "./ui.js";

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
