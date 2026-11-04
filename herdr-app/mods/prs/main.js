import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, run, layout, theme, notify, props, shared, setShared, openOverlay } from "herdr";
import { normalize, reviewOf, counts, shown, SCOPES, CHIPS } from "./model.js";
import { icons, icon } from "./icons.js";
import { Viewer } from "./viewer.js";

const REFRESH = 60000;
const FIELDS = "number,title,url,author,assignees,reviewRequests,latestReviews,reviewDecision,isDraft,labels,updatedAt,statusCheckRollup,headRefName,baseRefName,additions,deletions,changedFiles";
const STATES = { open: { label: "Open", limit: 100 }, merged: { label: "Merged", limit: 40 }, closed: { label: "Closed", limit: 30 } };
const REVIEW = { approved: ["Approved", "ansi2"], changes: ["Changes requested", "ansi1"], needs: ["Needs review", "ansi3"], draft: ["Draft", "dim"] };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
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
    const { pr, overlay, button } = props() ?? {};
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
      if (changed && changed !== this.changedAt) { this.changedAt = changed; if (!hidden()) this.refresh(cx); }
      else if (!hidden() && this.context() !== this.ctx) this.refresh(cx);
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

  refresh(cx, state = this.state) {
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
        this.me = await this.login(this.repoOn);
        const r = await exec("gh", ["pr", "list", "-R", repo, "--state", state, "--limit", String(STATES[state].limit), "--json", FIELDS], { on: this.repoOn });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        (this.lists[repo] ??= {})[state] = { prs: JSON.parse(r.stdout).map((p) => normalize(p, state)), at: Date.now() };
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

  segment(id, label, on, t, onClick) {
    return div().id(id).h(24).px(9).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.bg(on ? t.selected : t.hover)).on_click(onClick).child(label);
  }

  pill(id, t, color, label, glyph) {
    return h_flex().id(id).h(18).px(6).gap(4).flex_none().items_center().rounded(9).border_1().border_color(t.border).text_size(11).text_color(color)
      .when(Boolean(glyph) && this.icons, (e) => e.child(svg(icon(glyph)).size(11))).child(label);
  }

  row(p, t) {
    const review = reviewOf(p), [label, tone] = REVIEW[review];
    const tint = p.state === "merged" ? t.ansi5 : p.state === "closed" ? t.ansi1 : p.draft ? t.dim : t.ansi2;
    const glyph = p.state === "merged" ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open";
    const ci = { passing: t.ansi2, failing: t.ansi1, pending: t.ansi3 }[p.ci];
    const meta = [];
    if (p.state === "open" && !p.draft) meta.push(this.pill(`rv-${p.number}`, t, t[tone], label, review === "approved" ? "check" : review === "changes" ? "x" : "eye"));
    if (p.state === "open" && ci) meta.push(div().size(8).flex_none().rounded(4).bg(ci).tooltip(`Checks ${p.ci}`));
    if (p.state === "open") meta.push(p.assignees.length
      ? h_flex().gap(4).items_center().flex_none().text_size(11).text_color(t.muted).child(p.assignees.slice(0, 2).join(", "))
      : h_flex().gap(4).items_center().flex_none().text_size(11).text_color(t.ansi3).child("Unassigned"));
    meta.push(div().flex_none().text_size(11).text_color(t.dim).child(p.author));
    meta.push(h_flex().gap(4).flex_none().text_size(11).child(div().text_color(t.ansi2).child(`+${p.adds}`)).child(div().text_color(t.ansi1).child(`−${p.dels}`)));
    return v_flex().id(`pr-${p.number}`).flex_none().min_w(0).px(10).py(6).gap(3).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${p.head} → ${p.base} · Right click: copy branch name`)
      .on_click(() => this.open(p))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation(); cx.write_to_clipboard(p.head);
        notify({ title: "Branch copied", body: p.head, level: "success", timeout: 2500 });
      })
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(icon(glyph)).size(14).text_color(tint))))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(p.state === "open" ? t.foreground : t.muted).child(p.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${p.number}`)))
      .child(h_flex().gap(8).pl(22).items_center().min_w(0).text_size(11).text_color(t.dim)
        .child(h_flex().gap(8).items_center().flex_1().min_w(0).overflow_hidden().children(meta))
        .child(div().flex_none().child(age(p.updatedAt))));
  }

  open(p) {
    openOverlay({ mod: "prs", kind: "dialog", width: 0.86, height: 0.9, props: { pr: { repo: this.repo, number: p.number, on: this.repoOn ?? null, title: p.title, me: this.me } } });
  }

  render(cx) {
    if (this.viewer) return this.viewer.render(cx);
    const t = theme();
    if (this.button) return this.toolbar(t);
    const shell = v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    if (!this.repo) return shell.child(v_flex().flex_1().items_center().justify_center().gap(10).px(36)
      .child(div().size(28).when(this.icons, (e) => e.child(svg(icon("open")).size(28).text_color(t.dim))))
      .child(div().font_semibold().text_color(t.muted).child(this.syncing ? "Looking for a repository…" : "No repository yet"))
      .child(div().text_size(12).text_color(t.dim).text_center().child("Focus a terminal inside a GitHub repository and its pull requests show up here.")));
    const entry = this.lists[this.repo]?.[this.state], prs = entry?.prs ?? [];
    const chip = this.state === "open" ? this.chipOf() : "all", c = counts(prs, this.scope, this.me);
    const list = shown(prs, { scope: this.scope, chip, query: this.query, me: this.me });
    const empty = this.error ?? (!entry ? "Loading pull requests…" : this.query.trim() ? "No pull requests match" : "Nothing here");
    return shell
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(icon("open")).size(14).text_color(t.ansi2))))
        .child(div().font_semibold().child("Pull requests"))
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).text_right().truncate().child(this.repo))
        .child(h_flex().id("prs-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(7).border_1().border_color(t.border).text_size(12).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .child(this.syncing
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12))))
          .child(this.syncing ? "Syncing" : "Refresh")))
      .child(v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
            .children(Object.entries(SCOPES).map(([k, label]) => this.segment(`scope-${k}`, label, this.scope === k, t, (_e, cx) => { this.scope = k; keep("scope", k); cx.notify(); }))))
          .child(div().flex_1())
          .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
            .children(Object.entries(STATES).map(([k, s]) => this.segment(`state-${k}`, s.label, this.state === k, t, (_e, cx) => {
              this.state = k; keep("state", k);
              if (!this.lists[this.repo]?.[k]) this.refresh(cx, k);
              cx.notify();
            })))))
        .child(div().id("prs-filter").h(28).px(9).flex().items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .when(this.state === "open", (e) => e.child(h_flex().gap(4).items_center().flex_wrap()
          .children(Object.entries(CHIPS[this.scope]).filter(([k]) => k === "all" || k === chip || c[k] > 0).map(([k, ch]) =>
            this.segment(`chip-${k}`, `${ch.label} ${c[k]}`, chip === k, t, (_e, cx) => { this.chip[this.scope] = k; keep("chip", this.chip); cx.notify(); }))))))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(list.map((p) => this.row(p, t)))
        .when(!list.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
