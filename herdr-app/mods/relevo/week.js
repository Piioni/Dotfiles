import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, notify, openOverlay } from "herdr";
import { weekOf } from "./ledger.js";
import { duration } from "./lib/time.js";
import { weekTable } from "./lib/ledger.js";
import { button, spinner } from "./ui.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (s, i) => `${DAYS[i]} ${new Date(s * 1000).getDate()}`;
const COL = 52;

export function openWeek() {
  openOverlay({ mod: "relevo", kind: "dialog", width: 720, height: 460, props: { role: "ledger-week" } });
}

// Agent time per ticket and day, for filling the weekly time tracker.
export class LedgerWeek {
  init(_props, cx) {
    this.offset = 0;
    this.load(cx);
  }

  load(cx) {
    this.data = null;
    cx.notify();
    const offset = this.offset;
    cx.spawn(async (cx) => {
      const data = await weekOf(offset);
      if (offset !== this.offset) return;
      this.data = data;
      cx.notify();
    });
  }

  move(by, cx) {
    this.offset += by;
    this.load(cx);
  }

  copy(cx) {
    const text = weekTable(this.data, (s) => label(s, this.data.days.indexOf(s)), duration);
    cx.write_to_clipboard(text);
    notify({ title: "Week copied", body: "Paste it as a table", level: "success", timeout: 2000 });
  }

  title() {
    if (!this.data) return "Agent time";
    const d = new Date(this.data.days[0] * 1000);
    return `Agent time · week of ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  row(t, id, name, sub, cells, total, strong = false) {
    const today = new Date().setHours(0, 0, 0, 0) / 1000;
    return h_flex().id(id).h(28).px(10).gap(4).items_center().rounded(6).flex_none()
      .when(strong, (el) => el.font_semibold().border_t(1).border_color(t.border))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12).text_color(t.foreground).child(name))
        .when(Boolean(sub), (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(sub))))
      .children(cells.map((s, i) => div().w(COL).flex_none().text_right().text_size(11.5)
        .when(this.data.days[i] === today, (el) => el.text_color(t.accent))
        .when(this.data.days[i] !== today, (el) => el.text_color(s ? t.foreground : t.dim))
        .child(s >= 60 ? duration(s) : "·")))
      .child(div().w(COL + 8).flex_none().text_right().text_size(11.5).font_semibold().child(duration(total)));
  }

  render() {
    const t = theme(), w = this.data;
    const header = h_flex().h(44).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().font_semibold().text_size(13).child(this.title()))
      .child(button(t, "week-prev", "‹", (cx) => this.move(-1, cx), { tip: "Previous week" }))
      .child(button(t, "week-next", "›", (cx) => this.move(1, cx), { tip: "Next week", disabled: this.offset >= 0 }))
      .child(button(t, "week-copy", "Copy", (cx) => this.copy(cx), { disabled: !w?.rows.length, tip: "Copy as a table" }));
    const body = !w
      ? h_flex().flex_1().justify_center().items_center().child(spinner(t.dim))
      : !w.rows.length
        ? h_flex().flex_1().justify_center().items_center().text_size(12).text_color(t.dim).child("No agent time this week")
        : v_flex().id("week-rows").flex_1().min_h(0).overflow_y_scrollbar().p(6)
          .child(h_flex().h(22).px(10).gap(4).items_center().text_size(10.5).text_color(t.dim)
            .child(div().flex_1().child("TICKET"))
            .children(w.days.map((s, i) => div().w(COL).flex_none().text_right().child(label(s, i))))
            .child(div().w(COL + 8).flex_none().text_right().child("TOTAL")))
          .children(w.rows.map((r) => this.row(t, `week-${r.key}`, r.key, r.jira ? r.repo : null, r.days, r.total)))
          .child(this.row(t, "week-total", "Total", null, w.dayTotals, w.total, true));
    return v_flex().id("ledger-week").size_full().bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(header)
      .child(body);
  }
}
