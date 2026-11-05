// The merge box of the conversation: one icon, a bordered column of status rows and a footer with the merge button.
// Drawn for the viewer `v` (its state, glyphs and buttons); what it says comes from merge.js.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { mergeBox, commandLine } from "./merge.js";
import { openMenu, openUrl } from "./menu.js";
import { ago } from "./timeline.js";
import { tone, hairline, plural } from "./ui.js";

const MAX_FILES = 10, SPINNER = "mods/workspace-chrome/spinner.svg";
const METHODS = { merge: "Merge", squash: "Squash", rebase: "Rebase" };

function mark(v, glyph, size, color) {
  return glyph === "spinner" ? div().size(size).flex_none().child(svg(SPINNER).size(size).text_color(color).spin(900)) : v.glyph(glyph, size, color);
}

function actionButtons(v, pr, a, t) {
  const busy = Boolean(v.busy), mine = v.busyWhere === a.kind && busy;
  if (a.kind === "resolve") {
    const cmd = commandLine(pr.headRefName, pr.baseRefName), tree = v.worktrees[v.id()];
    return v.button("pr-resolve", "Resolve conflicts", t, () => openMenu([
      { label: "Open the web editor", detail: "Resolve the conflicts on github.com", glyph: "external", url: `${pr.url}/conflicts` },
      { label: "Copy command-line instructions", detail: cmd, glyph: "copy", copy: cmd },
      ...(tree ? [{ label: "Open terminal in worktree", detail: tree, glyph: "commit", command: { name: "terminal.open", args: { folder: tree, name: pr.headRefName } } }] : []),
    ]), { trail: "chev-d" });
  }
  if (a.kind === "update" && v.confirm === "update") return h_flex().gap(8)
    .child(v.button("pr-update-confirm", "Update branch", t, (_e, cx) => v.act("update", cx), { enabled: !busy, fill: t.ansi3, ink: t.background }))
    .child(v.button("pr-update-cancel", "Cancel", t, (_e, cx) => { v.confirm = null; cx.notify(); }));
  const go = a.kind === "update" && a.confirm ? (_e, cx) => { v.confirm = "update"; cx.notify(); } : (_e, cx) => v.act(a.kind, cx);
  return v.button(`pr-${a.kind}`, mine ? v.busy : a.label, t, go, { enabled: !busy, glyph: a.kind === "update" ? "behind" : null });
}

function row(v, pr, r, t) {
  const c = tone(t, r.tone), a = r.action, loud = r.tone === "bad" || r.tone === "warn";
  const fail = a && v.failed?.where === a.kind ? v.failed.message : null;
  const detail = [r.detail, r.at ? ago(r.at) : null, r.tail].filter(Boolean).join(r.at ? " " : " · ").replace(` ${r.tail}`, ` · ${r.tail}`);
  return h_flex().id(`pr-mrow-${r.key}`).px(16).py(12).gap(12).items_start()
    .when(loud, (e) => e.bg(`${c}0f`))
    .child(div().mt(1).child(mark(v, r.glyph, 16, c)))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(r.title))
      .when(Boolean(detail), (e) => e.child(div().text_size(12).text_color(t.muted).child(detail)))
      .when(Boolean(r.loading), (e) => e.child(div().text_size(12).text_color(t.dim).child("Checking the conflicting files…")))
      .when(r.files?.length > 0, (e) => e.child(v_flex().gap(3).mt(4)
        .when(r.approx, (x) => x.child(div().text_size(12).text_color(t.dim).child("Files changed on both branches (may conflict)")))
        .children(r.files.slice(0, MAX_FILES).map((f) => h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
          .child(v.glyph("file", 12, t.dim)).child(div().min_w(0).truncate().child(f))))
        .when(r.files.length > MAX_FILES, (x) => x.child(div().text_size(12).text_color(t.dim).child(`and ${r.files.length - MAX_FILES} more`)))))
      .when(a?.kind === "update" && v.confirm === "update", (e) => e.child(div().text_size(12).text_color(t.ansi3).child(a.confirm)))
      .when(Boolean(fail), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(fail))))
    .when(Boolean(a), (e) => e.child(actionButtons(v, pr, a, t)))
    .when(Boolean(r.items), (e) => e.child(div().id("pr-checks-toggle").h(32).px(10).flex_none().flex().items_center().rounded(6).text_size(13).text_color(t.accent)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { v.checksOpen = !v.checksOpen; cx.notify(); }).child(v.checksOpen ? "Hide" : "Show")));
}

// The checks of the row, one line each: outcome glyph, workflow / name, how long it took; a click opens the run.
function checkList(v, items, t) {
  const tint = { passing: t.ansi2, failing: t.ansi1, pending: t.ansi3, skipped: t.muted };
  const glyph = { passing: "check", failing: "x", pending: "dot", skipped: "dot" };
  return v_flex().children(items.flatMap((c, n) => [...(n ? [hairline(t)] : []), h_flex().id(`pr-mcheck-${n}`).px(16).py(7).gap(10).items_center().text_size(13)
    .when(Boolean(c.url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(c.url)))
    .child(v.glyph(glyph[c.outcome], 14, tint[c.outcome]))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
    .when(Boolean(c.took), (e) => e.child(div().text_size(12).text_color(t.muted).child(c.took)))]));
}

function footer(v, pr, box, t) {
  const m = box.merge, busy = Boolean(v.busy), merging = v.busyWhere === "merge" && busy, confirming = v.confirm === "merge" && m.enabled;
  const fail = v.failed?.where === "merge" ? v.failed.message : null, n = pr.commits.length;
  return h_flex().px(16).py(12).gap(10).items_center().flex_wrap().bg(t.raised).border_t(1).border_color(t.border)
    .when(confirming, (e) => e
      .child(div().text_size(13).font_medium().child(`Merge ${plural(n, "commit")} into ${pr.baseRefName}?`))
      .child(v.button("pr-merge-confirm", merging ? v.busy : "Confirm merge", t, (_e, cx) => v.act("merge", cx), { enabled: !busy, fill: t.ansi2, ink: t.background, glyph: "merged" }))
      .child(v.button("pr-merge-cancel", "Cancel", t, (_e, cx) => { v.confirm = null; cx.notify(); }, { enabled: !busy })))
    .when(!confirming, (e) => e
      .child(v.button("pr-merge", merging ? v.busy : "Merge pull request", t, (_e, cx) => { v.confirm = "merge"; cx.notify(); }, { enabled: m.enabled && !busy, fill: t.ansi2, ink: t.background, glyph: "merged" }))
      .when(m.methods.length > 1, (x) => x.child(h_flex().p(2).gap(2).rounded(7).bg(t.background).children(m.methods.map((k) => div().id(`pr-method-${k}`).h(24).px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .bg(k === m.method ? t.selected : "#00000000").text_color(k === m.method ? t.foreground : t.muted)
        .on_click((_e, cx) => { v.method = k; cx.notify(); }).child(METHODS[k])))))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(m.reason ?? m.note ?? "")))
    .when(Boolean(fail), (e) => e.child(div().w_full().text_size(12).text_color(t.ansi1).child(fail)));
}

function shell(v, glyph, color, rows, foot, t) {
  return h_flex().gap(12).items_start()
    .child(div().size(40).flex_none().rounded(20).flex().items_center().justify_center().bg(color === t.muted ? t.raised : `${color}24`).child(mark(v, glyph, 20, color)))
    .child(v_flex().flex_1().min_w(0).rounded(8).border_1().border_color(t.border).overflow_hidden().bg(t.background)
      .children(rows.flatMap((r, n) => (n ? [hairline(t), r] : [r])))
      .when(Boolean(foot), (e) => e.child(foot)));
}

export function mergeView(v, pr, t) {
  const box = mergeBox(pr, v.mergeCtx(pr)), worst = box.rows.find((r) => r.tone === box.tone) ?? box.rows[0];
  return v_flex().flex_none().gap(10)
    .child(shell(v, worst.glyph, tone(t, box.tone), box.rows.flatMap((r) => [row(v, pr, r, t), ...(r.items && v.checksOpen ? [checkList(v, r.items, t)] : [])]), box.merge.show ? footer(v, pr, box, t) : null, t))
    .when(box.draftLink, (e) => e.child(h_flex().gap(4).pl(52).text_size(12).text_color(t.muted).child("Still in progress?")
      .child(div().id("pr-draft-link").text_color(t.accent).cursor_pointer().hover((s) => s.underline())
        .on_click((_e, cx) => v.act("draft", cx)).child(v.failed?.where === "draft" ? `Convert to draft failed: ${v.failed.message}` : "Convert to draft"))));
}

// While the pull request loads: the box is there already, saying it's checking.
export function mergeSkeleton(v, t) {
  return shell(v, "spinner", t.muted, [h_flex().px(16).py(12).gap(12).items_center()
    .child(mark(v, "spinner", 16, t.muted)).child(div().text_size(14).text_color(t.muted).child("Checking…"))], null, t);
}
