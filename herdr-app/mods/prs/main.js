import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, run, layout, theme, notify, props, shared, setShared, openOverlay } from "herdr";
import { normalize, reviewOf, counts, shown, grouped, SCOPES, CHIPS } from "./model.js";
import { avatar } from "./people.js";
import { shown as handle } from "./timeline.js";
import { icons, icon } from "./icons.js";
import { Viewer } from "./viewer.js";
import { Menu } from "./menu.js";

const REFRESH = 60000;
const BASIC = "number,title,url,author,assignees,isDraft,labels,updatedAt,headRefName,headRefOid,baseRefName,additions,deletions,changedFiles";
// What the open list needs to judge a PR; merged and closed ones are only listed, so they skip the heavy review, comment and check data.
const FIELDS = { open: `${BASIC},reviewRequests,latestReviews,comments,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`, merged: BASIC, closed: BASIC };
// A change of focus or panel re-uses a list this young instead of asking GitHub again.
const FRESH = 15000;
const STATES = { open: { label: "Open", limit: 100 }, merged: { label: "Merged", limit: 40 }, closed: { label: "Closed", limit: 30 } };
const REVIEW = { approved: ["Approved", "ansi2", "check"], changes: ["Changes requested", "ansi1", "x"], needs: ["Needs review", "ansi3", "eye"], draft: ["Draft", "muted", "draft"] };
const MERGE = { conflicts: ["Conflicts", "ansi1", "alert"], behind: ["Behind", "ansi3", "alert"], clean: ["Clean", "ansi2", "check"], unknown: ["Checking", "muted", "dot"] };
const CI = { passing: ["CI", "ansi2", "check"], failing: ["CI failing", "ansi1", "x"], pending: ["CI running", "ansi3", "dot"] };
const CHIP_TONES = { conflicts: "ansi1", changes: "ansi1", approved: "ansi2", needs: "ansi3", reviewing: "ansi4" };
const SECTION_TONES = { attention: "ansi1", ready: "ansi2", waiting: "ansi3", draft: "muted", needs: "ansi3", reviewing: "ansi4", changes: "ansi1", approved: "ansi2" };
const LAST = { changes: ["requested changes", "ansi1"], approved: ["approved", "ansi2"], reviewed: ["reviewed", "ansi4"], comment: ["commented", "ansi4"] };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

// `gh pr list` returns every review's commit as empty, so ask GraphQL which commit each verdict was left on.
// Best effort: on failure reviews keep no commit and are treated as current.
async function reviewCommits(repo, raw, on) {
  const [owner, name] = repo.split("/");
  const query = `query($o:String!,$n:String!){repository(owner:$o,name:$n){pullRequests(states:OPEN,first:100){nodes{number latestReviews(first:30){nodes{author{login} commit{oid}}}}}}}`;
  try {
    const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`, "-f", `o=${owner}`, "-f", `n=${name}`], { on });
    if (r.code !== 0) return;
    const oids = new Map();
    for (const p of JSON.parse(r.stdout).data.repository.pullRequests.nodes)
      for (const v of p.latestReviews.nodes) oids.set(`${p.number}:${v.author?.login}`, v.commit?.oid);
    for (const p of raw) for (const v of p.latestReviews ?? []) v.commit = { oid: oids.get(`${p.number}:${v.author?.login}`) ?? v.commit?.oid };
  } catch { /* keep the list usable without commits */ }
}

// Nothing to fetch while another panel (or none) is showing.
function hidden() {
  const root = layout(), body = find(root, "panel-body");
  return find(root, "panel")?.hidden || find(body, body?.active)?.content?.mod !== "prs";
}

// Where the focused pane is, as the Changes panel finds it. A focused mod pane keeps the last one.
function location(last) {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane && !pane.terminal && last) return last;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => localStorage.setItem(key, JSON.stringify(value));

function age(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}

export default class Prs extends View {
  init(_props, cx) {
    const { pr, overlay, button, menu } = props() ?? {};
    if (menu) { this.menu = new Menu(menu, overlay, cx); return; }
    if (pr) { this.viewer = new Viewer(pr, overlay, cx); return; }
    if (button) {
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("prs")) setShared("workspace.panels", [...panels, "prs"]);
      this.button = true;
      cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
      return;
    }
    this.scope = SCOPES[remembered("scope")] ? remembered("scope") : "all";
    this.chip = remembered("chip", {});
    this.state = STATES[remembered("state")] ? remembered("state") : "open";
    this.query = "";
    this.fold = new Set(remembered("fold", []));
    this.lists = {};            // repo -> state -> { prs, at }
    this.repos = remembered("repos", {}); this.logins = remembered("logins", {}); this.spaceRepos = remembered("spaces", {});
    this.repo = null; this.last = null;
    this.input = InputState.new({ placeholder: "Filter pull requests" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH, (cx) => { if (!hidden()) this.refresh(cx); });
    // A change made in the dialog shows in the list within a few seconds.
    cx.timer.every(3000, (cx) => {
      const changed = shared("prs.changed")?.at;
      const gone = hidden();
      if (changed && changed !== this.changedAt) { this.changedAt = changed; if (!gone) this.refresh(cx); }
      else if (!gone && (this.gone || this.context() !== this.ctx)) this.refresh(cx, this.state, FRESH);
      this.gone = gone;
    });
  }

  where() { return (this.last = location(this.last)); }
  context() { return JSON.stringify([this.where(), focused()?.space]); }

  async repoFor(cwd, on) {
    const id = JSON.stringify([cwd, on]);
    if (!this.repos[id]) {
      const r = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, on });
      if (r.code === 0) { this.repos[id] = r.stdout.trim(); keep("repos", this.repos); }
    }
    return this.repos[id] ?? null;
  }

  async login(on) {
    const id = on ?? "";
    if (!this.logins[id]) {
      const r = await exec("gh", ["api", "user", "-q", ".login"], { on });
      if (r.code === 0) { this.logins[id] = r.stdout.trim(); keep("logins", this.logins); }
    }
    return this.logins[id];
  }

  // Each space keeps the repo its own terminals were last in: a folder outside any repo keeps it.
  pick(found, space, on) {
    if (found) { this.spaceRepos[space] = { repo: found, on }; keep("spaces", this.spaceRepos); }
    const s = spaces().find((x) => x.id === space), tabs = new Set(s?.tabs.map((tab) => tab.id) ?? []);
    const guess = panes().map((p) => (tabs.has(p.tab) && p.cwd ? this.repos[JSON.stringify([p.cwd, s?.machine ?? null])] : null)).find(Boolean);
    const choice = this.spaceRepos[space] ?? (guess ? { repo: guess, on: s?.machine ?? null } : null);
    this.repo = choice?.repo ?? null; this.repoOn = choice?.on ?? null;
  }

  // maxAge: keep a list younger than this (ms) instead of fetching it again; 0 always fetches.
  refresh(cx, state = this.state, maxAge = 0) {
    const { cwd, on } = this.where(), context = this.context(), space = focused()?.space;
    if (context !== this.ctx) { this.ctx = context; this.error = null; this.pick(cwd ? this.repos[JSON.stringify([cwd, on])] : null, space, on); }
    if (this.syncing) { this.again = true; return; }
    this.syncing = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const found = cwd ? await this.repoFor(cwd, on) : null;
        this.pick(found, space, on);
        const repo = this.repo;
        if (!repo) return;
        const have = this.lists[repo]?.[state];
        if (have && Date.now() - have.at < maxAge) { this.error = null; return; }
        this.me = await this.login(this.repoOn);
        const r = await exec("gh", ["pr", "list", "-R", repo, "--state", state, "--limit", String(STATES[state].limit), "--json", FIELDS[state]], { on: this.repoOn });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        const raw = JSON.parse(r.stdout);
        if (state === "open") await reviewCommits(repo, raw, this.repoOn);
        (this.lists[repo] ??= {})[state] = { prs: raw.map((p) => normalize(p, state)), at: Date.now() };
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      finally {
        this.syncing = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  chipOf() { return CHIPS[this.scope][this.chip[this.scope]] ? this.chip[this.scope] : "all"; }

  toolbar(t) {
    const root = layout(), panel = find(root, "panel"), on = panel && !panel.hidden && find(root, "panel-body")?.active === "prs";
    return h_flex().size_full().pr(4).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-prs").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "prs" }); run("layout.show", { id: "panel" }); }
        })
        .child(div().size(14).when(this.icons, (e) => e.child(svg(icon("open")).size(14)))).child("PRs"));
  }

  // A tab of the header: the active one is underlined with the accent.
  tab(id, t, on, onClick, ...kids) {
    return h_flex().id(id).h_full().px(8).gap(6).flex_none().items_center().text_size(13).cursor_pointer()
      .border_b(2).border_color(on ? t.accent : "#00000000").text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.text_color(t.foreground)).on_click(onClick).children(kids.filter(Boolean));
  }

  // One side of the All/Mine switch: the chosen one lifts off the track.
  scopeTab(key, label, on, count, t, onClick) {
    return h_flex().id(`scope-${key}`).h(24).px(10).gap(5).items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : "#00000000").text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_medium())
      .hover((s) => s.text_color(t.foreground)).on_click(onClick)
      .child(label).when(count !== null, (e) => e.child(div().text_size(11).font_normal().text_color(t.dim).child(String(count))));
  }

  // A filter: a dot in the colour of what it finds, its name and how many; bare until chosen.
  chipView(key, label, count, on, t, onClick) {
    const tone = CHIP_TONES[key];
    return h_flex().id(`chip-${key}`).h(24).px(8).gap(6).flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : "#00000000").text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_medium())
      .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_click(onClick)
      .when(Boolean(tone), (e) => e.child(div().size(6).flex_none().rounded(3).bg(count > 0 ? t[tone] : t.dim)))
      .child(label).child(div().text_size(11).font_normal().text_color(t.dim).child(String(count)));
  }

  // A status: a loud tinted capsule when it needs a look, a quiet glyph and word when it's the expected case.
  tag(id, t, color, label, glyph, tip, quiet = false) {
    return h_flex().id(id).h(20).gap(4).flex_none().items_center().text_size(11).font_medium().text_color(quiet ? t.muted : color)
      .when(!quiet, (e) => e.px(7).rounded(10).bg(color === t.muted ? t.raised : `${color}24`))
      .when(Boolean(tip), (e) => e.tooltip(tip))
      .when(Boolean(glyph) && this.icons, (e) => e.child(svg(icon(glyph)).size(11).text_color(color))).child(label);
  }

  // implied: the section the row sits in already says its review state, so the capsule is left out.
  row(p, t, cx, implied = false) {
    const open = p.state === "open", review = reviewOf(p), [label, tone, glyph] = REVIEW[review];
    const mine = this.scope === "mine";
    const [mergeLabel, mergeTone, mergeGlyph] = MERGE[p.merge];
    const tags = [];
    if (open) {
      if (!implied) tags.push(this.tag(`rv-${p.number}`, t, t[tone], label, glyph));
      if (!p.draft) tags.push(this.tag(`mg-${p.number}`, t, t[mergeTone], mergeLabel, mergeGlyph, `${p.head} → ${p.base}`, ["clean", "unknown"].includes(p.merge)));
      if (p.merge === "clean" && p.blocked && review === "approved") tags.push(this.tag(`bl-${p.number}`, t, t.ansi3, "Blocked", "alert", "Approved, but GitHub still blocks the merge: required checks or reviews are missing"));
      if (p.ci) { const [ciLabel, ciTone, ciGlyph] = CI[p.ci]; tags.push(this.tag(`ci-${p.number}`, t, t[ciTone], ciLabel, ciGlyph, `Checks ${p.ci}`, p.ci !== "failing")); }
    } else tags.push(this.tag(`st-${p.number}`, t, p.state === "merged" ? t.ansi5 : t.ansi1, p.state === "merged" ? "Merged" : "Closed", p.state === "merged" ? "merged" : "closed"));
    const reviewers = open && p.assignees.length
      ? h_flex().gap(5).flex_none().items_center().h(20).pl(7).pr(3).rounded(10).bg(`${t.ansi4}24`).text_size(11).font_medium().text_color(t.ansi4)
        .tooltip(`Being reviewed by ${p.assignees.join(", ")}`)
        .when(this.icons, (e) => e.child(svg(icon("eye")).size(11))).child("Reviewing")
        .child(h_flex().gap(2).items_center().children(p.assignees.slice(0, 3).map((a) => avatar(a, null, 14, t, cx))))
      : null;
    const last = open && p.last ? p.last : null, [verb, lastTone] = LAST[last?.kind] ?? [];
    const quiet = open && !p.draft ? t.foreground : t.muted;
    return v_flex().id(`pr-${p.number}`).flex_none().min_w(0).px(10).py(9).gap(7).rounded(8).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${p.head} → ${p.base} · Right click: copy branch name`)
      .on_click(() => this.open(p))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation(); cx.write_to_clipboard(p.head);
        notify({ title: "Branch copied", body: p.head, level: "success", timeout: 2500 });
      })
      .child(h_flex().gap(10).items_start().min_w(0)
        .child(div().pt(1).child(avatar(p.author, null, 28, t, cx)))
        .child(v_flex().flex_1().min_w(0).gap(5)
          .child(h_flex().gap(8).items_center().min_w(0)
            .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(quiet).child(p.title))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${p.number}`)))
          .child(h_flex().gap_x(10).gap_y(5).items_center().flex_wrap().min_w(0).text_size(11)
            .child(h_flex().gap(5).flex_none().items_center().tooltip(`Updated ${age(p.updatedAt)} ago`)
              .when(!mine, (e) => e.child(div().text_color(t.muted).child(handle(p.author))).child(div().text_color(t.dim).child("·")))
              .child(div().text_color(t.dim).child(age(p.updatedAt))))
            .children(tags)
            .when(reviewers !== null, (e) => e.child(reviewers))
            .child(div().flex_1())
            .child(h_flex().gap(4).flex_none().child(div().text_color(t.ansi2).child(`+${p.adds}`)).child(div().text_color(t.ansi1).child(`−${p.dels}`))))
          .when(Boolean(last), (e) => e.child(h_flex().gap(6).items_center().min_w(0).mt(1).px(8).py(4).rounded(6).bg(t.raised).text_size(11)
            .child(avatar(last.login, null, 14, t, cx))
            .child(div().flex_none().font_medium().text_color(t[lastTone]).child(`${handle(last.login)} ${verb}`))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(last.text))
            .child(div().flex_none().text_color(t.dim).child(age(last.at)))))));
  }

  // A section header, folded or unfolded by a click, like the groups of the Issues panel.
  section(key, tone, label, count, closed, t, first) {
    return h_flex().id(`section-${key}`).h(30).flex_none().px(8).gap(8).items_center().rounded(7).bg(t.raised).cursor_pointer().mt(first ? 0 : 8)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.fold.has(key) ? this.fold.delete(key) : this.fold.add(key); keep("fold", [...this.fold]); cx.notify(); })
      .child(div().size(12).flex_none().when(this.icons, (e) => e.child(svg(icon(closed ? "chev-r" : "chev-d")).size(12).text_color(t.dim))))
      .child(div().size(8).flex_none().rounded(4).bg(t[tone]))
      .child(div().font_semibold().text_size(12).child(label))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child(String(count)));
  }

  // Rows with a hairline between them.
  rows(prs, t, cx, implied) {
    return prs.flatMap((p, i) => [...(i ? [div().h(1).flex_none().mx(10).bg(t.border).opacity(0.5)] : []), this.row(p, t, cx, implied)]);
  }

  // cwd only when the focused folder is a clone of this very repo: the dialog reads conflicts from it. seed: what the row already knows, so the dialog's header draws at once.
  open(p) {
    const { cwd, on } = this.where(), clone = cwd && this.repos[JSON.stringify([cwd, on])] === this.repo ? cwd : null;
    const seed = { title: p.title, author: p.author, head: p.head, base: p.base, draft: p.draft, adds: p.adds, dels: p.dels, merge: p.merge, state: p.state };
    openOverlay({ mod: "prs", kind: "dialog", width: 0.86, height: 0.9, props: { pr: { repo: this.repo, number: p.number, on: this.repoOn ?? null, me: this.me, cwd: clone, seed } } });
  }

  render(cx) {
    if (this.viewer) return this.viewer.render(cx);
    if (this.menu) return this.menu.render();
    const t = theme();
    if (this.button) return this.toolbar(t);
    const shell = v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    if (!this.repo) return shell.child(v_flex().flex_1().items_center().justify_center().gap(10).px(36)
      .child(div().size(28).when(this.icons, (e) => e.child(svg(icon("open")).size(28).text_color(t.dim))))
      .child(div().font_semibold().text_color(t.muted).child(this.syncing ? "Looking for a repository…" : "No repository yet"))
      .child(div().text_size(12).text_color(t.dim).text_center().child("Focus a terminal inside a GitHub repository and its pull requests show up here.")));
    const entry = this.lists[this.repo]?.[this.state], prs = entry?.prs ?? [];
    const chip = this.state === "open" ? this.chipOf() : "all", c = counts(prs, this.scope, this.me);
    // Drafts stay out of the default list; the Drafts chip (or a search) brings them in.
    const noDrafts = chip === "all" && !this.query.trim();
    const list = shown(prs, { scope: this.scope, chip, query: this.query, me: this.me }).filter((p) => !noDrafts || !p.draft);
    // Sections only while nothing narrows the list: a chip or a search already is the grouping.
    const sections = this.state === "open" && chip === "all" && !this.query.trim() && list.length ? grouped(list, this.scope) : null;
    const empty = this.error ?? (!entry ? "Loading pull requests…" : this.query.trim() ? "No pull requests match" : "Nothing here");
    const live = prs.filter((p) => !p.draft), mineCount = live.filter((p) => p.author === this.me).length, openCount = this.lists[this.repo]?.open?.prs.filter((p) => !p.draft).length;
    const pickState = (k) => (_e, cx) => {
      this.state = k; keep("state", k);
      if (!this.lists[this.repo]?.[k]) this.refresh(cx, k);
      cx.notify();
    };
    // Clicking the active chip clears it, so there's no "All" chip to carry.
    const chips = this.state === "open" ? Object.entries(CHIPS[this.scope]).filter(([k]) => k !== "all" && (k === chip || c[k] > 0)) : [];
    return shell
      .child(h_flex().h(42).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
        .child(h_flex().h_full().flex_none().min_w(0).gap(2)
          .children(Object.entries(STATES).map(([k, s]) => this.tab(`state-${k}`, t, this.state === k, pickState(k),
            s.label, k === "open" && openCount !== undefined ? div().text_size(11).font_normal().text_color(t.dim).child(String(openCount)) : null))))
        .child(div().flex_1())
        .child(h_flex().id("prs-filter").w(150).min_w(70).h(28).px(8).gap(6).items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(div().size(12).flex_none().when(this.icons, (e) => e.child(svg(icon("search")).size(12).text_color(t.dim))))
          .child(Input.new(this.input).h_full().flex_1().min_w(0).text_size(12).text_color(t.foreground)))
        .child(div().id("prs-refresh").size(28).flex_none().flex().items_center().justify_center().rounded(7).border_1().border_color(t.border).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .tooltip(`${this.repo}${entry ? ` · updated ${age(new Date(entry.at).toISOString())} ago` : ""}`)
          .child(this.syncing
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12))))))
      .child(h_flex().flex_none().px(10).py(8).gap_x(10).gap_y(6).items_center().flex_wrap().border_b(1).border_color(t.border)
        .child(h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.raised)
          .children(Object.entries(SCOPES).map(([k, label]) => this.scopeTab(k, label, this.scope === k, entry ? (k === "mine" ? mineCount : live.length) : null, t,
            (_e, cx) => { this.scope = k; keep("scope", k); cx.notify(); }))))
        .when(chips.length > 0, (e) => e.child(div().w(1).h(16).flex_none().bg(t.border)))
        .children(chips.map(([k, ch]) => this.chipView(k, ch.label, c[k], chip === k, t,
          (_e, cx) => { this.chip[this.scope] = chip === k ? "all" : k; keep("chip", this.chip); cx.notify(); }))))
      .when(Boolean(this.error && entry), (e) => e.child(div().flex_none().px(14).py(6).text_size(11).text_color(t.ansi1).border_b(1).border_color(t.border).truncate().child(this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .children(sections
          ? sections.flatMap((g, i) => {
            const key = `${this.scope}|${g.key}`, closed = this.fold.has(key);
            // The section already says "needs review", "approved" or "draft"; "Needs your attention" mixes states, so its rows keep theirs.
            return [this.section(key, SECTION_TONES[g.key], g.label, g.prs.length, closed, t, i === 0), ...(closed ? [] : this.rows(g.prs, t, cx, this.scope === "all" || g.key !== "attention"))];
          })
          : this.rows(list, t, cx, false))
        .when(!list.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
