import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, hc, run, layout, theme, openOverlay, closeOverlay, notify, props, appHome, shared, setShared } from "herdr";
import * as fs from "fs/promises";
import { Viewer, FIELDS, copyMenu } from "./viewer.js";
import { icons, icon } from "./icons.js";

// Where the focused pane is, as the Changes panel finds it. A focused mod pane
// (this one, as a split) has no folder of its own: it keeps the last one.
function location(last) {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane && !pane.terminal && last) return last;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

const FULL = 300;                 // open issues fetched when a repo has no cache yet
const CLOSED = 100;               // and the most recently closed ones
const SYNC = 30000;               // how often the changes since the last sync are fetched
const RESYNC = 6 * 3600 * 1000;   // a full fetch now and then catches what search misses (deleted, transferred)
const MENTIONS = 8;
const VERSION = 2;                // a cache from another version starts with a full fetch
const folder = () => `${appHome()}/data/issues`;
const file = (repo) => `${folder()}/repo-${repo.replace("/", "__")}.json`;

// GitHub's own sort orders.
const SORTS = {
  newest: { label: "Newest", by: (a, b) => b.number - a.number },
  oldest: { label: "Oldest", by: (a, b) => a.number - b.number },
  updated: { label: "Recently updated", by: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) },
  stale: { label: "Least recently updated", by: (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) },
  comments: { label: "Most commented", by: (a, b) => b.comments.length - a.comments.length || b.number - a.number },
};
const sort = () => SORTS[shared("issues.sort")] ? shared("issues.sort") : "newest";

// #123, and links to this repo's issues and pull requests: the lowest line on
// screen (the newest) first, each line read left to right.
function mentions(text, repo) {
  const found = [], pattern = new RegExp(`(?:^|[^\\w&/#])#(\\d{1,5})(?![\\w-])|github\\.com/${repo.replace(/\./g, "\\.")}/(?:issues|pull)/(\\d+)`, "g");
  for (const line of text.split("\n").reverse()) {
    for (const m of line.matchAll(pattern)) {
      const n = Number(m[1] ?? m[2]);
      if (!found.includes(n)) found.push(n);
    }
  }
  return found;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// As one of the side panels beside Files and Changes, only the one shown works.
function hidden() {
  const root = layout(), body = find(root, "panel-body");
  if (!body?.children?.some((c) => c.content?.mod === "issues")) return false;
  return find(root, "panel")?.hidden || find(body, body.active)?.content?.mod !== "issues";
}

function remembered(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}

function upsert(store, issues) {
  const changed = new Set(issues.map((i) => i.number));
  store.issues = [...store.issues.filter((i) => !changed.has(i.number)), ...issues];
  for (const i of issues) store.known[i.number] = { number: i.number, title: i.title, state: i.state };
}

async function save(repo, store) {
  await fs.mkdir(folder(), { recursive: true });
  await fs.writeFile(file(repo), JSON.stringify(store));
}

// The panel; its Issues button beside the tab bar's Files and Changes (props
// { button: true }); or one issue, the sort menu or the copy menu, as an overlay of the panel.
export default class Issues extends View {
  init(_props, cx) {
    const { issue, overlay, sortMenu, copyMenu: copying, button } = props() ?? {};
    if (issue) { this.viewer = new Viewer(issue, overlay, cx); return; }
    if (sortMenu) { this.menu = overlay; return; }
    if (copying) { this.copying = { ...copying, overlay }; return; }
    if (button) {
      // The tab bar restores each space's panel only if it's one of these.
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("issues")) setShared("workspace.panels", [...panels, "issues"]);
      this.button = true;
      cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
      return;
    }
    // Per repo: its open and recently closed issues in full, what other numbers are, and when they were synced.
    this.stores = {}; this.repos = remembered("repos"); this.logins = remembered("logins");
    this.spaceRepos = remembered("spaces"); this.repo = null;
    this.query = ""; this.state = "OPEN"; this.mine = false; this.mentioned = []; this.changedAt = shared("issues.changed")?.at;
    this.input = InputState.new({ placeholder: "Filter issues" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => { await icons(); this.icons = true; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(SYNC, (cx) => { if (!hidden()) this.refresh(cx); });
    cx.timer.every(3000, (cx) => { if (!hidden()) this.scan(cx); });
  }

  toolbar(t) {
    const root = layout(), panel = find(root, "panel"), on = panel && !panel.hidden && find(root, "panel-body")?.active === "issues";
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-issues").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "issues" }); run("layout.show", { id: "panel" }); }
        })
        .child(div().size(14).when(this.icons, (e) => e.child(svg(icon("issue")).size(14)))).child("Issues"));
  }

  where() { return (this.last = location(this.last)); }

  context() { return JSON.stringify([this.where(), focused()?.space]); }

  // gh resolves the repo from the folder's remotes; a hit is kept per folder.
  async repoFor(cwd, on) {
    const id = JSON.stringify([cwd, on]);
    if (!this.repos[id]) {
      const r = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd, on });
      if (r.code === 0) { this.repos[id] = r.stdout.trim(); localStorage.setItem("repos", JSON.stringify(this.repos)); }
    }
    return this.repos[id] ?? null;
  }

  async login(on) {
    const id = on ?? "";
    if (!this.logins[id]) {
      const r = await exec("gh", ["api", "user", "-q", ".login"], { on });
      if (r.code === 0) { this.logins[id] = r.stdout.trim(); localStorage.setItem("logins", JSON.stringify(this.logins)); }
    }
    return this.logins[id];
  }

  async store(repo) {
    if (!this.stores[repo]) {
      const saved = await fs.readFile(file(repo), "utf8").then(JSON.parse).catch(() => null);
      this.stores[repo] ??= saved ?? { issues: [], known: {}, synced: 0, full: 0 };
    }
    return this.stores[repo];
  }

  // Everything open plus the latest closed the first time (and every few hours);
  // after that only what changed since the last sync, in either state.
  async pull(repo, store, on) {
    const started = Date.now(), full = store.version !== VERSION || started - store.full > RESYNC;
    const list = async (args) => {
      const r = await exec("gh", ["issue", "list", "-R", repo, ...args, "--json", FIELDS], { on });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      return JSON.parse(r.stdout);
    };
    let got;
    if (full) {
      got = [...await list(["--state", "open", "--limit", String(FULL)]), ...await list(["--state", "closed", "--limit", String(CLOSED)])];
      store.issues = []; store.full = started; store.version = VERSION;
    } else {
      const since = new Date(store.synced - 120000).toISOString().slice(0, 19) + "Z";
      got = await list(["--state", "all", "--limit", "200", "--search", `updated:>=${since}`]);
    }
    upsert(store, got);
    store.synced = started;
    await save(repo, store);
    return full || got.length > 0;
  }

  // Each space shows the repo its own terminals were last in: a folder outside
  // any GitHub repo (home, say) keeps it, and a space never in one shows none.
  pick(found, space, on) {
    if (found) { this.spaceRepos[space] = { repo: found, on }; localStorage.setItem("spaces", JSON.stringify(this.spaceRepos)); }
    const choice = this.spaceRepos[space] ?? this.guess(space);
    if ((choice?.repo ?? null) !== this.repo) { this.repo = choice?.repo ?? null; this.mentioned = []; }
    this.repoOn = choice?.on ?? null;
  }

  // A space not seen yet: any of its terminals in a folder whose repo is known.
  guess(space) {
    const s = spaces().find((x) => x.id === space), tabs = new Set(s?.tabs.map((tab) => tab.id) ?? []), on = s?.machine ?? null;
    for (const p of panes()) {
      const repo = tabs.has(p.tab) && p.cwd ? this.repos[JSON.stringify([p.cwd, on])] : null;
      if (repo) return { repo, on };
    }
    return null;
  }

  refresh(cx) {
    const { cwd, on } = this.where(), context = this.context(), space = focused()?.space;
    if (context !== this.ctx) {
      // A folder seen before shows its repo's cached issues at once.
      this.ctx = context; this.error = null;
      this.pick(cwd ? this.repos[JSON.stringify([cwd, on])] : null, space, on);
    }
    if (this.syncing) { this.again = true; return; }
    this.syncing = true;
    cx.spawn(async (cx) => {
      try {
        const found = cwd ? await this.repoFor(cwd, on) : null;
        if (this.context() !== context) return;
        this.pick(found, space, on);
        const repo = this.repo;
        if (!repo) return;
        const store = await this.store(repo);
        cx.notify();
        this.me = await this.login(this.repoOn);
        if (await this.pull(repo, store, this.repoOn)) cx.notify();
        if (this.context() === context) this.error = null;
      } catch (e) { if (this.context() === context) this.error = String(e?.message ?? e); }
      finally {
        this.syncing = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  // The dialog changed an issue: fetch just that one, so the list shows it now.
  changed({ repo, number, on }, cx) {
    const store = this.stores[repo];
    if (!store) return;
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["issue", "view", String(number), "-R", repo, "--json", FIELDS], { on }).catch(() => null);
      if (r?.code !== 0) return;
      upsert(store, [JSON.parse(r.stdout)]);
      await save(repo, store).catch(() => null);
      cx.notify();
    });
  }

  // The focused terminal's screen and recent history, for the issues it mentions.
  // A focused mod pane has no terminal: the last one stays.
  scan(cx) {
    const terminal = (this.terminal = focused()?.terminal ?? this.terminal), repo = this.repo, store = this.stores[repo];
    if (this.scanning || !terminal || !store) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", terminal, "--lines", "300"]);
        if (r.code !== 0 || repo !== this.repo) return;
        const numbers = mentions(r.stdout, repo).filter((n) => store.known[n] !== null);
        for (const n of numbers.slice(0, MENTIONS)) {
          if (n in store.known) continue;
          const v = await exec("gh", ["issue", "view", String(n), "-R", repo, "--json", "number,title,state"], { on: this.repoOn ?? null });
          store.known[n] = v.code === 0 ? JSON.parse(v.stdout) : null;
        }
        if (repo !== this.repo) return;
        const mentioned = numbers.map((n) => store.known[n]).filter(Boolean).slice(0, MENTIONS);
        if (JSON.stringify(mentioned) !== JSON.stringify(this.mentioned)) { this.mentioned = mentioned; cx.notify(); }
      } catch { /* the terminal closed, or gh is missing: try again next time */ }
      finally { this.scanning = false; }
    });
  }

  issues() { return this.stores[this.repo]?.issues ?? []; }

  // The dialog gets the issue in full when the list has it, so it shows at once.
  open(number) {
    const data = this.issues().find((i) => i.number === number) ?? null;
    openOverlay({ mod: "issues", kind: "dialog", width: 0.86, height: 0.9, props: { issue: { repo: this.repo, number, on: this.repoOn ?? null, data, me: this.me } } });
  }

  shown() {
    const q = this.query.trim().toLowerCase();
    return this.issues().filter((i) => i.state === this.state
      && (!this.mine || i.assignees.some((a) => a.login === this.me))
      && (!q || `#${i.number} ${i.title}`.toLowerCase().includes(q))).sort(SORTS[sort()].by);
  }

  row(i, t, where = "issue") {
    const closed = i.state && i.state !== "OPEN";
    return h_flex().id(`${where}-${i.number}`).flex_none().px(10).py(6).gap(8).items_start().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => this.open(i.number))
      .on_mouse_down("right", () => copyMenu({ repo: this.repo, number: i.number, title: i.title, url: i.url }, "pointer"))
      .child(div().flex_none().w(40).text_color(closed ? t.ansi5 : t.dim).child(`#${i.number}`))
      .child(div().flex_1().min_w(0).text_color(closed && where !== "issue" ? t.muted : t.foreground).child(i.title));
  }

  heading(label, t) {
    return div().flex_none().px(10).pt(8).pb(4).text_size(11).font_semibold().text_color(t.dim).child(label);
  }

  segment(id, label, on, t, onClick) {
    return div().id(id).h(24).px(9).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
      .hover((s) => s.bg(on ? t.selected : t.hover)).on_click(onClick).child(label);
  }

  sortMenu(t) {
    const current = sort();
    return v_flex().id("issues-sort").size_full().p(6).gap(1).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(div().px(8).pt(4).pb(6).text_size(11).font_semibold().text_color(t.dim).child("Sort by"))
      .children(Object.entries(SORTS).map(([key, s]) => h_flex().id(`sort-${key}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((e) => e.bg(t.hover)).on_click(() => { setShared("issues.sort", key); closeOverlay(this.menu); })
        .child(div().w(14).text_color(t.accent).child(key === current ? "✓" : "")).child(s.label)));
  }

  copyMenu(t) {
    const { url, ref, number, title, overlay } = this.copying;
    const items = [["Copy link", url], ["Copy reference", ref], ["Copy number", number], ["Copy number and title", title]].filter(([, text]) => text);
    return v_flex().id("issues-copy").size_full().p(6).gap(1).bg(t.popover).text_color(t.foreground).text_size(12)
      .children(items.map(([label, text], n) => v_flex().id(`copy-${n}`).px(8).py(6).rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
        .on_click((_e, cx) => { cx.write_to_clipboard(text); notify({ title: "Copied", body: text, level: "success", timeout: 2500 }); closeOverlay(overlay); })
        .child(div().font_semibold().child(label))
        .child(div().text_size(11).text_color(t.muted).truncate().child(text))));
  }

  render(cx) {
    if (this.viewer) return this.viewer.render(cx);
    const t = theme();
    if (this.menu) return this.sortMenu(t);
    if (this.copying) return this.copyMenu(t);
    if (this.button) return this.toolbar(t);
    const away = hidden();
    if (this.away && !away) { this.refresh(cx); this.scan(cx); }
    this.away = away;
    if (!away && this.context() !== this.ctx) this.refresh(cx);
    const changed = shared("issues.changed");
    if (changed?.at && changed.at !== this.changedAt) { this.changedAt = changed.at; this.changed(changed, cx); }

    const all = this.issues(), list = this.shown(), cached = Boolean(this.stores[this.repo]?.synced);
    const open = all.filter((i) => i.state === "OPEN").length, closed = all.length - open;
    const empty = this.error || (!cached ? "Loading issues…"
      : this.query.trim() ? "No issues match"
      : this.mine ? `No ${this.state === "OPEN" ? "open" : "closed"} issues assigned to you`
      : `No ${this.state === "OPEN" ? "open" : "closed"} issues`);
    const panel = v_flex().id("issues").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    // Nothing to show until a terminal in a GitHub repo has had focus once.
    if (!this.repo) return panel.child(v_flex().flex_1().items_center().justify_center().gap(10).px(36)
      .child(div().size(28).when(this.icons, (e) => e.child(svg(icon("issue")).size(28).text_color(t.dim))))
      .child(div().font_semibold().text_color(t.muted).child(this.syncing ? "Looking for a repository…" : "No repository yet"))
      .child(div().text_size(12).text_color(t.dim).text_center().child("Focus a terminal inside a GitHub repository and its issues show up here.")));
    return panel
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().size(14).flex_none().when(this.icons, (e) => e.child(svg(icon("issue")).size(14).text_color(t.ansi2))))
        .child(div().font_semibold().child("Issues"))
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).text_right().truncate().child(this.repo ?? ""))
        .child(h_flex().id("issues-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(7).border_1().border_color(t.border).text_size(12).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.refresh(cx); cx.notify(); })
          .child(this.syncing
            ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
            : div().size(12).when(this.icons, (e) => e.child(svg(icon("refresh")).size(12))))
          .child(this.syncing ? "Syncing" : "Refresh")))
      .child(v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(div().id("issues-filter").flex_1().min_w(0).h(28).px(9).flex().items_center().rounded(7).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .child(h_flex().id("issues-sort-button").h(28).px(9).gap(4).flex_none().items_center().rounded(7).border_1().border_color(t.border).text_size(12).text_color(t.muted)
            .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => openOverlay({ mod: "issues", kind: "popup", width: 210, height: 196, props: { sortMenu: true } }))
            .child(SORTS[sort()].label.replace(/ updated$/, "")).child(div().text_size(9).child("▼"))))
        .child(h_flex().gap(6).items_center()
          .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
            .child(this.segment("state-open", cached ? `Open ${open >= FULL ? `${FULL}+` : open}` : "Open", this.state === "OPEN", t, (_e, cx) => { this.state = "OPEN"; cx.notify(); }))
            .child(this.segment("state-closed", cached ? `Closed ${closed}` : "Closed", this.state === "CLOSED", t, (_e, cx) => { this.state = "CLOSED"; cx.notify(); })))
          .child(div().flex_1())
          .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
            .child(this.segment("filter-all", "All", !this.mine, t, (_e, cx) => { this.mine = false; cx.notify(); }))
            .child(this.segment("filter-mine", "Mine", this.mine, t, (_e, cx) => { this.mine = true; cx.notify(); })))))
      .child(v_flex().id("issues-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .when(Boolean(this.error) && list.length > 0, (e) => e.child(div().px(10).py(4).text_size(11).text_color(t.ansi1).child(this.error)))
        .when(this.mentioned.length > 0, (e) => e.child(this.heading("In this terminal", t))
          .children(this.mentioned.map((i) => this.row(i, t, "mentioned")))
          .child(this.heading(`${this.state === "OPEN" ? "Open" : "Closed"} issues${this.mine ? " assigned to you" : ""}`, t)))
        .children(list.map((i) => this.row(i, t)))
        .when(!list.length, (e) => e.child(div().px(16).py(28).text_size(12).text_center().text_color(this.error ? t.ansi1 : t.dim).child(empty))));
  }
}
