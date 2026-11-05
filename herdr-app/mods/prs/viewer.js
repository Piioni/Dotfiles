import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { exec, theme, notify, setShared } from "herdr";
import { icons, icon } from "./icons.js";
import { avatar } from "./people.js";
import { blocks, picture, failed, loadPicture } from "./pictures.js";
import { timeline, checks, login, shown, bot, reactions, ago, assignWords } from "./timeline.js";
import { reviewArgs, commentArgs, stateArgs, readyArgs, assignArgs, labelArgs, mergeArgs, updateBranchArgs, draftArgs, reviewerArgs, finishReviewArgs } from "./actions.js";
import { mergeBox, reviewState, reviewAction, nextPoll } from "./merge.js";
import { repoSettings, compare, conflictFiles } from "./mergeload.js";
import { mergeView, mergeSkeleton } from "./mergebox.js";
import { openUrl } from "./menu.js";
import { tone, verdict, labelChip } from "./ui.js";
import { header, bar } from "./header.js";
import { sidebar } from "./sidebar.js";

const DETAIL = "number,title,body,author,state,isDraft,labels,assignees,reviewRequests,latestReviews,reviewDecision,comments,commits,files,statusCheckRollup,headRefName,baseRefName,additions,deletions,changedFiles,createdAt,updatedAt,mergedAt,mergedBy,mergeable,mergeStateStatus,headRefOid,isCrossRepository,headRepositoryOwner,url,milestone,reactionGroups,closingIssuesReferences";
// What can change under an open dialog; a change in updatedAt or the head commit reloads everything, the rest is patched in.
const LIGHT = "state,isDraft,mergeable,mergeStateStatus,headRefOid,updatedAt,reviewDecision,assignees,statusCheckRollup";
const COMPARE_EVERY = 120000;
// Repository settings don't change while a dialog is open: one fetch per repo, shared by every dialog.
const SETTINGS = {};

const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/;
const ROLES = { OWNER: "Owner", MEMBER: "Member", COLLABORATOR: "Collaborator", CONTRIBUTOR: "Contributor" };

// #123 and owner/repo#123 outside code become links, as on GitHub.
function linkify(markdown, repo) {
  return markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, n) => n % 2 ? part
    : part.replace(/(^|[\s(])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g, (_m, pre, other, number) =>
      `${pre}[${other ?? ""}#${number}](https://github.com/${other ?? repo}/issues/${number})`)).join("");
}

// One pull request in a dialog: { repo, number, on, me?, cwd?, seed? } from the panel. seed is what the list knew (title, author,
// branches, size) so the header draws at once; cwd is a clone of the repo, for finding the conflicting files.
// The summary and the timeline load behind it; links to other issues and pull requests open here, with Back to return.
export class Viewer {
  constructor({ repo, number, on, title, me, cwd, seed }, overlay, cx) {
    this.repo = repo; this.number = number; this.on = on; this.me = me; this.overlay = overlay; this.cwd = cwd ?? null; this.seed = seed ?? (title ? { title } : null);
    this.history = []; this.cache = {}; this.timelines = {}; this.labels = {}; this.tab = "conversation"; this.mode = "write";
    this.compares = {}; this.conflicts = {}; this.confirm = null; this.method = null; this.actedAt = 0; this.nextAt = 0;
    this.reply = TextareaState.new({ placeholder: "Use Markdown to format your comment" });
    this.reply.set_auto_grow(4, 14);
    this.reply.on("change", (_e, cx) => { const has = Boolean(this.reply.value().trim()); if (has !== this.replying) { this.replying = has; cx.notify(); } });
    this.reply.on("submit", (e, cx) => { if (e.secondary) this.comment(cx); });
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
    this.load(cx);
    cx.timer.every(5000, (cx) => this.poll(cx));
  }

  id() { return `${this.repo}#${this.number}`; }

  // fresh: also look again at how far behind the base it is, whatever was cached.
  load(cx, fresh = false) {
    const repo = this.repo, number = this.number, id = this.id(), current = () => this.id() === id;
    this.pr = this.cache[id] ?? null; this.error = null; this.loading = true;
    if (fresh) delete this.compares[id];
    const gh = async (args) => {
      const r = await exec("gh", args, { on: this.on });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      return JSON.parse(r.stdout);
    };
    cx.spawn(async (cx) => {
      try {
        const [pr, pages, inline] = await Promise.all([
          gh(["pr", "view", String(number), "-R", repo, "--json", DETAIL]),
          gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/timeline?per_page=100`]).catch(() => null),
          gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/comments?per_page=100`]).catch(() => []),
        ]);
        this.cache[id] = pr;
        if (pages) this.timelines[id] = timeline(pages.flat(), inline.flat());
        if (current()) { this.pr = pr; this.refreshedAt = Date.now(); this.nextAt = Date.now() + nextPoll(pr, { actedAt: this.actedAt }); }
      } catch (e) { if (current()) this.error = String(e?.message ?? e); }
      finally {
        if (current()) { this.loading = false; cx.notify(); if (this.pr) { this.loadSettings(cx); this.loadMerge(cx); } }
      }
    });
  }

  settingsKey() { return `${this.on ?? ""}|${this.repo}`; }

  loadSettings(cx) {
    const key = this.settingsKey(), repo = this.repo;
    if (SETTINGS[key] || this.fetching === key) return;
    this.fetching = key;
    cx.spawn(async (cx) => {
      try { SETTINGS[key] = await repoSettings(repo, this.on); } catch { /* retried with the next load */ }
      finally { this.fetching = null; cx.notify(); }
    });
  }

  // How far behind the base it is, and for a conflicting one which files; never blocks the rest of the dialog.
  loadMerge(cx) {
    const pr = this.pr, id = this.id(), repo = this.repo;
    if (pr?.state !== "OPEN") return;
    cx.spawn(async (cx) => {
      try {
        let cmp = this.compares[id];
        if (!cmp || cmp.headOid !== pr.headRefOid || Date.now() - cmp.at > COMPARE_EVERY) { cmp = await compare(repo, pr, this.on); this.compares[id] = cmp; cx.notify(); }
        const key = `${cmp.baseSha}..${pr.headRefOid}`;
        if (pr.mergeable === "CONFLICTING" && !this.conflicts[key]) {
          this.conflicts[key] = "loading"; cx.notify();
          this.conflicts[key] = await conflictFiles(repo, pr, cmp, this.cwd, this.on);
        }
      } catch { /* the box simply stays without the numbers */ }
      finally { cx.notify(); }
    });
  }

  // Looks again when it's due (nextPoll): a light query, and everything again only if the pull request really changed.
  poll(cx) {
    const pr = this.pr, id = this.id();
    if (!pr) return;
    cx.notify();
    if (this.loading || this.busy || Date.now() < this.nextAt) return;
    this.nextAt = Date.now() + nextPoll(pr, { actedAt: this.actedAt });
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["pr", "view", String(this.number), "-R", this.repo, "--json", LIGHT], { on: this.on });
        if (r.code !== 0 || this.id() !== id || this.pr !== pr) return;
        const next = JSON.parse(r.stdout);
        if (next.updatedAt !== pr.updatedAt || next.headRefOid !== pr.headRefOid) { this.load(cx); return; }
        const merge = next.mergeable !== pr.mergeable || next.mergeStateStatus !== pr.mergeStateStatus;
        Object.assign(pr, next);
        this.refreshedAt = Date.now(); this.nextAt = Date.now() + nextPoll(pr, { actedAt: this.actedAt });
        if (merge) this.loadMerge(cx);
      } catch { /* the next tick tries again */ }
      finally { cx.notify(); }
    });
  }

  go(repo, number, cx) {
    if (repo === this.repo && number === this.number) return;
    this.history.push({ repo: this.repo, number: this.number, tab: this.tab });
    this.repo = repo; this.number = number; this.seed = null; this.tab = "conversation"; this.editing = false; this.confirm = null; this.failed = null;
    this.load(cx); cx.notify();
  }

  back(cx) {
    const prev = this.history.pop();
    if (!prev) return;
    Object.assign(this, { repo: prev.repo, number: prev.number, tab: prev.tab, seed: null, confirm: null, failed: null });
    this.load(cx); cx.notify();
  }

  link(url, cx) {
    const m = ISSUE_URL.exec(url);
    if (m) this.go(m[1], Number(m[2]), cx); else openUrl(url);
  }

  // ---- changes: each runs gh on this pull request, reloads it and tells the panel ----

  // One action or a list, in order, stopping at the first that fails. `where` names the button that launched it:
  // a failure shows next to that button (bar = the top bar), and its busy text shows on it. `after` runs once the first action went through.
  run(actions, cx, where = "bar", after = null) {
    const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
    if (!list.length || this.busy) return;
    const repo = this.repo, number = this.number, id = this.id();
    this.busy = list[0].busy ?? "Saving…"; this.busyWhere = where; this.failed = null; this.confirm = null;
    cx.spawn(async (cx) => {
      try {
        for (const [n, { label, args }] of list.entries()) {
          const r = await exec("gh", ["pr", args[0], String(number), "-R", repo, ...args.slice(1)], { on: this.on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
          this.actedAt = Date.now();
          if (n === 0) after?.();
          notify({ title: label, body: `${repo}#${number}`, level: "success", timeout: 2500 });
        }
      } catch (e) { this.failed = { where, message: String(e?.message ?? e) }; }
      finally {
        this.busy = null;
        setShared("prs.changed", { repo, number, at: Date.now() });
        if (this.id() === id) this.load(cx, true);
        cx.notify();
      }
    });
    cx.notify();
  }

  // What the merge box's buttons do; the box asks for confirmation before calling merge or a push to someone else's branch.
  act(kind, cx) {
    const pr = this.pr;
    if (kind === "merge") return this.run(mergeArgs(mergeBox(pr, this.mergeCtx(pr)).merge.method, pr.headRefOid), cx, "merge");
    if (kind === "update") return this.run(updateBranchArgs(), cx, "update");
    if (kind === "ready") return this.run(readyArgs(), cx, "ready");
    if (kind === "reopen") return this.run(stateArgs(false, ""), cx, "reopen");
    if (kind === "draft") return this.run(draftArgs(), cx, "draft");
    // The header's main button: start reviewing (assign me), or ask those whose review predates the last commit to look again.
    if (kind === "start") return this.run(assignArgs(true), cx, "review");
    if (kind === "rerequest") return this.run(reviewAction(pr, this.reviewInfo(pr)).stale.map(reviewerArgs), cx, "review");
  }

  reviewInfo(pr) { return reviewState(pr, this.timelines[this.id()] ?? null, this.me); }

  mergeCtx(pr) {
    const id = this.id(), cmp = this.compares[id] ?? null, items = this.timelines[id] ?? null, key = cmp && `${cmp.baseSha}..${pr.headRefOid}`;
    return { me: this.me, repo: SETTINGS[this.settingsKey()] ?? null, compare: cmp, conflicts: key ? this.conflicts[key] ?? null : null,
      review: this.reviewInfo(pr), method: this.method, branchDeleted: Boolean(items?.some((e) => e.kind === "branchdeleted")) };
  }

  cleared() { this.reply.set_value(""); this.replying = false; this.mode = "write"; }

  comment(cx) { this.run(commentArgs(this.reply.value()), cx, "composer", () => this.cleared()); }

  review(kind, cx) { this.run(reviewArgs(kind, this.reply.value()), cx, "composer", () => this.cleared()); }

  setState(close, cx) { this.run(stateArgs(close, this.reply.value()), cx, "composer", () => this.cleared()); }

  // Approving or requesting changes while I'm one of the assignees also ends my review: review, then unassign me.
  finish(kind, cx) { this.run(finishReviewArgs(kind, this.reply.value()), cx, "composer", () => this.cleared()); }

  ready(cx) { this.run(readyArgs(), cx, "composer"); }

  // Shows the change at once; the reload after gh confirms it.
  toggleLabel(l, cx) {
    const has = this.pr.labels.some((x) => x.name === l.name);
    this.pr.labels = has ? this.pr.labels.filter((x) => x.name !== l.name) : [...this.pr.labels, l];
    this.run(labelArgs(l.name, has), cx);
  }

  editLabels(cx) {
    this.editing = !this.editing;
    const repo = this.repo;
    if (this.editing && !this.labels[repo]) cx.spawn(async (cx) => {
      const r = await exec("gh", ["label", "list", "-R", repo, "--limit", "200", "--json", "name,color,description"], { on: this.on }).catch(() => null);
      this.labels[repo] = r?.code === 0 ? JSON.parse(r.stdout).sort((a, b) => a.name.localeCompare(b.name)) : [];
      cx.notify();
    });
    cx.notify();
  }

  // ---- drawing ----

  pic(name, url, size, t, cx) { return avatar(name, url, size, t, cx); }

  glyph(name, size, color) { return div().size(size).flex_none().when(this.icons, (e) => e.child(svg(icon(name)).size(size).text_color(color))); }

  button(id, label, t, onClick, { glyph = null, enabled = true, fill = null, tint = null, trail = null, ink = t.background } = {}) {
    const solid = fill && enabled;
    return h_flex().id(id).h(32).px(12).gap(6).flex_none().items_center().justify_center().rounded(6).text_size(13).font_medium()
      .bg(solid ? fill : t.raised).border_1().border_color(solid ? fill : t.border).text_color(solid ? ink : enabled ? t.foreground : t.dim)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(solid ? `${fill}dd` : t.hover)).on_click(onClick))
      .when(Boolean(glyph), (e) => e.child(this.glyph(glyph, 14, solid ? ink : tint ?? t.muted)))
      .when(label !== "", (e) => e.child(label))
      .when(Boolean(trail), (e) => e.child(this.glyph(trail, 12, solid ? ink : t.muted)));
  }

  badge(label, t) {
    return div().h(20).px(7).flex_none().flex().items_center().rounded(10).border_1().border_color(t.border).text_size(12).text_color(t.muted).child(label);
  }

  markdown(key, body, t, cx) {
    const parts = blocks(body);
    return v_flex().gap(12).children(parts.map((b, n) => b.image ? this.picture(`${key}-${n}`, b, t, cx)
      : TextView.markdown(`${key}-${n}`, linkify(b.text, this.repo)).selectable(true).on_link_click((url, cx) => this.link(url, cx))));
  }

  picture(key, b, t, cx) {
    const loading = loadPicture(b.image);
    if (loading) cx.spawn(async (cx) => { await loading; cx.notify(); });
    const p = picture(b.image);
    if (!p) return div().h(failed(b.image) ? 36 : 120).w_full().flex_none().rounded(6).border_1().border_color(t.border).bg(t.raised)
      .flex().items_center().justify_center().px(12).text_size(12).text_color(t.muted).truncate()
      .child(failed(b.image) ? `Image could not be loaded${b.alt ? `: ${b.alt}` : ""}` : "Loading image…");
    const room = Math.max(240, (this.width ?? 1100) - 380), w = Math.min(b.width ?? p.width, room), h = Math.round(p.height * w / p.width);
    return div().id(key).flex_none().cursor_pointer().on_click(() => openUrl(p.file)).child(image(p.path).w(w).h(h).rounded(6));
  }

  // A card: avatar, who and when on its header bar, roles on the right, then the body.
  card(key, c, t, cx, { head = null, glyph = null, tint = null, extra = [] } = {}) {
    const author = login(this.pr.author);
    const empty = c.first ? "No description provided." : null;
    return v_flex().flex_none().rounded(6).border_1().border_color(c.state === "approved" ? `${tone(t, "ok")}88` : c.state === "changes_requested" ? `${tone(t, "bad")}88` : t.border).overflow_hidden().bg(t.background)
      .child(h_flex().h(38).px(12).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border).text_size(13)
        .child(this.pic(c.login, c.avatar, 20, t, cx))
        .child(div().font_semibold().text_color(t.foreground).child(shown(c.login)))
        .when(bot(c.login), (e) => e.child(this.badge("bot", t)))
        .when(Boolean(glyph), (e) => e.child(this.glyph(glyph, 14, tint ?? t.muted)))
        .child(div().text_color(t.muted).child(head ?? (c.first ? `opened ${ago(c.at)}` : ago(c.at))))
        .child(div().flex_1())
        .when(!c.first && c.login === author, (e) => e.child(this.badge("Author", t)))
        .when(!c.first && Boolean(ROLES[c.role]), (e) => e.child(this.badge(ROLES[c.role], t))))
      .when(Boolean(c.body?.trim()) || Boolean(empty), (e) => e.child(div().px(16).py(14).text_size(14).child(c.body?.trim()
        ? this.markdown(key, c.body, t, cx)
        : div().text_color(t.muted).italic().child(empty))))
      .children(extra)
      .when(c.reactions?.length > 0, (e) => e.child(h_flex().px(16).pb(14).gap(6).flex_wrap()
        .children(c.reactions.map((r) => h_flex().h(26).px(8).gap(5).items_center().rounded(13).border_1().border_color(t.border).bg(t.raised)
          .text_size(12).text_color(t.muted).child(div().text_size(14).child(r.emoji)).child(String(r.count))))));
  }

  // The line comments of a review: where they are, then what was said.
  inline(key, comments, t, cx) {
    return comments.map((c, n) => v_flex().flex_none().border_t(1).border_color(t.border).bg(t.background)
      .when(!c.reply, (e) => e.child(h_flex().id(`${key}-f${n}`).px(16).py(6).gap(6).items_center().bg(t.raised).text_size(12).text_color(t.muted).cursor_pointer()
        .on_click(() => c.url && openUrl(c.url)).hover((s) => s.text_color(t.accent))
        .child(this.glyph("file", 13, t.muted)).child(div().min_w(0).truncate().font_semibold().child(c.path ?? "")).when(c.line != null, (x) => x.child(`:${c.line}`))))
      .child(h_flex().px(16).py(10).gap(10).items_start()
        .child(this.pic(c.login, c.avatar, 20, t, cx))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(h_flex().gap(8).text_size(12).child(div().font_semibold().child(shown(c.login))).child(div().text_color(t.muted).child(ago(c.at))))
          .child(div().text_size(13).child(this.markdown(`${key}-c${n}`, c.body ?? "", t, cx))))));
  }

  // A line on the timeline: a round icon, then who did what, when.
  event(key, e, t, cx) {
    const strong = (text) => div().font_semibold().text_color(t.foreground).child(text);
    const muted = (text) => div().child(text);
    const parts = [];
    let [glyph, fill] = [{ labels: "tag", assign: "user", request: "eye", renamed: "pencil", mention: "link", commits: "commit", forcepush: "commit", branchdeleted: "branch", draft: "draft", ready: "open" }[e.kind] ?? "dot", null];
    switch (e.kind) {
      case "labels":
        if (e.added.length) parts.push(muted("added"), ...e.added.map((l) => labelChip(l, t)));
        if (e.added.length && e.removed.length) parts.push(muted("and"));
        if (e.removed.length) parts.push(muted("removed"), ...e.removed.map((l) => labelChip(l, t)));
        parts.push(muted(e.added.length + e.removed.length === 1 ? "label" : "labels"));
        break;
      case "assign": { const w = assignWords(e); parts.push(muted(w.text), ...(w.who ? [strong(shown(w.who))] : [])); break; }
      case "request": parts.push(muted(e.added ? "requested a review from" : "removed the review request for"), strong(shown(e.who))); break;
      case "closed": parts.push(muted("closed this")); [glyph, fill] = ["closed", t.ansi1]; break;
      case "reopened": parts.push(muted("reopened this")); [glyph, fill] = ["open", t.ansi2]; break;
      case "merged": parts.push(muted("merged this")); [glyph, fill] = ["merged", t.ansi5]; break;
      case "ready": parts.push(muted("marked this as ready for review")); break;
      case "draft": parts.push(muted("marked this as a draft")); break;
      case "forcepush": parts.push(muted("force-pushed the branch")); break;
      case "branchdeleted": parts.push(muted("deleted the head branch")); break;
      case "renamed": parts.push(muted("changed the title"), div().line_through().child(e.from ?? ""), strong(e.to ?? "")); break;
      case "mention": parts.push(muted("mentioned this")); break;
      case "commits": parts.push(muted(`added ${e.commits.length} commit${e.commits.length === 1 ? "" : "s"}`)); break;
    }
    const color = e.state === "OPEN" || e.state === "open" ? t.ansi2 : e.merged || e.state === "closed" ? t.ansi5 : t.muted;
    return v_flex().flex_none().gap(6)
      .child(h_flex().pl(6).gap(10).items_center()
        .child(div().size(28).flex_none().rounded(14).flex().items_center().justify_center().bg(fill ? `${fill}24` : t.raised).border_1().border_color(fill ? `${fill}55` : t.border)
          .child(this.glyph(glyph, 14, fill ?? t.muted)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center().flex_wrap().text_size(13).text_color(t.muted)
          .when(e.kind !== "commits", (x) => x.child(this.pic(e.login, e.avatar, 16, t, cx)))
          .child(strong(shown(e.login ?? "")))
          .children(parts).child(div().underline().child(ago(e.at)))))
      .when(e.kind === "mention", (el) => el.child(h_flex().id(key).ml(44).gap(8).items_start().cursor_pointer().text_size(13)
        .on_click((_ev, cx) => this.link(e.url, cx))
        .child(this.glyph(e.pr ? "open" : "dot", 16, color))
        .child(div().flex_1().min_w(0).child(h_flex().gap(6).flex_wrap()
          .child(div().font_semibold().text_color(t.foreground).hover((s) => s.text_color(t.accent)).child(e.title ?? ""))
          .child(div().text_color(t.muted).child(`${e.repo === this.repo ? "" : e.repo}#${e.number}`))))))
      .when(e.kind === "commits", (el) => el.child(v_flex().ml(44).gap(4)
        .children(e.commits.slice(0, 4).map((c) => this.commitRow(`${key}-${c.sha}`, c, t)))
        .when(e.commits.length > 4, (x) => x.child(div().id(`${key}-more`).text_size(12).text_color(t.accent).cursor_pointer()
          .on_click((_ev, cx) => { this.tab = "commits"; cx.notify(); }).child(`${e.commits.length - 4} more commits`)))));
  }

  commitRow(key, c, t) {
    const [headline] = c.message.split("\n");
    return h_flex().id(key).gap(8).items_center().cursor_pointer().text_size(12).on_click(() => c.url && openUrl(c.url))
      .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_color(t.muted).hover((s) => s.text_color(t.accent)).child(c.sha.slice(0, 7)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(headline));
  }

  joint(t) { return div().flex_none().ml(19).w(2).h(16).bg(t.border); }

  thread(pr, t, cx) {
    const items = this.timelines[this.id()]
      ?? pr.comments.map((c) => ({ kind: "comment", login: login(c.author), at: c.createdAt, body: c.body, role: c.authorAssociation, reactions: reactions(c.reactionGroups) }));
    const first = { kind: "comment", first: true, login: login(pr.author), at: pr.createdAt, body: pr.body, reactions: reactions(pr.reactionGroups) };
    const draw = (e, n) => {
      if (e.kind === "comment") return this.card(`pr-comment-${n}`, e, t, cx);
      if (e.kind === "review") {
        const [head, glyph, tint] = verdict(e.state, t);
        return this.card(`pr-review-${n}`, e, t, cx, { head: `${head} ${ago(e.at)}`, glyph, tint, extra: this.inline(`pr-review-${n}`, e.comments, t, cx) });
      }
      return this.event(`pr-event-${n}`, e, t, cx);
    };
    return [this.card("pr-body", first, t, cx), ...items.flatMap((e, n) => [this.joint(t), draw(e, n)])];
  }

  composer(pr, t, cx) {
    const open = pr.state === "OPEN", busy = Boolean(this.busy), text = Boolean(this.replying), mine = login(pr.author) === this.me;
    // Assigned = I'm reviewing now: my verdict also ends that.
    const finishing = this.reviewInfo(pr).reviewing.includes(this.me), end = finishing ? " & finish" : "";
    const verdictOf = (kind) => (_e, cx) => (finishing ? this.finish(kind, cx) : this.review(kind, cx));
    const tab = (id, label) => div().id(`pr-mode-${id}`).h(32).px(14).flex().items_center().rounded_t(6).text_size(13).cursor_pointer()
      .when(this.mode === id, (e) => e.bg(t.background).border_1().border_b(0).border_color(t.border).text_color(t.foreground))
      .when(this.mode !== id, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.mode = id; cx.notify(); }).child(label);
    return v_flex().flex_none().gap(10)
      .child(div().text_size(16).font_semibold().child("Add a comment"))
      .child(v_flex().rounded(6).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(8).pt(8).gap(4).items_end().bg(t.raised).border_b(1).border_color(t.border)
          .child(tab("write", "Write")).child(tab("preview", "Preview")))
        .child(this.mode === "write"
          ? div().id("pr-reply").px(12).py(10).bg(t.background).cursor_text().child(Textarea.new(this.reply).w_full().text_size(14).text_color(t.foreground))
          : div().px(16).py(14).min_h(110).bg(t.background).text_size(14).child(text
            ? TextView.markdown("pr-preview", linkify(this.reply.value(), this.repo)).on_link_click((url, cx) => this.link(url, cx))
            : div().text_color(t.muted).child("Nothing to preview")))
        .child(h_flex().px(12).py(10).gap(8).items_center().flex_wrap().bg(t.background).border_t(1).border_color(t.border)
          .when(open, (e) => e.child(this.button("pr-close-state", text ? "Close with comment" : "Close pull request", t, (_e, cx) => this.setState(true, cx), { enabled: !busy, glyph: "closed", tint: t.ansi1 })))
          .when(pr.state === "CLOSED", (e) => e.child(this.button("pr-reopen", text ? "Reopen with comment" : "Reopen pull request", t, (_e, cx) => this.setState(false, cx), { enabled: !busy, glyph: "open", tint: t.ansi2 })))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(this.failed?.where === "composer" ? t.ansi1 : t.muted)
            .child(this.failed?.where === "composer" ? this.failed.message : busy && this.busyWhere === "composer" ? this.busy : "Markdown · Ctrl+Enter to comment"))
          .when(open && pr.isDraft, (e) => e.child(this.button("pr-ready", "Ready for review", t, (_e, cx) => this.ready(cx), { enabled: !busy, glyph: "open", tint: t.ansi2 })))
          .when(open && !mine, (e) => e
            .child(this.button("pr-request-changes", `Request changes${end}`, t, verdictOf("request-changes"), { enabled: text && !busy, glyph: "x", tint: t.ansi1 }))
            .child(this.button("pr-approve", `Approve${end}`, t, verdictOf("approve"), { enabled: !busy, fill: t.ansi2, glyph: "check" })))
          .child(this.button("pr-comment", "Comment", t, (_e, cx) => this.comment(cx), { enabled: text && !busy, fill: text ? t.accent : null, glyph: "comment" }))));
  }

  rows(title, list, t) {
    return v_flex().flex_none().rounded(6).border_1().border_color(t.border).overflow_hidden().bg(t.background)
      .child(div().h(36).px(14).flex().items_center().bg(t.raised).border_b(1).border_color(t.border).text_size(13).font_semibold().child(title))
      .children(list);
  }

  commitsTab(pr, t) {
    const rows = [...pr.commits].reverse().map((c, n) => h_flex().id(`commit-${c.oid}`).px(14).py(8).gap(10).items_center().border_t(n ? 1 : 0).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(`https://github.com/${this.repo}/commit/${c.oid}`))
      .child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(14).text_color(t.foreground).child(c.messageHeadline))
        .child(div().text_size(12).text_color(t.muted).child(`${c.authors?.map((a) => a.name || a.login).join(", ") ?? ""} · ${ago(c.committedDate)}`)))
      .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_size(12).text_color(t.muted).child(c.oid.slice(0, 7))));
    return this.rows(`${pr.commits.length} commits`, rows, t);
  }

  filesTab(pr, t) {
    const most = Math.max(1, ...pr.files.map((f) => f.additions + f.deletions));
    const rows = pr.files.map((f, n) => h_flex().id(`file-${n}`).px(14).py(7).gap(10).items_center().border_t(n ? 1 : 0).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(`${pr.url}/files`))
      .child(this.glyph("file", 14, t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(f.path))
      .child(h_flex().gap(6).flex_none().text_size(12).child(div().text_color(t.ansi2).child(`+${f.additions}`)).child(div().text_color(t.ansi1).child(`−${f.deletions}`)))
      .child(h_flex().w(60).h(6).flex_none().rounded(3).overflow_hidden().bg(t.border)
        .child(div().h_full().w(Math.round(60 * f.additions / most)).bg(t.ansi2))
        .child(div().h_full().w(Math.round(60 * f.deletions / most)).bg(t.ansi1))));
    return this.rows(`${pr.changedFiles} files changed`, rows, t);
  }

  checksTab(pr, t) {
    const list = checks(pr.statusCheckRollup);
    const tint = { passing: t.ansi2, failing: t.ansi1, pending: t.ansi3, skipped: t.muted };
    const glyph = { passing: "check", failing: "x", pending: "dot", skipped: "dot" };
    if (!list.length) return div().text_color(t.muted).child("No checks on this pull request.");
    return this.rows(`${list.length} checks`, list.map((c, n) => h_flex().id(`check-${n}`).px(14).py(8).gap(10).items_center().border_t(n ? 1 : 0).border_color(t.border)
      .when(Boolean(c.url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(c.url)))
      .child(this.glyph(glyph[c.outcome], 16, tint[c.outcome]))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
      .child(div().text_size(12).text_color(t.muted).child(c.outcome))), t);
  }

  render(cx) {
    const t = theme(), pr = this.pr;
    // The header draws from the pull request, or until it arrives from what the list knew.
    const sd = this.seed;
    const h = pr ? { title: pr.title, author: login(pr.author), head: pr.headRefName, base: pr.baseRefName, adds: pr.additions, dels: pr.deletions, state: pr.state, draft: pr.isDraft, conflicts: pr.mergeable === "CONFLICTING" }
      : sd?.title ? { title: sd.title, author: sd.author, head: sd.head, base: sd.base, adds: sd.adds, dels: sd.dels, state: (sd.state ?? "open").toUpperCase(), draft: sd.draft, conflicts: sd.merge === "conflicts" } : null;
    if (!h) return v_flex().id("pr").size_full().bg(t.background).text_color(t.foreground).text_size(14).px(32).pt(16).gap(20)
      .child(bar(this, pr, t))
      .child(this.loading ? div().text_color(t.muted).child(`Loading #${this.number}…`) : div().text_color(t.ansi1).child(this.error ?? ""));

    const body = !pr ? null : this.tab === "commits" ? this.commitsTab(pr, t) : this.tab === "files" ? this.filesTab(pr, t) : this.tab === "checks" ? this.checksTab(pr, t) : null;
    return v_flex().id("pr").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(14)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(header(this, h, pr, t))
      .child(!pr ? v_flex().id("pr-loading").flex_1().min_h(0).overflow_y_scrollbar().px(32).py(20).gap(20)
        .child(this.error ? div().text_color(t.ansi1).child(this.error) : div().text_color(t.muted).child(`Loading #${this.number}…`))
        .when(!this.error, (e) => e.child(mergeSkeleton(this, t)))
        : h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id(`pr-main-${this.id()}-${this.tab}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().pl(32).pr(24).py(20)
          .children(body ? [body] : this.thread(pr, t, cx))
          .when(!body, (e) => e.child(div().flex_none().h(24)).child(mergeView(this, pr, t)).child(div().flex_none().h(28)).child(this.composer(pr, t, cx)))
          .child(div().flex_none().h(24)))
        .child(sidebar(this, pr, t, cx)));
  }
}
