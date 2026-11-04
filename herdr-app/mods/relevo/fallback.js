import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, run, closeOverlay } from "herdr";
import { LAUNCHERS, launchArgv } from "./accounts.js";
import { button } from "./ui.js";

const nameOf = (/** @type {string} */ key) => LAUNCHERS.find((l) => l.key === key)?.label ?? key;

// Asked when a launcher's account is at 100% and another one has room: opening never switches account on its own.
export class Fallback {
  /** @param {string} key a launcher key */
  open(key) {
    const p = props(), launcher = LAUNCHERS.find((l) => l.key === key);
    closeOverlay(p?.overlay);
    if (launcher) run("tab.new", { folder: p?.folder, argv: launchArgv(launcher) });
  }

  render() {
    const t = /** @type {Record<string, `#${string}`>} */ (theme()), p = props() ?? {};
    return v_flex().id("fallback").size_full().p(18).gap(16).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(v_flex().gap(4)
        .child(div().font_semibold().text_size(14).child(p.note))
        .child(div().text_size(12).text_color(t.muted).child(`Open ${nameOf(p.requested)} anyway, or use ${nameOf(p.alternative)} instead?`)))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "fallback-anyway", "Open anyway", () => this.open(p.requested), { size: "lg" }))
        .child(button(t, "fallback-switch", "Use the other account", () => this.open(p.alternative), { kind: "solid", size: "lg" })));
  }
}
