import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, theme, closeOverlay, notify } from "herdr";
import { icons, icon, avatarPath, loadAvatar } from "./icons.js";
import { blocks, picture, failed, loadPicture } from "./pictures.js";
import { timeline, checks, login, shown, bot, reactions } from "./timeline.js";

const DETAIL = "number,title,body,author,state,isDraft,labels,assignees,reviewRequests,latestReviews,reviewDecision,comments,commits,files,statusCheckRollup,headRefName,baseRefName,additions,deletions,changedFiles,createdAt,updatedAt,mergedAt,mergedBy,mergeable,url,milestone,reactionGroups,closingIssuesReferences";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/;
// GitHub's own state colors, the same in every theme so they read as GitHub's.
const GITHUB = { open: "#238636", done: "#8957e5", closed: "#da3633", draft: "#6e7681", link: "#4493f8", warn: "#d29922" };
const ROLES = { OWNER: "Owner", MEMBER: "Member", COLLABORATOR: "Collaborator", CONTRIBUTOR: "Contributor" };
const REVIEWS = {
  approved: ["approved these changes", "check", GITHUB.open], changes_requested: ["requested changes", "x", GITHUB.closed],
  commented: ["reviewed", "comment", null], dismissed: ["had a review dismissed", "x", GITHUB.draft],
  APPROVED: ["approved", "check", GITHUB.open], CHANGES_REQUESTED: ["requested changes", "x", GITHUB.closed],
  COMMENTED: ["commented", "comment", null], DISMISSED: ["dismissed", "x", GITHUB.draft], PENDING: ["pending", "dot", GITHUB.warn],
};
const TABS = [["conversation", "Conversation"], ["commits", "Commits"], ["files", "Files changed"], ["checks", "Checks"]];

// As GitHub says it: "3h ago" this month, "on Sep 21" before that.
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  const d = new Date(iso), year = d.getFullYear() === new Date().getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `on ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

export function openUrl(url) {
  exec("sh", ["-c", 'xdg-open "$1" >/dev/null 2>&1 &', "sh", url]).catch(() => exec("open", [url]).catch(() => null));
}

// #123 and owner/repo#123 outside code become links, as on GitHub.
function linkify(markdown, repo) {
  return markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, n) => n % 2 ? part
    : part.replace(/(^|[\s(])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g, (_m, pre, other, number) =>
      `${pre}[${other ?? ""}#${number}](https://github.com/${other ?? repo}/issues/${number})`)).join("");
}

// A label as GitHub tints it: its color faint behind, its color as text unless too dark to read.
function labelChip(l, t) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(l.color.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.35;
  return div().h(20).px(7).flex_none().flex().items_center().rounded(10).border_1().border_color(`#${l.color}66`).bg(`#${l.color}2e`)
    .text_size(12).font_semibold().text_color(light ? `#${l.color}` : t.foreground).child(l.name);
}

// One pull request in a dialog: { repo, number, on, title?, me? } from the panel. The summary and the
// timeline load behind the title; links to other issues and pull requests open here, with Back to return.
export class Viewer {
  constructor({ repo, number, on, title, me }, overlay, cx) {
    this.repo = repo; this.number = number; this.on = on; this.me = me; this.overlay = overlay; this.seed = title ?? null;
    this.history = []; this.cache = {}; this.timelines = {}; this.tab = "conversation";
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
    this.load(cx);
  }

  id() { return `${this.repo}#${this.number}`; }

  load(cx) {
    const repo = this.repo, number = this.number, id = this.id(), current = () => this.id() === id;
    this.pr = this.cache[id] ?? null; this.error = null; this.loading = true;
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
        if (current()) this.pr = pr;
      } catch (e) { if (current()) this.error = String(e?.message ?? e); }
      finally { if (current()) { this.loading = false; cx.notify(); } }
    });
  }

  go(repo, number, cx) {
    if (repo === this.repo && number === this.number) return;
    this.history.push({ repo: this.repo, number: this.number, tab: this.tab });
    this.repo = repo; this.number = number; this.seed = null; this.tab = "conversation";
    this.load(cx); cx.notify();
  }

  back(cx) {
    const prev = this.history.pop();
    if (!prev) return;
    Object.assign(this, { repo: prev.repo, number: prev.number, tab: prev.tab, seed: null });
    this.load(cx); cx.notify();
  }

  link(url, cx) {
    const m = ISSUE_URL.exec(url);
    if (m) this.go(m[1], Number(m[2]), cx); else openUrl(url);
  }

  // ---- drawing ----

  pic(name, url, size, t, cx) {
    const loading = loadAvatar(name, url);
    if (loading) cx.spawn(async (cx) => { if (await loading) cx.notify(); });
    const path = avatarPath(name);
    if (path) return image(path).size(size).flex_none().rounded(size / 2);
    const colors = [t.ansi1, t.ansi2, t.ansi3, t.ansi4, t.ansi5, t.ansi6];
    const color = colors[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % colors.length];
    return div().size(size).flex_none().rounded(size / 2).flex().items_center().justify_center().bg(color + "33")
      .text_size(Math.round(size * 0.5)).font_semibold().text_color(color).child(shown(name).slice(0, 1).toUpperCase());
  }

  glyph(name, size, color) { return div().size(size).flex_none().when(this.icons, (e) => e.child(svg(icon(name)).size(size).text_color(color))); }

  button(id, label, t, onClick, { glyph = null, enabled = true } = {}) {
    return h_flex().id(id).h(32).px(12).gap(6).flex_none().items_center().justify_center().rounded(6).text_size(13).font_medium()
      .bg(t.raised).border_1().border_color(t.border).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .when(Boolean(glyph), (e) => e.child(this.glyph(glyph, 14, t.muted)))
      .when(label !== "", (e) => e.child(label));
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
    return v_flex().flex_none().rounded(6).border_1().border_color(c.state === "approved" ? `${GITHUB.open}88` : c.state === "changes_requested" ? `${GITHUB.closed}88` : t.border).overflow_hidden().bg(t.background)
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
        .on_click(() => c.url && openUrl(c.url)).hover((s) => s.text_color(GITHUB.link))
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
    let [glyph, fill] = [{ labels: "tag", assign: "user", request: "eye", renamed: "pencil", mention: "link", commits: "commit", forcepush: "commit", branchdeleted: "branch", draft: "pull", ready: "open" }[e.kind] ?? "dot", null];
    switch (e.kind) {
      case "labels":
        if (e.added.length) parts.push(muted("added"), ...e.added.map((l) => labelChip(l, t)));
        if (e.added.length && e.removed.length) parts.push(muted("and"));
        if (e.removed.length) parts.push(muted("removed"), ...e.removed.map((l) => labelChip(l, t)));
        parts.push(muted(e.added.length + e.removed.length === 1 ? "label" : "labels"));
        break;
      case "assign": parts.push(...(e.who === e.login ? [muted(e.added ? "self-assigned this" : "removed their assignment")] : [muted(e.added ? "assigned" : "unassigned"), strong(shown(e.who))])); break;
      case "request": parts.push(muted(e.added ? "requested a review from" : "removed the review request for"), strong(shown(e.who))); break;
      case "closed": parts.push(muted("closed this")); [glyph, fill] = ["closed", GITHUB.closed]; break;
      case "reopened": parts.push(muted("reopened this")); [glyph, fill] = ["open", GITHUB.open]; break;
      case "merged": parts.push(muted("merged this")); [glyph, fill] = ["merged", GITHUB.done]; break;
      case "ready": parts.push(muted("marked this as ready for review")); break;
      case "draft": parts.push(muted("marked this as a draft")); break;
      case "forcepush": parts.push(muted("force-pushed the branch")); break;
      case "branchdeleted": parts.push(muted("deleted the head branch")); break;
      case "renamed": parts.push(muted("changed the title"), div().line_through().child(e.from ?? ""), strong(e.to ?? "")); break;
      case "mention": parts.push(muted("mentioned this")); break;
      case "commits": parts.push(muted(`added ${e.commits.length} commit${e.commits.length === 1 ? "" : "s"}`)); break;
    }
    const color = e.state === "OPEN" || e.state === "open" ? GITHUB.open : e.merged || e.state === "closed" ? GITHUB.done : t.muted;
    return v_flex().flex_none().gap(6)
      .child(h_flex().pl(6).gap(10).items_center()
        .child(div().size(28).flex_none().rounded(14).flex().items_center().justify_center().bg(fill ?? t.raised).border_1().border_color(fill ?? t.border)
          .child(this.glyph(glyph, 14, fill ? "#ffffff" : t.muted)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center().flex_wrap().text_size(13).text_color(t.muted)
          .when(e.kind !== "commits", (x) => x.child(this.pic(e.login, e.avatar, 16, t, cx)))
          .child(strong(shown(e.login ?? "")))
          .children(parts).child(div().underline().child(ago(e.at)))))
      .when(e.kind === "mention", (el) => el.child(h_flex().id(key).ml(44).gap(8).items_start().cursor_pointer().text_size(13)
        .on_click((_ev, cx) => this.link(e.url, cx))
        .child(this.glyph(e.pr ? "open" : "dot", 16, color))
        .child(div().flex_1().min_w(0).child(h_flex().gap(6).flex_wrap()
          .child(div().font_semibold().text_color(t.foreground).hover((s) => s.text_color(GITHUB.link)).child(e.title ?? ""))
          .child(div().text_color(t.muted).child(`${e.repo === this.repo ? "" : e.repo}#${e.number}`))))))
      .when(e.kind === "commits", (el) => el.child(v_flex().ml(44).gap(4)
        .children(e.commits.slice(0, 4).map((c) => this.commitRow(`${key}-${c.sha}`, c, t)))
        .when(e.commits.length > 4, (x) => x.child(div().id(`${key}-more`).text_size(12).text_color(GITHUB.link).cursor_pointer()
          .on_click((_ev, cx) => { this.tab = "commits"; cx.notify(); }).child(`${e.commits.length - 4} more commits`)))));
  }

  commitRow(key, c, t) {
    const [headline] = c.message.split("\n");
    return h_flex().id(key).gap(8).items_center().cursor_pointer().text_size(12).on_click(() => c.url && openUrl(c.url))
      .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_color(t.muted).hover((s) => s.text_color(GITHUB.link)).child(c.sha.slice(0, 7)))
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
        const [head, glyph, tint] = REVIEWS[e.state] ?? REVIEWS.commented;
        return this.card(`pr-review-${n}`, e, t, cx, { head: `${head} ${ago(e.at)}`, glyph, tint, extra: this.inline(`pr-review-${n}`, e.comments, t, cx) });
      }
      return this.event(`pr-event-${n}`, e, t, cx);
    };
    return [this.card("pr-body", first, t, cx), ...items.flatMap((e, n) => [this.joint(t), draw(e, n)])];
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
      .child(h_flex().gap(6).flex_none().text_size(12).child(div().text_color(GITHUB.open).child(`+${f.additions}`)).child(div().text_color(GITHUB.closed).child(`−${f.deletions}`)))
      .child(h_flex().w(60).h(6).flex_none().rounded(3).overflow_hidden().bg(t.border)
        .child(div().h_full().w(Math.round(60 * f.additions / most)).bg(GITHUB.open))
        .child(div().h_full().w(Math.round(60 * f.deletions / most)).bg(GITHUB.closed))));
    return this.rows(`${pr.changedFiles} files changed`, rows, t);
  }

  checksTab(pr, t) {
    const list = checks(pr.statusCheckRollup);
    const tint = { passing: GITHUB.open, failing: GITHUB.closed, pending: GITHUB.warn, skipped: GITHUB.draft };
    const glyph = { passing: "check", failing: "x", pending: "dot", skipped: "dot" };
    if (!list.length) return div().text_color(t.muted).child("No checks on this pull request.");
    return this.rows(`${list.length} checks`, list.map((c, n) => h_flex().id(`check-${n}`).px(14).py(8).gap(10).items_center().border_t(n ? 1 : 0).border_color(t.border)
      .when(Boolean(c.url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(c.url)))
      .child(this.glyph(glyph[c.outcome], 16, tint[c.outcome]))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
      .child(div().text_size(12).text_color(t.muted).child(c.outcome))), t);
  }

  section(title, t, body) {
    return v_flex().flex_none().gap(8).py(14).border_b(1).border_color(t.border)
      .child(div().text_size(12).font_semibold().text_color(t.muted).child(title)).child(body);
  }

  sidebar(pr, t, cx) {
    const none = (text) => div().text_size(12).text_color(t.muted).child(text);
    const verdicts = new Map(pr.latestReviews.map((r) => [login(r.author), r.state]));
    const reviewers = [...verdicts.entries(), ...pr.reviewRequests.map((r) => [r.login ?? r.name ?? r.slug, "PENDING"]).filter(([n]) => !verdicts.has(n))];
    const list = checks(pr.statusCheckRollup), failing = list.filter((c) => c.outcome === "failing").length, pending = list.filter((c) => c.outcome === "pending").length;
    const people = new Map();
    for (const [name, url] of [[login(pr.author)], ...pr.comments.map((c) => [login(c.author)]), ...(this.timelines[this.id()] ?? []).filter((e) => e.login && e.kind !== "commits").map((e) => [e.login, e.avatar])])
      if (!bot(name)) people.set(name, people.get(name) ?? url ?? null);
    return v_flex().id("pr-sidebar").w(264).flex_none().min_h(0).overflow_y_scrollbar().pl(8).pr(24).pt(6)
      .child(this.section("Reviewers", t, reviewers.length
        ? v_flex().gap(8).children(reviewers.map(([name, state]) => {
          const [, glyph, tint] = REVIEWS[state] ?? REVIEWS.COMMENTED;
          return h_flex().gap(8).items_center().text_size(13).child(this.pic(name, null, 20, t, cx)).child(div().flex_1().min_w(0).truncate().font_semibold().child(shown(name)))
            .child(this.glyph(glyph, 14, tint ?? t.muted));
        }))
        : none("No reviews yet")))
      .child(this.section("Assignees", t, pr.assignees.length
        ? v_flex().gap(8).children(pr.assignees.map((a) => h_flex().gap(8).items_center().text_size(13).font_semibold().child(this.pic(a.login, null, 20, t, cx)).child(a.login)))
        : none("No one")))
      .child(this.section("Labels", t, pr.labels.length ? h_flex().gap(4).flex_wrap().children(pr.labels.map((l) => labelChip(l, t))) : none("None yet")))
      .child(this.section("Checks", t, list.length
        ? h_flex().id("pr-side-checks").gap(8).items_center().text_size(13).cursor_pointer().on_click((_e, cx) => { this.tab = "checks"; cx.notify(); })
          .child(this.glyph(failing ? "x" : pending ? "dot" : "check", 16, failing ? GITHUB.closed : pending ? GITHUB.warn : GITHUB.open))
          .child(failing ? `${failing} failing, ${list.length - failing} other` : pending ? `${pending} pending` : `All ${list.length} passing`)
        : none("No checks")))
      .child(this.section("Linked issues", t, (pr.closingIssuesReferences ?? []).length
        ? v_flex().gap(6).children(pr.closingIssuesReferences.map((i) => h_flex().id(`pr-issue-${i.number}`).gap(8).items_center().text_size(13).cursor_pointer()
          .on_click((_e, cx) => this.link(i.url, cx)).child(this.glyph("dot", 14, t.muted)).child(div().font_semibold().hover((s) => s.text_color(GITHUB.link)).child(`#${i.number}`))))
        : none("None yet")))
      .child(this.section("Participants", t, h_flex().gap(4).flex_wrap().children([...people].slice(0, 18).map(([name, url]) => this.pic(name, url, 24, t, cx)))));
  }

  render(cx) {
    const t = theme(), pr = this.pr;
    const bar = h_flex().h(32).gap(8).items_center()
      .when(this.history.length > 0, (e) => e.child(this.button("pr-back", "Back", t, (_e, cx) => this.back(cx), { glyph: "close" })))
      .child(div().text_size(13).text_color(t.muted).child(`${this.repo} · pull request`))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.ansi1).truncate().child(pr && this.error ? this.error : ""))
      .when(this.loading, (e) => e.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child("Refreshing")))
      .when(Boolean(pr) && !this.loading, (e) => e.child(this.button("pr-refresh", "Refresh", t, (_e, cx) => { this.load(cx); cx.notify(); }, { glyph: "refresh" })))
      .when(Boolean(pr), (e) => e.child(this.button("pr-copy", "Copy branch", t, (_e, cx) => {
        cx.write_to_clipboard(pr.headRefName);
        notify({ title: "Branch copied", body: pr.headRefName, level: "success", timeout: 2500 });
      }, { glyph: "copy" })))
      .when(Boolean(pr), (e) => e.child(this.button("pr-github", "Open on GitHub", t, () => openUrl(pr.url), { glyph: "external" })))
      .child(this.button("pr-close", "", t, () => closeOverlay(this.overlay), { glyph: "close" }));
    if (!pr) return v_flex().id("pr").size_full().bg(t.background).text_color(t.foreground).text_size(14).px(32).pt(16).gap(20)
      .child(bar)
      .when(Boolean(this.seed), (e) => e.child(div().text_size(24).child(this.seed)))
      .child(this.loading ? div().text_color(t.muted).child(`Loading #${this.number}…`) : div().text_color(t.ansi1).child(this.error ?? ""));

    const merged = pr.state === "MERGED", closed = pr.state === "CLOSED";
    const [state, color, glyph] = merged ? ["Merged", GITHUB.done, "merged"] : closed ? ["Closed", GITHUB.closed, "closed"] : pr.isDraft ? ["Draft", GITHUB.draft, "draft"] : ["Open", GITHUB.open, "open"];
    const n = pr.commits.length, count = { commits: n, files: pr.changedFiles, checks: checks(pr.statusCheckRollup).length };
    const body = this.tab === "commits" ? this.commitsTab(pr, t) : this.tab === "files" ? this.filesTab(pr, t) : this.tab === "checks" ? this.checksTab(pr, t) : null;
    return v_flex().id("pr").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(14)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(v_flex().flex_none().px(32).pt(14).pb(0).gap(14).border_b(1).border_color(t.border)
        .child(bar)
        .child(h_flex().flex_wrap().gap_x(8).text_size(30).children(pr.title.split(/\s+/).filter(Boolean).map((w) => div().child(w)))
          .child(div().text_color(t.muted).child(`#${pr.number}`)))
        .child(h_flex().gap(10).items_center().flex_wrap()
          .child(h_flex().h(32).px(12).gap(6).items_center().rounded(16).bg(color).text_color("#ffffff").text_size(14).font_semibold()
            .child(this.glyph(glyph, 16, "#ffffff")).child(state))
          .child(h_flex().gap(6).items_center().flex_wrap().text_size(13).text_color(t.muted)
            .child(div().font_semibold().text_color(t.foreground).child(shown(login(pr.author))))
            .child(merged ? `merged ${n} commit${n === 1 ? "" : "s"} into` : `wants to merge ${n} commit${n === 1 ? "" : "s"} into`)
            .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_color(GITHUB.link).child(pr.baseRefName))
            .child("from")
            .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_color(GITHUB.link).child(pr.headRefName)))
          .child(h_flex().gap(6).text_size(13).font_semibold().child(div().text_color(GITHUB.open).child(`+${pr.additions}`)).child(div().text_color(GITHUB.closed).child(`−${pr.deletions}`)))
          .when(pr.mergeable === "CONFLICTING", (e) => e.child(h_flex().h(22).px(8).items_center().rounded(11).bg(`${GITHUB.warn}33`).text_size(12).text_color(GITHUB.warn).child("Has conflicts"))))
        .child(h_flex().gap(2).items_end()
          .children(TABS.map(([id, label]) => h_flex().id(`pr-tab-${id}`).h(38).px(14).gap(6).items_center().text_size(13).cursor_pointer()
            .border_b(2).border_color(this.tab === id ? GITHUB.link : "#00000000").text_color(this.tab === id ? t.foreground : t.muted).when(this.tab === id, (e) => e.font_semibold())
            .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.tab = id; cx.notify(); })
            .child(label).when(Boolean(count[id]), (e) => e.child(this.badge(String(count[id]), t)))))))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id(`pr-main-${this.id()}-${this.tab}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().pl(32).pr(24).py(20)
          .children(body ? [body] : this.thread(pr, t, cx))
          .child(div().flex_none().h(24)))
        .child(this.sidebar(pr, t, cx)));
  }
}
