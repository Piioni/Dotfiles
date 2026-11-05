// The dialog's right column: who is reviewing now, reviewers and their verdicts, labels, linked issues, participants.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { login, shown, bot } from "./timeline.js";
import { assignArgs, reviewerArgs } from "./actions.js";
import { tone, verdict, labelChip } from "./ui.js";
import { openUrl } from "./menu.js";

function section(title, t, body, action = null) {
  return v_flex().flex_none().gap(8).py(14).border_b(1).border_color(t.border)
    .child(h_flex().items_center().text_size(12).font_semibold().text_color(t.muted)
      .child(div().flex_1().child(title)).when(Boolean(action), (e) => e.child(action)))
    .child(body);
}

// A person row: picture, name, then whatever goes on the right.
const person = (v, name, t, cx, ...right) => h_flex().gap(8).items_center().text_size(13)
  .child(v.pic(name, null, 20, t, cx)).child(div().flex_1().min_w(0).truncate().font_semibold().child(shown(name))).children(right.filter(Boolean));

export function sidebar(v, pr, t, cx) {
  const none = (text) => div().text_size(12).text_color(t.muted).child(text);
  const action = (id, label, onClick, color = t.accent) => div().id(id).text_size(12).font_normal().text_color(color).cursor_pointer().hover((s) => s.underline()).on_click(onClick).child(label);
  const open = pr.state === "OPEN", review = v.reviewInfo(pr), me = v.me, all = v.labels[v.repo];
  const busy = Boolean(v.busy), fail = v.failed?.where === "side" ? v.failed.message : null;
  const reviewing = review.reviewing.includes(me);
  const pending = (pr.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug).filter((n) => n && !review.verdicts.some((x) => x.login === n));

  const who = review.reviewing.length
    ? v_flex().gap(8).children(review.reviewing.map((name) => person(v, name, t, cx,
      name === me && open ? action("pr-stop", v.busyWhere === "side" && busy ? v.busy : "Stop", (_e, cx) => !busy && v.run(assignArgs(false), cx, "side")) : null)))
    : none("No one is reviewing");
  const join = open && me && login(pr.author) !== me && !reviewing
    ? action("pr-join", v.busyWhere === "side" && busy ? v.busy : "Start review", (_e, cx) => !busy && v.run(assignArgs(true), cx, "side")) : null;

  const linearKey = v.linearKey(pr), linear = linearKey ? { key: linearKey, issue: v.linear[linearKey] } : null;
  const reviewers = [...review.verdicts.map((x) => ({ name: x.login, state: x.state, stale: x.stale })), ...pending.map((name) => ({ name, state: "pending", stale: false }))];
  const people = new Map();
  for (const [name, url] of [[login(pr.author)], ...pr.comments.map((c) => [login(c.author)]), ...(v.timelines[v.id()] ?? []).filter((e) => e.login && e.kind !== "commits").map((e) => [e.login, e.avatar])])
    if (!bot(name)) people.set(name, people.get(name) ?? url ?? null);

  return v_flex().id("pr-sidebar").w(264).flex_none().min_h(0).overflow_y_scrollbar().pl(8).pr(24).pt(6)
    .child(section("Reviewing", t, v_flex().gap(8).child(who).when(Boolean(fail), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(fail))), join))
    .child(section("Reviewers", t, reviewers.length
      ? v_flex().gap(8).children(reviewers.map(({ name, state, stale }) => {
        const [text, glyph, color] = verdict(state, t);
        return person(v, name, t, cx,
          stale ? div().text_size(11).font_medium().text_color(tone(t, "warn")).tooltip("They reviewed an earlier commit").child("outdated") : null,
          stale && open && review.role === "author" ? div().id(`pr-rerequest-${name}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip("Request a new review").on_click((_e, cx) => !busy && v.run(reviewerArgs(name), cx, "side")).child(v.glyph("refresh", 13, t.muted)) : null,
          div().flex_none().tooltip(`${shown(name)} ${text}`).child(v.glyph(glyph, 14, color)));
      }))
      : none("No reviews yet")))
    .when(Boolean(linear), (e) => e.child(section("Linear", t, linear.issue
      ? v_flex().id("pr-linear-issue").gap(4).cursor_pointer().on_click(() => openUrl(linear.issue.url))
        .child(div().text_size(13).font_semibold().hover((s) => s.text_color(t.accent)).child(`${linear.key} ${linear.issue.title}`))
        .child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted).child(div().size(8).flex_none().rounded(4).bg(linear.issue.state.color)).child(linear.issue.state.name))
      : none(linear.issue === null ? `${linear.key} \u2014 loading\u2026` : `${linear.key} \u2014 no Linear key or issue not found`))))
    .child(section("Labels", t, v.editing
      ? (!all ? none("Loading labels…") : v_flex().gap(1).children(all.map((l) => {
        const on = pr.labels.some((x) => x.name === l.name);
        return h_flex().id(`label-${l.name}`).px(6).py(5).gap(8).items_start().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => v.toggleLabel(l, cx))
          .child(div().w(14).flex_none().text_size(12).text_color(t.accent).child(on ? "✓" : ""))
          .child(div().mt(3).size(12).flex_none().rounded(6).bg(`#${l.color}`))
          .child(v_flex().flex_1().min_w(0).child(div().text_size(13).font_semibold().child(l.name))
            .when(Boolean(l.description), (e) => e.child(div().text_size(12).text_color(t.muted).truncate().child(l.description))));
      })))
      : pr.labels.length ? h_flex().gap(4).flex_wrap().children(pr.labels.map((l) => labelChip(l, t))) : none("None yet"),
      action("pr-labels-edit", v.editing ? "Done" : "Edit", (_e, cx) => v.editLabels(cx))))
    .child(section("Linked issues", t, (pr.closingIssuesReferences ?? []).length
      ? v_flex().gap(6).children(pr.closingIssuesReferences.map((i) => h_flex().id(`pr-issue-${i.number}`).gap(8).items_center().text_size(13).cursor_pointer()
        .on_click((_e, cx) => v.link(i.url, cx)).child(v.glyph("dot", 14, t.muted)).child(div().font_semibold().hover((s) => s.text_color(t.accent)).child(`#${i.number}`))))
      : none("None yet")))
    .child(section("Participants", t, h_flex().gap(4).flex_wrap().children([...people].slice(0, 18).map(([name, url]) => v.pic(name, url, 24, t, cx)))));
}
