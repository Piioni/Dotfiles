import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, exec, run, spaces, panes, focused, props, openOverlay, closeOverlay } from "herdr";
import { touchedAt } from "./worktrees.js";
import { ago } from "./lib/time.js";
import { GIT_READ } from "./lib/git.js";
import { spinner, withKey } from "./ui.js";

const MAX_FILES = 20000, SHOWN = 60;

// A mod pane has no folder; a terminal beside it in the same tab speaks for it.
export function focusedCwd() {
  const f = focused(), all = panes(), pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  return pane?.cwd
    ?? f?.cwd
    ?? (pane && all.find((p) => p.tab === pane.tab && p.cwd)?.cwd)
    ?? spaces().find((s) => s.active)?.folder
    ?? null;
}

async function checkouts(cwd) {
  const top = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
  if (!top) return { top: null, list: [] };
  const out = (await exec("git", ["worktree", "list", "--porcelain"], { cwd })).stdout, list = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) list.push({ path: line.slice(9) });
    else if (line.startsWith("branch refs/heads/")) list.at(-1).branch = line.slice(18);
    else if (line === "prunable" || line.startsWith("prunable ")) list.at(-1).missing = true;
  }
  return { top, list: list.filter((c) => !c.missing) };
}

export function openFinder() {
  const root = focusedCwd();
  if (root) {
    openOverlay({
      mod: "relevo", kind: "popup", at: "top", offset: 40, width: 640, height: 0.7, props: { role: "find-file", root },
    });
  }
}

// The worktrees of the focused repo; picking one goes to its space, so Files and Changes follow.
export class PanelBar {
  init(_props, cx) {
    this.cwd = null;
    this.top = null;
    this.list = [];
    cx.timer.every(2000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    // A mod pane (a file or a review) has no folder; keep showing the last repo.
    const cwd = focusedCwd() ?? this.cwd;
    if (cwd === this.cwd || this.loading) return;
    this.cwd = cwd;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        Object.assign(this, cwd ? await checkouts(cwd) : { top: null, list: [] });
      } finally {
        this.loading = false;
      }
      cx.notify();
    });
  }

  // One control for every checkout of the repo: the current one's name, and ▾ for the rest with their state.
  selector(t) {
    const here = this.list.find((c) => c.path === this.top);
    const name = here ? here.branch ?? here.path.split("/").pop() : this.loading ? "…" : "No repository";
    return h_flex().id("checkout-selector").h(26).px(8).gap(5).flex_none().max_w(150).items_center().rounded(6)
      .border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(this.list.length > 1 ? `${this.list.length} checkouts of ${this.top?.split("/").pop()}` : this.top ?? "")
      .on_click(() => this.list.length && openCheckouts(this.top, this.list))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(name))
      .when(this.list.length > 1, (el) => el.child(div().text_size(10).text_color(t.dim).child("▾")));
  }

  render() {
    const t = theme();
    return h_flex().id("relevo-panel-bar").size_full().px(4).gap(6).items_center().bg(t.chrome).text_color(t.foreground)
      .child(this.selector(t))
      .child(h_flex().id("find-file").flex_1().min_w(0).h(26).px(8).gap(6).items_center().rounded(6)
        .border_1().border_color(t.border).bg(t.background)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => openFinder())
        .child(div().text_color(t.dim).child("⌕"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted)
          .child(`Open file in ${this.top?.split("/").pop() ?? "…"}`))
        .child(div().text_size(10.5).text_color(t.dim).child("⌘O")));
  }
}

// Subsequence match; earlier, tighter matches and matches in the file name rank first.
function score(path, q) {
  const p = path.toLowerCase(), base = p.lastIndexOf("/") + 1;
  let at = -1, cost = 0;
  for (const ch of q) {
    const i = p.indexOf(ch, at + 1);
    if (i < 0) return null;
    cost += i - at - 1;
    at = i;
  }
  return cost + (p.indexOf(q[0], base) >= base ? 0 : 50) + path.length / 100;
}

export class FileFinder {
  init(_props, cx) {
    this.files = null;
    this.at = 0;
    this.query = "";
    this.input = InputState.new({ value: "", placeholder: "file name or path" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value().trim().toLowerCase();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", () => this.open(this.shown()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    cx.spawn(async (cx) => {
      const root = props()?.root;
      if (!root) {
        this.files = [];
        return cx.notify();
      }
      const r = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root });
      this.files = r.code === 0 ? r.stdout.split("\n").filter(Boolean).slice(0, MAX_FILES) : [];
      cx.notify();
    });
  }

  // Scored once per query: render, the arrow keys and Enter all ask for it.
  shown() {
    if (!this.files) return [];
    if (this.memo?.query === this.query && this.memo.files === this.files) return this.memo.rows;
    const rows = !this.query
      ? this.files.slice(0, SHOWN)
      : this.files.map((f) => [f, score(f, this.query)])
        .filter(([, s]) => s !== null)
        .sort((a, b) => a[1] - b[1])
        .slice(0, SHOWN)
        .map(([f]) => f);
    this.memo = { query: this.query, files: this.files, rows };
    return rows;
  }

  close() {
    this.input.release();
  }

  open(file) {
    if (!file) return;
    const p = props();
    closeOverlay(p.overlay);
    run("pane.split", { direction: "right", mod: "ion-files", props: { role: "view", root: p.root, file } });
  }

  key(e, cx) {
    const n = this.shown().length;
    if (e.key === "escape") return closeOverlay(props().overlay);
    if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme(), rows = this.shown();
    return v_flex().id("find-file-popup").size_full().p(12).gap(8)
      .bg(t.popover ?? t.surface).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background))
      .child(v_flex().id("find-file-list").flex_1().min_h(0).overflow_y_scrollbar()
        .when(this.files === null, (el) => el.child(div().p(8).text_color(t.dim).child("…")))
        .when(this.files !== null && !rows.length, (el) => el.child(div().p(8).text_color(t.dim).child("No matching files")))
        .children(rows.map((f, i) => {
          const cut = f.lastIndexOf("/") + 1;
          return h_flex().id(`ff-${f}`).h(28).px(8).gap(8).flex_none().items_center().rounded(6).cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.selected))
            .when(i !== this.at, (el) => el.hover((s) => s.bg(t.hover)))
            .on_click(() => this.open(f))
            .child(div().flex_none().child(f.slice(cut)))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.slice(0, cut)));
        })));
  }
}

const goTo = (path) => {
  const s = spaces().find((x) => !x.machine && x.folder === path);
  if (s) run("space.select", { id: s.id });
  else run("space.new", { folder: path });
};

// The selector for the focused folder, for a key or herdr-app do.
export async function openCheckoutsHere() {
  const cwd = focusedCwd();
  if (!cwd) return;
  const { top, list } = await checkouts(cwd);
  if (top) openCheckouts(top, list);
}

export function openCheckouts(top, list) {
  openOverlay({
    mod: "relevo", kind: "popup", width: 380, height: Math.min(440, 74 + list.length * 34),
    props: { role: "checkout-menu", top, list },
  });
}

// Every checkout with what decides which to open: uncommitted files, ahead/behind its upstream, last use.
export class CheckoutMenu {
  init(_props, cx) {
    const p = props() ?? {};
    this.rows = (p.list ?? []).map((c) => ({ ...c }));
    this.loaded = false;
    cx.spawn(async (cx) => {
      const at = await touchedAt(this.rows.map((c) => c.path));
      await Promise.all(this.rows.map(async (c) => {
        c.at = at.get(c.path) ?? 0;
        const status = await exec("git", [...GIT_READ, "status", "--porcelain"], { cwd: c.path });
        c.dirty = status.stdout.split("\n").filter(Boolean).length;
        const track = await exec("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], { cwd: c.path });
        if (track.code === 0) [c.behind, c.ahead] = track.stdout.trim().split(/\s+/).map(Number);
      }));
      this.rows.sort((a, b) => b.at - a.at);
      this.loaded = true;
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props() ?? {};
    const row = (c) => {
      const on = c.path === p.top;
      return h_flex().id(`co-${c.path}`).h(32).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .tooltip(c.path)
        .on_click(() => {
          closeOverlay(p.overlay);
          if (!on) goTo(c.path);
        })
        .child(div().size(6).flex_none().rounded_full().bg(on ? t.accent : t.border))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12).text_color(t.foreground).child(c.branch ?? c.path.split("/").pop()))
          .when(Boolean(c.branch) && c.path.split("/").pop() !== c.branch, (el) => el.child(
            div().truncate().text_size(10.5).text_color(t.dim).child(c.path.split("/").pop()))))
        .when(c.dirty > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.ansi3).child(`● ${c.dirty}`)))
        .when(c.ahead > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`↑${c.ahead}`)))
        .when(c.behind > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`↓${c.behind}`)))
        .when(Boolean(c.at), (el) => el.child(div().flex_none().w(34).text_right().text_size(10.5).text_color(t.dim)
          .child(ago(c.at).replace(" ago", ""))));
    };
    return v_flex().id("checkout-menu").w_full().p(4).gap(1).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(h_flex().px(8).pt(4).pb(6).gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().child(`Checkouts of ${p.top?.split("/").pop() ?? ""}`))
        .when(!this.loaded, (el) => el.child(spinner(t.dim, 10))))
      // A popup is as tall as its content, so the list has a ceiling rather than a flexible height.
      .child(v_flex().id("co-list").max_h(340).overflow_y_scrollbar().gap(1).children(this.rows.map(row)))
      .child(h_flex().id("co-new").h(30).mt(2).px(8).gap(6).items_center().rounded(6).cursor_pointer()
        .border_t(1).border_color(t.border).hover((s) => s.bg(t.hover)).text_size(11.5).text_color(t.muted)
        .tooltip(withKey("A new worktree of this repo", "relevo.worktree-new"))
        .on_click(() => {
          closeOverlay(p.overlay);
          openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480,
            props: { folder: p.top, action: "new", space: spaces().find((s) => s.active)?.id } });
        })
        .child("＋ New worktree"));
  }
}
