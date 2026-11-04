import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, readTextFile, theme } from "herdr";
import { relevoKeys, formatShortcut } from "./lib/keys.js";

const SIZES = {
  sm: { h: 20, px: 7, text: 11, radius: 5 },
  md: { h: 24, px: 9, text: 11.5, radius: 6 },
  lg: { h: 28, px: 12, text: 11.5, radius: 6 },
};

// kind: "outline" (default), "solid" or "danger". A disabled button keeps its place and ignores clicks.
export function button(t, id, label, onClick, { kind = "outline", size = "md", tip = null, disabled = false } = {}) {
  const s = SIZES[size];
  const quiet = size === "sm" ? t.muted : t.foreground;
  return div().id(id).h(s.h).px(s.px).flex_none().flex().items_center().gap(5).rounded(s.radius).text_size(s.text)
    .when(disabled, (el) => el.bg(t.raised).text_color(t.dim))
    .when(!disabled && kind === "solid", (el) => el.bg(t.solid).text_color(t.solid_foreground).cursor_pointer())
    .when(!disabled && kind === "outline", (el) => el.border_1().border_color(t.border).text_color(quiet).cursor_pointer()
      .hover((st) => st.bg(t.hover).text_color(t.foreground)))
    .when(!disabled && kind === "danger", (el) => el.border_1().border_color(t.blocked).text_color(t.blocked).cursor_pointer()
      .hover((st) => st.bg(t.hover)))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(!disabled, (el) => el.on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    }))
    .children(Array.isArray(label) ? label : [label]);
}

// A list section's title with its count or total on the right.
export const sectionHeader = (t, label, right) =>
  h_flex().pt(6).px(2).justify_between().text_size(10.5).text_color(t.dim).child(label).child(String(right));

// Shortcuts come from keys.json, so a tooltip never shows a key that changed.
let keys = {};

export async function loadKeys() {
  try {
    keys = relevoKeys(JSON.parse(await readTextFile(`${appHome()}/keys.json`) ?? "{}"));
  } catch {
    keys = {};
  }
}

export const shortcut = (action) => formatShortcut(keys[action]);

export const withKey = (tip, action) => (shortcut(action) ? `${tip} · ${shortcut(action)}` : tip);

// Native rotation: no timer, no redraws.
export const spinner = (color, size = 11) => svg("mods/relevo/spinner.svg").size(size).text_color(color).spin(900);

// The agent's own logo in a fixed square so Claude, Codex and Pi line up. Pi's is a one-color glyph: it follows the theme.
/** @param {string} app claude, codex or pi @param {number} [size] */
export const agentIcon = (app, size = 16) => div().size(size).flex_none().flex().items_center().justify_center()
  .child(app === "pi" ? svg("icons/pi.svg").size(size * 0.85).text_color(theme().foreground) : image(`icons/${app === "codex" ? "codex" : "claude"}.svg`).size(size));
