// The top of the dialog: where we are and the icon buttons, the title, the state line with its capsules and main button, the tabs.
// Drawn for the viewer `v`; `h` is what the header knows (from the pull request, or from the list's seed until it arrives).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, notify } from "herdr";
import { openMenu, openUrl } from "./menu.js";
import { reviewAction } from "./merge.js";
import { checks, shown } from "./timeline.js";
import { tone, plural } from "./ui.js";

const TABS = [["conversation", "Conversation"], ["commits", "Commits"], ["files", "Files changed"], ["checks", "Checks"]];
const SPINNER = "mods/workspace-chrome/spinner.svg";

const since = (at) => { const s = Math.max(0, Math.floor((Date.now() - at) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };

function iconButton(v, id, glyph, tip, t, onClick) {
  return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).border_1().border_color(t.border).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(tip).on_click(onClick).child(v.glyph(glyph, 14, t.muted));
}

// A status: a loud tinted capsule when it needs a look, a quiet glyph and word when it's the expected case (as in the list panel).
function tag(v, t, color, label, glyph, { quiet = false, tip = null } = {}) {
  return h_flex().h(22).gap(5).flex_none().items_center().text_size(12).font_medium().text_color(quiet ? t.muted : color)
    .when(!quiet, (e) => e.px(8).rounded(11).bg(color === t.muted ? t.raised : `${color}24`))
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .child(v.glyph(glyph, 12, color)).child(label);
}

const copy = (text, title) => (_e, cx) => { cx.write_to_clipboard(text); notify({ title, body: text, level: "success", timeout: 2500 }); };

function branchChip(id, name, t) {
  return div().id(id).px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_size(12).text_color(t.accent).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip("Copy branch name").on_click(copy(name, "Branch copied")).child(name);
}

export function bar(v, pr, t) {
  const message = (pr && v.error) || (v.failed?.where === "bar" ? v.failed.message : "");
  return h_flex().h(28).gap(8).items_center()
    .when(v.history.length > 0, (e) => e.child(iconButton(v, "pr-back", "back", "Back", t, (_e, cx) => v.back(cx))))
    .child(div().text_size(13).text_color(t.muted).child(`${v.repo} \u00b7 #${v.number}`))
    .child(div().flex_1().min_w(0).text_size(12).text_color(t.ansi1).truncate().child(message))
    .when(Boolean(v.busy) && v.busyWhere !== "composer", (e) => e.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
      .child(svg(SPINNER).size(12).text_color(t.working).spin(900)).child(v.busy)))
    .when(Boolean(pr) && !v.busy, (e) => e.child(div().text_size(12).text_color(t.dim).child(`Updated ${since(v.refreshedAt ?? Date.now())}`)))
    .when(Boolean(pr), (e) => e
      .child(v.loading
        ? div().size(28).flex_none().flex().items_center().justify_center().child(svg(SPINNER).size(12).text_color(t.working).spin(900))
        : iconButton(v, "pr-refresh", "refresh", "Refresh", t, (_e, cx) => { v.load(cx, true); cx.notify(); }))
      .child(iconButton(v, "pr-copy", "copy", "Copy\u2026", t, () => openMenu([
        { label: "Copy branch name", detail: pr.headRefName, glyph: "branch", copy: pr.headRefName },
        { label: "Copy URL", detail: pr.url, glyph: "link", copy: pr.url },
        { label: "Copy checkout command", detail: `gh pr checkout ${pr.number}`, glyph: "commit", copy: `gh pr checkout ${pr.number}` },
      ])))
      .child(iconButton(v, "pr-github", "external", "Open on GitHub", t, () => openUrl(pr.url))))
    .child(iconButton(v, "pr-close", "close", "Close", t, () => closeOverlay(v.overlay)));
}

// What the main slot of the state line shows for me: start reviewing, my review under way, or ask again after new commits.
function role(v, pr, t) {
  if (!pr || pr.state !== "OPEN") return [];
  const review = v.reviewInfo(pr), action = reviewAction(pr, review), busy = Boolean(v.busy), mine = v.busyWhere === "review" && busy;
  const fail = v.failed?.where === "review" ? v.failed.message : null;
  const others = review.reviewing.filter((n) => n !== v.me);
  const capsule = action.kind === "reviewing" ? tag(v, t, tone(t, "review"), "Reviewing \u00b7 you", "eye", { tip: "You are reviewing this: approving or requesting changes finishes it" })
    : others.length ? tag(v, t, tone(t, "review"), `Reviewing \u00b7 ${others.map(shown).join(", ")}`, "eye", { tip: "Being reviewed right now" }) : null;
  const button = action.kind === "start" ? v.button("pr-start-review", mine ? v.busy : "Start review", t, (_e, cx) => v.act("start", cx), { enabled: !busy && Boolean(v.me), fill: tone(t, "review"), glyph: "eye" })
    : action.kind === "rerequest" ? div().tooltip(`${action.stale.map(shown).join(", ")} reviewed an earlier commit`)
      .child(v.button("pr-rerequest", mine ? v.busy : "Re-request review", t, (_e, cx) => v.act("rerequest", cx), { enabled: !busy, glyph: "refresh" })) : null;
  return [fail ? div().min_w(0).truncate().text_size(12).text_color(t.ansi1).child(fail) : null, capsule, button].filter(Boolean);
}

export function header(v, h, pr, t) {
  const open = h.state === "OPEN", merged = h.state === "MERGED", closed = h.state === "CLOSED";
  const behind = open ? v.compares[v.id()]?.behind ?? 0 : 0, n = pr?.commits.length ?? 0;
  const count = pr ? { commits: n, files: pr.changedFiles, checks: checks(pr.statusCheckRollup).length } : {};
  const state = merged ? tag(v, t, tone(t, "merged"), "Merged", "merged") : closed ? tag(v, t, tone(t, "bad"), "Closed", "closed")
    : h.draft ? tag(v, t, t.muted, "Draft", "draft", { quiet: true }) : tag(v, t, tone(t, "ok"), "Open", "open", { quiet: true });
  return v_flex().flex_none().px(32).pt(14).gap(12).border_b(1).border_color(t.border)
    .child(bar(v, pr, t))
    .child(h_flex().flex_wrap().gap_x(7).text_size(22).font_semibold()
      .children(h.title.split(/\s+/).filter(Boolean).map((w) => div().child(w)))
      .child(div().font_normal().text_color(t.dim).child(`#${v.number}`)))
    .child(h_flex().gap_x(12).gap_y(8).items_center().flex_wrap()
      .child(state)
      .child(h_flex().gap(6).items_center().flex_wrap().text_size(13).text_color(t.muted)
        .when(Boolean(h.author), (e) => e.child(div().font_semibold().text_color(t.foreground).child(shown(h.author))))
        .child(`${merged ? "merged" : "wants to merge"}${pr ? ` ${plural(n, "commit")}` : ""} into`)
        .child(branchChip("pr-base", h.base, t)).child("\u2190").child(branchChip("pr-head", h.head, t)))
      .child(h_flex().gap(6).text_size(13).font_semibold().child(div().text_color(t.ansi2).child(`+${h.adds}`)).child(div().text_color(t.ansi1).child(`\u2212${h.dels}`)))
      .when(open && h.conflicts, (e) => e.child(tag(v, t, tone(t, "bad"), "Conflicts", "alert", { tip: "This branch has conflicts with the base branch" })))
      .when(behind > 0, (e) => e.child(tag(v, t, tone(t, "warn"), `${behind} behind`, "behind", { tip: `${plural(behind, "commit")} behind ${h.base}` })))
      .child(div().flex_1())
      .children(role(v, pr, t)))
    .child(h_flex().gap(4).h(40).items_end()
      .children(TABS.map(([id, label]) => h_flex().id(`pr-tab-${id}`).h_full().px(8).gap(6).flex_none().items_center().text_size(13).cursor_pointer()
        .border_b(2).border_color(v.tab === id ? t.accent : "#00000000").text_color(v.tab === id ? t.foreground : t.muted).when(v.tab === id, (e) => e.font_semibold())
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { v.tab = id; cx.notify(); })
        .child(label).when(Boolean(count[id]), (e) => e.child(div().text_size(11).font_normal().text_color(t.dim).child(String(count[id])))))));
}
