import { div, image } from "gpui-kit";
import { avatarPath, loadAvatar } from "./icons.js";
import { shown } from "./timeline.js";

// A person's GitHub picture, or their initial on a tinted disc until it has downloaded.
export function avatar(name, url, size, t, cx) {
  const loading = loadAvatar(name, url);
  if (loading) cx.spawn(async (cx) => { if (await loading) cx.notify(); });
  const path = avatarPath(name);
  if (path) return image(path).size(size).flex_none().rounded(size / 2);
  const colors = [t.ansi1, t.ansi2, t.ansi3, t.ansi4, t.ansi5, t.ansi6];
  const color = colors[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % colors.length];
  return div().size(size).flex_none().rounded(size / 2).flex().items_center().justify_center().bg(color + "33")
    .text_size(Math.round(size * 0.5)).font_semibold().text_color(color).child(shown(name).slice(0, 1).toUpperCase());
}
