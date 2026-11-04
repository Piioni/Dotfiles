import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { exec, theme, openOverlay, closeOverlay, setShared } from "herdr";
import { icons, icon, avatarPath, loadAvatar } from "./icons.js";
import { blocks, picture, failed, loadPicture } from "./pictures.js";

export const FIELDS = "number,title,body,author,state,stateReason,labels,assignees,createdAt,updatedAt,comments,url";
const DETAIL = `${FIELDS},milestone,closedByPullRequestsReferences,reactionGroups`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/;
// GitHub's own state colors, the same in every theme so they read as GitHub's.
const GITHUB = { open: "#238636", done: "#8957e5", skipped: "#6e7681", link: "#4493f8" };
const EMOJI = {
  "+1": "👍", "-1": "👎", laugh: "😄", hooray: "🎉", confused: "😕", heart: "❤️", rocket: "🚀", eyes: "👀",
  THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀",
};
const ROLES = { OWNER: "Owner", MEMBER: "Member", COLLABORATOR: "Collaborator", CONTRIBUTOR: "Contributor" };

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

// gh says app/name for apps, the REST API name[bot]; GitHub shows the name with a bot badge.
const login = (user) => user?.login ?? "ghost";
const shown = (name) => name.replace(/^app\//, "").replace(/\[bot\]$/, "");
const bot = (name) => /^app\/|\[bot\]$/.test(name);

function reactions(r) {
  if (Array.isArray(r)) return r.filter((g) => g.users?.totalCount > 0 && EMOJI[g.content]).map((g) => ({ emoji: EMOJI[g.content], count: g.users.totalCount }));
  return Object.entries(r ?? {}).filter(([k, n]) => EMOJI[k] && n > 0).map(([k, n]) => ({ emoji: EMOJI[k], count: n }));
}

// The REST timeline as GitHub draws it: comments, and the events between them
// (a burst of label changes by one person is one line).
function timeline(raw) {
  const items = [];
  for (const e of raw) {
    const who = e.actor ?? e.user, base = { login: login(who), avatar: who?.avatar_url, at: e.created_at };
    switch (e.event) {
      case "commented":
        items.push({ ...base, kind: "comment", body: e.body, role: e.author_association, reactions: reactions(e.reactions), url: e.html_url });
        break;
      case "labeled": case "unlabeled": {
        const last = items.at(-1), added = e.event === "labeled";
        if (last?.kind === "labels" && last.login === base.login && Date.parse(base.at) - Date.parse(last.at) < 60000) (added ? last.added : last.removed).push(e.label);
        else items.push({ ...base, kind: "labels", added: added ? [e.label] : [], removed: added ? [] : [e.label] });
        break;
      }
      case "assigned": case "unassigned":
        items.push({ ...base, kind: "assign", added: e.event === "assigned", who: login(e.assignee) });
        break;
      case "closed": items.push({ ...base, kind: "closed", reason: e.state_reason }); break;
      case "reopened": items.push({ ...base, kind: "reopened" }); break;
      case "renamed": items.push({ ...base, kind: "renamed", from: e.rename?.from, to: e.rename?.to }); break;
      case "milestoned": case "demilestoned":
        items.push({ ...base, kind: "milestone", added: e.event === "milestoned", title: e.milestone?.title });
        break;
      case "cross-referenced": {
        const s = e.source?.issue;
        if (s) items.push({ ...base, kind: "mention", number: s.number, title: s.title, state: s.state, pr: Boolean(s.pull_request),
          merged: Boolean(s.pull_request?.merged_at), repo: s.repository?.full_name, url: s.html_url });
        break;
      }
      case "referenced": {
        const repo = /repos\/([^/]+\/[^/]+)\/commits/.exec(e.commit_url ?? "")?.[1];
        if (e.commit_id && repo) items.push({ ...base, kind: "commit", sha: e.commit_id, url: `https://github.com/${repo}/commit/${e.commit_id}` });
        break;
      }
    }
  }
  return items;
}

// GitHub's Copy link, with the reference and number beside it: a popup of the panel's mod.
export function copyMenu({ repo, number, title, url }, at) {
  openOverlay({ mod: "issues", kind: "popup", width: 300, height: 222, ...(at ? { at } : {}),
    props: { copyMenu: { url: url ?? `https://github.com/${repo}/issues/${number}`, ref: `${repo}#${number}`, number: `#${number}`, title: title ? `#${number} ${title}` : null } } });
}

// A label as GitHub tints it: its color faint behind, its color as text unless too dark to read.
export function labelChip(l, t) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(l.color.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.35;
  return div().h(20).px(7).flex_none().flex().items_center().rounded(10).border_1().border_color(`#${l.color}66`).bg(`#${l.color}2e`)
    .text_size(12).font_semibold().text_color(light ? `#${l.color}` : t.foreground).child(l.name);
}

// One issue in a dialog: { repo, number, on, data?, me? } from the panel. With
// data (the panel's cached copy) it shows at once; the full issue and its
// timeline load behind it. Links to other issues and pull requests open here
// too, with Back to return.
export class Viewer {
  constructor({ repo, number, on, data, me }, overlay, cx) {
    this.repo = repo; this.number = number; this.on = on; this.me = me; this.overlay = overlay;
    this.history = []; this.cache = {}; this.timelines = {}; this.labels = {}; this.tab = "write";
    if (data) this.cache[`${repo}#${number}`] = data;
    this.reply = TextareaState.new({ placeholder: "Use Markdown to format your comment" });
    this.reply.set_auto_grow(4, 14);
    this.reply.on("change", (_e, cx) => { const has = Boolean(this.reply.value().trim()); if (has !== this.replying) { this.replying = has; cx.notify(); } });
    this.reply.on("submit", (e, cx) => { if (e.secondary) this.comment(cx); });
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
    this.load(cx);
  }

  id() { return `${this.repo}#${this.number}`; }

  load(cx) {
    const repo = this.repo, number = this.number, id = this.id(), current = () => this.id() === id;
    this.issue = this.cache[id] ?? null; this.error = null; this.loading = true;
    const gh = async (args) => {
      const r = await exec("gh", args, { on: this.on });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      return JSON.parse(r.stdout);
    };
    cx.spawn(async (cx) => {
      try {
        const [issue, pages] = await Promise.all([
          gh(["issue", "view", String(number), "-R", repo, "--json", DETAIL]),
          gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/timeline?per_page=100`]).catch(() => null),
        ]);
        this.cache[id] = issue;
        if (pages) this.timelines[id] = timeline(pages.flat());
        if (current()) this.issue = issue;
      } catch (e) { if (current()) this.error = String(e?.message ?? e); }
      finally { if (current()) { this.loading = false; cx.notify(); } }
    });
  }

  go(repo, number, cx) {
    if (repo === this.repo && number === this.number) return;
    this.history.push({ repo: this.repo, number: this.number });
    this.repo = repo; this.number = number; this.editing = false; this.closeMenu = false;
    this.load(cx); cx.notify();
  }

  back(cx) {
    const prev = this.history.pop();
    if (!prev) return;
    this.repo = prev.repo; this.number = prev.number; this.editing = false; this.closeMenu = false;
    this.load(cx); cx.notify();
  }

  link(url, cx) {
    const m = ISSUE_URL.exec(url);
    if (m) this.go(m[1], Number(m[2]), cx); else openUrl(url);
  }

  // Runs `gh issue <args>` on this issue, then reloads it and tells the panel.
  change(label, args, cx, after) {
    if (this.busy) return;
    const repo = this.repo, number = this.number, id = this.id();
    this.busy = label; this.error = null; this.closeMenu = false;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["issue", args[0], String(number), "-R", repo, ...args.slice(1)], { on: this.on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        after?.();
      } catch (e) { this.error = String(e?.message ?? e); }
      finally {
        this.busy = null;
        setShared("issues.changed", { repo, number, on: this.on, at: Date.now() });
        if (this.id() === id) this.load(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  cleared() { this.reply.set_value(""); this.replying = false; this.tab = "write"; }

  comment(cx) {
    const body = this.reply.value().trim();
    if (body) this.change("Commenting", ["comment", "--body", body], cx, () => this.cleared());
  }

  // Closing or reopening takes what's in the comment box along, as on GitHub.
  setState(close, reason, cx) {
    const body = this.reply.value().trim(), args = close ? ["close", "--reason", reason] : ["reopen"];
    if (body) args.push("--comment", body);
    this.change(close ? "Closing" : "Reopening", args, cx, () => this.cleared());
  }

  // Shows the change at once; the reload after gh confirms it.
  toggleLabel(l, cx) {
    const has = this.issue.labels.some((x) => x.name === l.name);
    this.issue.labels = has ? this.issue.labels.filter((x) => x.name !== l.name) : [...this.issue.labels, l];
    this.change("Saving labels", ["edit", has ? "--remove-label" : "--add-label", l.name], cx);
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

  button(id, label, t, onClick, { primary = false, enabled = true, glyph = null, tint = null } = {}) {
    const solid = primary && enabled;
    return h_flex().id(id).h(32).px(12).gap(6).flex_none().items_center().justify_center().rounded(6).text_size(13).font_medium()
      .bg(solid ? GITHUB.open : t.raised).border_1().border_color(solid ? GITHUB.open : t.border).text_color(solid ? "#ffffff" : enabled ? t.foreground : t.dim)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(solid ? "#29903b" : t.hover)).on_click(onClick))
      .when(Boolean(glyph), (e) => e.child(this.glyph(glyph, 14, tint ?? (solid ? "#ffffff" : t.muted))))
      .when(label !== "", (e) => e.child(label));
  }

  badge(label, t) {
    return div().h(20).px(7).flex_none().flex().items_center().rounded(10).border_1().border_color(t.border).text_size(12).text_color(t.muted).child(label);
  }

  // A comment card: the avatar, who and when on its header bar, roles on the right,
  // then the markdown and its reactions.
  card(key, c, t, cx) {
    const author = login(this.issue.author);
    return v_flex().flex_none().rounded(6).border_1().border_color(t.border).overflow_hidden().bg(t.background)
      .child(h_flex().h(38).px(12).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border).text_size(13)
        .child(this.pic(c.login, c.avatar, 20, t, cx))
        .child(div().font_semibold().text_color(t.foreground).child(shown(c.login)))
        .when(bot(c.login), (e) => e.child(this.badge("bot", t)))
        .child(div().text_color(t.muted).child(c.first ? `opened ${ago(c.at)}` : ago(c.at)))
        .child(div().flex_1())
        .when(!c.first && c.login === author, (e) => e.child(this.badge("Author", t)))
        .when(!c.first && Boolean(ROLES[c.role]), (e) => e.child(this.badge(ROLES[c.role], t))))
      .child(div().px(16).py(14).text_size(14).child(c.body?.trim()
        ? this.markdown(key, c.body, t, cx)
        : div().text_color(t.muted).italic().child("No description provided.")))
      .when(c.reactions?.length > 0, (e) => e.child(h_flex().px(16).pb(14).gap(6).flex_wrap()
        .children(c.reactions.map((r) => h_flex().h(26).px(8).gap(5).items_center().rounded(13).border_1().border_color(t.border).bg(t.raised)
          .text_size(12).text_color(t.muted).child(div().text_size(14).child(r.emoji)).child(String(r.count))))));
  }

  // Markdown with its images drawn in between the text.
  markdown(key, body, t, cx) {
    const parts = blocks(body);
    return v_flex().gap(12).children(parts.map((b, n) => b.image ? this.picture(`${key}-${n}`, b, t, cx)
      : TextView.markdown(`${key}-${n}`, linkify(b.text, this.repo)).selectable(true).on_link_click((url, cx) => this.link(url, cx))));
  }

  // As GitHub sizes one: its width attribute, else its own, never wider than the column.
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

  // An event on the timeline: a round icon on the line, then who did what, when.
  event(key, e, t, cx) {
    const strong = (text) => div().font_semibold().text_color(t.foreground).child(text);
    const muted = (text) => div().child(text);
    const [glyph, fill] = e.kind === "closed" ? [e.reason === "not_planned" ? "skipped" : "done", e.reason === "not_planned" ? GITHUB.skipped : GITHUB.done]
      : e.kind === "reopened" ? ["issue", GITHUB.open]
      : [{ labels: "tag", assign: "user", renamed: "pencil", milestone: "milestone", mention: "link", commit: "commit" }[e.kind], null];
    const parts = [];
    switch (e.kind) {
      case "labels":
        if (e.added.length) parts.push(muted("added"), ...e.added.map((l) => labelChip(l, t)));
        if (e.added.length && e.removed.length) parts.push(muted("and"));
        if (e.removed.length) parts.push(muted("removed"), ...e.removed.map((l) => labelChip(l, t)));
        parts.push(muted(e.added.length + e.removed.length === 1 ? "label" : "labels"));
        break;
      case "assign":
        parts.push(...(e.who === e.login ? [muted(e.added ? "self-assigned this" : "removed their assignment")] : [muted(e.added ? "assigned" : "unassigned"), strong(shown(e.who))]));
        break;
      case "closed": parts.push(muted(`closed this as ${e.reason === "not_planned" ? "not planned" : "completed"}`)); break;
      case "reopened": parts.push(muted("reopened this")); break;
      case "renamed": parts.push(muted("changed the title"), div().line_through().child(e.from ?? ""), strong(e.to ?? "")); break;
      case "milestone": parts.push(muted(e.added ? "added this to the" : "removed this from the"), strong(e.title ?? ""), muted("milestone")); break;
      case "mention": parts.push(muted("mentioned this")); break;
      case "commit": parts.push(muted("added a commit that references this issue")); break;
    }
    const color = e.state === "OPEN" || e.state === "open" ? GITHUB.open : e.merged || e.state === "closed" ? GITHUB.done : t.muted;
    return v_flex().flex_none().gap(6)
      .child(h_flex().pl(6).gap(10).items_center()
        .child(div().size(28).flex_none().rounded(14).flex().items_center().justify_center().bg(fill ?? t.raised).border_1().border_color(fill ?? t.border)
          .child(this.glyph(glyph, 14, fill ? "#ffffff" : t.muted)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center().flex_wrap().text_size(13).text_color(t.muted)
          .child(this.pic(e.login, e.avatar, 16, t, cx)).child(strong(shown(e.login))).children(parts)
          .child(div().underline().child(ago(e.at)))))
      .when(e.kind === "mention", (el) => el.child(h_flex().id(key).ml(44).gap(8).items_start().cursor_pointer().text_size(13)
        .on_click((_ev, cx) => this.link(e.url, cx))
        .child(this.glyph(e.pr ? "pull" : "issue", 16, color))
        .child(div().flex_1().min_w(0).child(h_flex().gap(6).flex_wrap()
          .child(div().font_semibold().text_color(t.foreground).hover((s) => s.text_color(GITHUB.link)).child(e.title ?? ""))
          .child(div().text_color(t.muted).child(`${e.repo === this.repo ? "" : e.repo}#${e.number}`))))))
      .when(e.kind === "commit", (el) => el.child(h_flex().id(key).ml(44).gap(8).items_center().cursor_pointer().text_size(12)
        .on_click(() => openUrl(e.url))
        .child(div().px(6).py(1).rounded(5).bg(t.raised).border_1().border_color(t.border).text_color(t.muted).hover((s) => s.text_color(GITHUB.link))
          .child(e.sha.slice(0, 7)))));
  }

  joint(t) { return div().flex_none().ml(19).w(2).h(16).bg(t.border); }

  thread(i, t, cx) {
    const items = this.timelines[this.id()]
      ?? i.comments.map((c) => ({ kind: "comment", login: login(c.author), at: c.createdAt, body: c.body, role: c.authorAssociation, reactions: reactions(c.reactionGroups) }));
    const first = { kind: "comment", first: true, login: login(i.author), at: i.createdAt, body: i.body, reactions: reactions(i.reactionGroups) };
    return [this.card("issue-body", first, t, cx), ...items.flatMap((e, n) => [this.joint(t),
      e.kind === "comment" ? this.card(`issue-comment-${n}`, e, t, cx) : this.event(`issue-event-${n}`, e, t, cx)])];
  }

  composer(i, t, cx) {
    const open = i.state === "OPEN", busy = Boolean(this.busy), text = Boolean(this.replying);
    const tab = (id, label) => div().id(`issue-tab-${id}`).h(32).px(14).flex().items_center().rounded_t(6).text_size(13).cursor_pointer()
      .when(this.tab === id, (e) => e.bg(t.background).border_1().border_b(0).border_color(t.border).text_color(t.foreground))
      .when(this.tab !== id, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.tab = id; cx.notify(); }).child(label);
    return v_flex().flex_none().gap(10)
      .child(div().text_size(16).font_semibold().child("Add a comment"))
      .child(v_flex().rounded(6).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(8).pt(8).gap(4).items_end().bg(t.raised).border_b(1).border_color(t.border)
          .child(tab("write", "Write")).child(tab("preview", "Preview")))
        .child(this.tab === "write"
          ? div().id("issue-reply").px(12).py(10).bg(t.background).cursor_text().child(Textarea.new(this.reply).w_full().text_size(14).text_color(t.foreground))
          : div().px(16).py(14).min_h(110).bg(t.background).text_size(14).child(text
            ? TextView.markdown("issue-preview", linkify(this.reply.value(), this.repo)).on_link_click((url, cx) => this.link(url, cx))
            : div().text_color(t.muted).child("Nothing to preview")))
        .child(h_flex().px(12).py(10).gap(8).items_center().bg(t.background).border_t(1).border_color(t.border)
          .child(div().flex_1().text_size(12).text_color(t.muted).child("Markdown is supported · Ctrl+Enter comments"))
          .child(open
            ? h_flex().gap(0)
              .child(this.button("issue-close-done", text ? "Close with comment" : "Close issue", t, (_e, cx) => this.setState(true, "completed", cx), { enabled: !busy, glyph: "done", tint: GITHUB.done }))
              .child(this.button("issue-close-more", "▾", t, (_e, cx) => { this.closeMenu = !this.closeMenu; cx.notify(); }, { enabled: !busy }))
            : this.button("issue-reopen", text ? "Reopen with comment" : "Reopen issue", t, (_e, cx) => this.setState(false, null, cx), { enabled: !busy, glyph: "issue", tint: GITHUB.open }))
          .child(this.button("issue-comment", "Comment", t, (_e, cx) => this.comment(cx), { primary: true, enabled: text && !busy })))
        .when(open && Boolean(this.closeMenu), (e) => e.child(v_flex().px(8).py(6).border_t(1).border_color(t.border).bg(t.raised)
          .children([["done", "Close as completed", "Done, closed, fixed, resolved", "completed", GITHUB.done], ["skipped", "Close as not planned", "Won't fix, can't repro, stale", "not planned", GITHUB.skipped]]
            .map(([glyph, title, note, reason, tint]) => h_flex().id(`issue-close-${reason}`).px(8).py(6).gap(10).items_start().rounded(6).cursor_pointer()
              .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.setState(true, reason, cx))
              .child(div().pt(2).child(this.glyph(glyph, 16, tint)))
              .child(v_flex().child(div().text_size(13).font_semibold().child(title)).child(div().text_size(12).text_color(t.muted).child(note))))))));
  }

  section(title, t, body, action = null) {
    return v_flex().flex_none().gap(8).py(14).border_b(1).border_color(t.border)
      .child(h_flex().items_center().text_size(12).font_semibold().text_color(t.muted)
        .child(div().flex_1().child(title)).when(Boolean(action), (e) => e.child(action)))
      .child(body);
  }

  sidebar(i, t, cx) {
    const pr = i.url.includes("/pull/"), mine = i.assignees.some((a) => a.login === this.me), all = this.labels[this.repo];
    const none = (text) => div().text_size(12).text_color(t.muted).child(text);
    const action = (id, label, onClick) => div().id(id).text_size(12).font_normal().text_color(GITHUB.link).cursor_pointer().hover((s) => s.underline()).on_click(onClick).child(label);
    // Everyone who wrote or did something here, in order of appearance, people only.
    const people = new Map();
    for (const [name, url] of [[login(i.author)], ...i.comments.map((c) => [login(c.author)]), ...(this.timelines[this.id()] ?? []).map((e) => [e.login, e.avatar])])
      if (!bot(name)) people.set(name, people.get(name) ?? url ?? null);
    const prs = i.closedByPullRequestsReferences ?? [];
    return v_flex().id("issue-sidebar").w(264).flex_none().min_h(0).overflow_y_scrollbar().pl(8).pr(24).pt(6)
      .child(this.section("Assignees", t, i.assignees.length
        ? v_flex().gap(8).children(i.assignees.map((a) => h_flex().gap(8).items_center().text_size(13).font_semibold().child(this.pic(a.login, null, 20, t, cx)).child(a.login)))
        : h_flex().gap(4).child(none("No one ·")).when(!pr && Boolean(this.me), (e) => e.child(action("issue-assign", "Assign yourself", (_e, cx) => this.change("Assigning", ["edit", "--add-assignee", "@me"], cx)))),
        !pr && mine ? action("issue-unassign", "Unassign me", (_e, cx) => this.change("Unassigning", ["edit", "--remove-assignee", "@me"], cx)) : null))
      .child(this.section("Labels", t, this.editing
        ? (!all ? none("Loading labels…") : v_flex().gap(1).children(all.map((l) => {
          const on = i.labels.some((x) => x.name === l.name);
          return h_flex().id(`label-${l.name}`).px(6).py(5).gap(8).items_start().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.toggleLabel(l, cx))
            .child(div().w(14).flex_none().text_size(12).text_color(GITHUB.link).child(on ? "✓" : ""))
            .child(div().mt(3).size(12).flex_none().rounded(6).bg(`#${l.color}`))
            .child(v_flex().flex_1().min_w(0).child(div().text_size(13).font_semibold().child(l.name))
              .when(Boolean(l.description), (e) => e.child(div().text_size(12).text_color(t.muted).truncate().child(l.description))));
        })))
        : i.labels.length ? h_flex().gap(4).flex_wrap().children(i.labels.map((l) => labelChip(l, t))) : none("No labels"),
        pr ? null : action("issue-labels-edit", this.editing ? "Done" : "Edit", (_e, cx) => this.editLabels(cx))))
      .child(this.section("Milestone", t, i.milestone?.title
        ? h_flex().gap(6).items_center().text_size(13).font_semibold().child(this.glyph("milestone", 14, t.muted)).child(i.milestone.title)
        : none("No milestone")))
      .child(this.section("Development", t, prs.length
        ? v_flex().gap(8).children(prs.map((p) => h_flex().id(`issue-pr-${p.number}`).gap(8).items_start().cursor_pointer().text_size(13)
          .on_click((_e, cx) => this.link(p.url, cx))
          .child(div().pt(1).child(this.glyph("pull", 14, GITHUB.done)))
          .child(v_flex().child(div().font_semibold().hover((s) => s.text_color(GITHUB.link)).child(`#${p.number}`))
            .child(div().text_size(12).text_color(t.muted).child(`${p.repository?.owner?.login}/${p.repository?.name}`)))))
        : none("No branches or pull requests")))
      .child(this.section("Participants", t, h_flex().gap(4).flex_wrap().children([...people].slice(0, 18).map(([name, url]) => this.pic(name, url, 24, t, cx)))));
  }

  render(cx) {
    const t = theme(), i = this.issue;
    const bar = h_flex().h(32).gap(8).items_center()
      .when(this.history.length > 0, (e) => e.child(this.button("issue-back", "Back", t, (_e, cx) => this.back(cx), { glyph: "back" })))
      .child(div().text_size(13).text_color(t.muted).child(i?.url.includes("/pull/") ? `${this.repo} · pull request` : this.repo))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.ansi1).truncate().child(i && this.error ? this.error : ""))
      .when(this.loading || Boolean(this.busy), (e) => e.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child(this.busy ?? "Refreshing")))
      .when(Boolean(i) && !this.loading && !this.busy, (e) => e.child(this.button("issue-refresh", "Refresh", t, (_e, cx) => { this.load(cx); cx.notify(); }, { glyph: "refresh" })))
      .when(Boolean(i), (e) => e.child(this.button("issue-copy", "Copy", t, () => copyMenu({ repo: this.repo, number: i.number, title: i.title, url: i.url }), { glyph: "copy" })))
      .when(Boolean(i), (e) => e.child(this.button("issue-github", "Open on GitHub", t, () => openUrl(i.url), { glyph: "external" })))
      .child(this.button("issue-close", "", t, () => closeOverlay(this.overlay), { glyph: "close" }));
    if (!i) return v_flex().id("issue").size_full().bg(t.background).text_color(t.foreground).text_size(14).px(32).pt(16).gap(20)
      .child(bar)
      .child(this.loading ? div().text_color(t.muted).child(`Loading #${this.number}…`) : div().text_color(t.ansi1).child(this.error ?? ""));

    const pr = i.url.includes("/pull/");
    const [state, color, glyph] = i.state === "OPEN" ? ["Open", GITHUB.open, "issue"] : i.state === "MERGED" ? ["Merged", GITHUB.done, "pull"]
      : i.stateReason === "NOT_PLANNED" ? ["Closed", GITHUB.skipped, "skipped"] : ["Closed", GITHUB.done, "done"];
    return v_flex().id("issue").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(14)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(v_flex().flex_none().px(32).pt(14).pb(18).gap(14).border_b(1).border_color(t.border)
        .child(bar)
        // Word by word, so the title wraps like text with the number after its last word.
        .child(h_flex().flex_wrap().gap_x(8).text_size(30).children(i.title.split(/\s+/).filter(Boolean).map((w) => div().child(w)))
          .child(div().text_color(t.muted).child(`#${i.number}`)))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(h_flex().h(32).px(12).gap(6).items_center().rounded(16).bg(color).text_color("#ffffff").text_size(14).font_semibold()
            .child(this.glyph(glyph, 16, "#ffffff")).child(state))
          .children((i.closedByPullRequestsReferences ?? []).map((p) => h_flex().id(`issue-pill-${p.number}`).h(32).px(12).gap(6).items_center().rounded(16)
            .border_1().border_color(t.border).text_size(13).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.link(p.url, cx)).child(this.glyph("pull", 14, GITHUB.done)).child(`#${p.number}`)))
          .when(pr, (e) => e.child(div().text_size(13).text_color(t.muted).child("Pull request")))))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id(`issue-thread-${this.id()}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().pl(32).pr(24).py(20)
          .children(this.thread(i, t, cx))
          .when(!pr, (e) => e.child(div().flex_none().h(28)).child(this.composer(i, t, cx)))
          .child(div().flex_none().h(24)))
        .child(this.sidebar(i, t, cx)));
  }
}
