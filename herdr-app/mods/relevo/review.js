import { div, list } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Scrollbar } from "gpui-base";
import { theme, exec, run, agents, panes, focused, props, settings, notify, shared, setShared } from "herdr";
import { focusedCwd } from "./panelbar.js";
import { button } from "./ui.js";
import { launchInRepo, loadClaudeQuotas, pickAccount } from "./accounts.js";
import { GIT_READ as READ } from "./lib/git.js";
import { diffRows, lineKey, selectRange, lineComment, fileComment, commentId, rangeRows, reviewMessage } from "./lib/diff.js";

const MAX_ROWS = 4000;
// Open review panes by checkout, so a second Review focuses the first.
const OPEN = "relevo.reviews";
// Unsent comments by checkout, so closing the pane or Herdr doesn't lose them.
const NOTES = "relevo.review.notes";

// An agent whose pane sits in this checkout; the one that made the changes is usually the only one.
function agentIn(root) {
  const byPane = new Map(panes().map((p) => [p.pane, p.cwd]));
  return agents().find((a) => {
    const cwd = byPane.get(a.pane) ?? "";
    return cwd === root || cwd.startsWith(`${root}/`);
  }) ?? null;
}

// Without `pr` it reviews the uncommitted changes; with `pr` ({repo, number, url, base, head, ref}) the whole PR
// against its base: the checkout's working tree, or the branch `ref` itself when it isn't checked out anywhere.
export async function openReview(root = focusedCwd(), terminal = null, pr = null) {
  if (!root) return;
  const top = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root })).stdout.trim();
  if (!top) return notify({ title: "Not a git repository", level: "info" });
  const pane = shared(OPEN)?.[reviewKey(top, pr)];
  if (pane && panes().some((p) => p.pane === pane)) return run("pane.focus", { pane });
  run("pane.split", { direction: "right", mod: "relevo", props: { role: "review-diff", root: top, terminal, pr } });
}

const reviewKey = (root, pr) => (pr ? `${root}#${pr.number}` : root);

// Entries whose pane is gone drop out on the next write.
const live = () => Object.fromEntries(
  Object.entries(shared(OPEN) ?? {}).filter(([, pane]) => panes().some((p) => p.pane === pane)),
);

export class ReviewDiff {
  init(_props, cx) {
    const p = props() ?? {};
    this.root = p.root ?? null;
    this.terminal = p.terminal ?? null;
    this.pr = p.pr ?? null;
    // Open panes and unsent comments are kept per checkout, and per PR when reviewing one.
    this.key = reviewKey(this.root, this.pr);
    this.files = [];
    this.rows = [];
    this.comments = shared(NOTES)?.[this.key] ?? [];
    // null, { start, end } row indices, or "file".
    this.editing = null;
    this.anchor = null;
    this.input = InputState.new({ value: "", placeholder: "Comment for the agent · Enter saves, Esc cancels" });
    this.input.on("submit", (_e, cx) => this.save(cx));
    if (this.root) this.load(cx);
    // The agent keeps working while you read; pick up its changes unless you are typing.
    cx.timer.every(10000, (cx) => {
      if (this.editing === null && !this.loading) this.load(cx);
    });
    // The split focuses the new pane, which is how this view learns its own id.
    cx.timer.after(300, () => {
      const pane = focused()?.pane;
      if (!this.root || !pane || panes().find((x) => x.pane === pane)?.mod !== "relevo") return;
      this.pane = pane;
      setShared(OPEN, { ...live(), [this.key]: pane });
    });
  }

  close() {
    this.input.release();
    if (this.pane && shared(OPEN)?.[this.key] === this.pane) {
      const { [this.key]: _, ...rest } = live();
      setShared(OPEN, rest);
    }
  }

  load(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        await this.read(cx);
      } finally {
        this.loading = false;
      }
    });
  }

  // The ref the diff starts from: HEAD for uncommitted work, the merge base with the PR's base branch for a PR.
  async since(git) {
    if (!this.pr) return "HEAD";
    if (!this.mergeBase) {
      const remote = await git(["rev-parse", "--verify", "--quiet", `origin/${this.pr.base}`]);
      const base = remote.code === 0 ? `origin/${this.pr.base}` : this.pr.base;
      this.mergeBase = (await git(["merge-base", base, this.pr.ref ?? "HEAD"])).stdout.trim() || "HEAD";
    }
    return this.mergeBase;
  }

  async read(cx) {
    const git = (args) => exec("git", [...READ, ...args], { cwd: this.root });
    this.from = await this.since(git);
    const range = this.pr?.ref ? [this.from, this.pr.ref] : [this.from];
    const tracked = (await git(["diff", ...range, "--numstat", "--no-renames"])).stdout.split("\n").filter(Boolean)
      .map((l) => {
        const [add, del, path] = l.split("\t");
        return { path, add: +add || 0, del: +del || 0 };
      });
    // A branch that isn't checked out has no untracked files.
    const others = this.pr?.ref ? "" : (await git(["ls-files", "--others", "--exclude-standard"])).stdout;
    const untracked = others.split("\n").filter(Boolean).map((path) => ({ path, add: 0, del: 0, untracked: true }));
    const files = [...tracked, ...untracked], sign = JSON.stringify(files);
    if (sign !== this.filesSign) {
      this.filesSign = sign;
      this.files = files;
      cx.notify();
    }
    const open = files.find((f) => f.path === this.open?.path) ?? files[0];
    if (open) await this.pick(open, cx);
    else this.rows = [];
  }

  async pick(file, cx) {
    if (this.open?.path !== file.path) {
      this.editing = null;
      this.anchor = null;
      this.diffSign = null;
    }
    this.open = file;
    const args = file.untracked
      ? ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", file.path]
      : ["diff", this.from ?? "HEAD", ...(this.pr?.ref ? [this.pr.ref] : []), "--no-color", "--no-ext-diff", "--", file.path];
    const out = (await exec("git", [...READ, ...args], { cwd: this.root })).stdout;
    if (out === this.diffSign) return;
    this.diffSign = out;
    this.anchor = null;
    this.rows = diffRows(out.split("\n")).slice(0, MAX_ROWS);
    cx.notify();
  }

  // A shift-click extends from the last plain click; the press records shift because on_item_click has no event.
  clickRow(i, cx) {
    if (this.rows[i]?.number === undefined) return;
    const range = this.shift && this.anchor !== null ? selectRange(this.rows, this.anchor, i) : null;
    if (!range) this.anchor = i;
    this.edit(range ?? { start: i, end: i }, cx);
  }

  edit(target, cx) {
    const e = this.editing, lines = e && e !== "file";
    if (e === target || (lines && target !== "file" && e.start === target.start && e.end === target.end)) return;
    const id = target === "file" ? "file" : commentId(lineComment("", this.rows, target.start, target.end, ""));
    const saved = this.comments.find((c) => c.file === this.open.path && commentId(c) === id)?.text;
    // Widening a fresh line comment into a range keeps what was typed.
    const widening = lines && target !== "file" && target.start !== target.end;
    this.input.set_value(saved ?? (widening ? this.input.value() : ""));
    this.editing = target;
    this.input.focus();
    cx.notify();
  }

  save(cx) {
    const text = this.input.value().trim(), e = this.editing;
    const ok = e === "file" ? Boolean(this.open) : this.rows[e?.start] && this.rows[e?.end];
    if (!ok) {
      this.editing = null;
      return cx.notify();
    }
    const c = e === "file" ? fileComment(this.open.path, text) : lineComment(this.open.path, this.rows, e.start, e.end, text);
    const kept = this.comments.filter((x) => !(x.file === c.file && commentId(x) === commentId(c)));
    this.setComments([...kept, ...(text ? [c] : [])]);
    this.editing = null;
    cx.notify();
  }

  setComments(list) {
    this.comments = list;
    this.clearing = false;
    const all = { ...(shared(NOTES) ?? {}) };
    if (list.length) all[this.key] = list;
    else delete all[this.key];
    setShared(NOTES, all);
  }

  subject() {
    if (!this.pr) return undefined;
    const where = this.pr.ref ? `; it is not checked out here, so work on it in a worktree (gh pr checkout ${this.pr.number})` : "";
    return `PR #${this.pr.number} (${this.pr.url}), the branch against ${this.pr.base}${where}`;
  }

  target() {
    return this.terminal ? agents().find((a) => a.address === this.terminal) ?? null : agentIn(this.root);
  }

  send(cx) {
    const agent = this.target();
    if (!this.comments.length) return;
    // A PR with no agent on it gets a new one in its checkout, with the first Claude account that has room.
    if (!agent && this.pr) {
      const message = reviewMessage(this.comments, this.subject()), pr = this.pr, root = this.root;
      this.setComments([]);
      this.note = "Sent to a new agent";
      cx.notify();
      return cx.spawn(async () => {
        launchInRepo({
          repo: pr.repo, folder: root, tab: `${pr.repo.split("/")[1]}#${pr.number} · review`,
          account: pickAccount(await loadClaudeQuotas(), true).key, prompt: message,
        });
      });
    }
    if (!agent) return;
    const message = reviewMessage(this.comments, this.subject());
    cx.spawn(async (cx) => {
      const r = await exec("hc", ["send", agent.address, message]);
      if (r.code !== 0) this.note = r.stderr.trim().split("\n")[0] || "hc send failed";
      else {
        this.setComments([]);
        this.note = `Sent to ${agent.tab_name || agent.address}`;
        run("agent.focus", { terminal: agent.address });
      }
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape" && this.editing !== null) {
      this.editing = null;
      this.anchor = null;
      cx.stop_propagation();
      cx.notify();
    }
  }

  // Runs inside the virtual list: no handlers here, clicks go through on_item_click.
  row(t, r, i, notes, tint, font) {
    const e = this.editing, editing = e && e !== "file" && e.end === i;
    const marked = e && e !== "file" && i >= e.start && i <= e.end;
    const line = r.kind === "@"
      ? div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(r.text)
      : h_flex().w_full().h(20).flex_none().gap(10).cursor_pointer().hover((s) => s.bg(t.hover))
        .when(r.kind === "+", (el) => el.bg(t.ansi2 + "18"))
        .when(r.kind === "-", (el) => el.bg(t.ansi1 + "18"))
        .when(tint && !marked, (el) => el.bg(t.accent + "1f"))
        .when(marked, (el) => el.bg(t.selected))
        .child(div().w(30).flex_none().text_right().text_color(notes.length ? t.accent : t.dim)
          .child(notes.length ? "●" : String(r.number)))
        .child(div().flex_1().min_w(0).truncate().child(r.text));
    if (!editing && !notes.length) return line;
    return v_flex().w_full().flex_none()
      .child(line)
      .children(notes.map((note) => this.noteBox(t, note, font)))
      .when(editing, (el) => el.child(this.field(t, font)));
  }

  noteBox(t, note, font) {
    return div().mx(10).my(3).px(8).py(4).rounded(6).bg(t.raised)
      .font_family(font).text_size(11.5).text_color(t.foreground)
      .child(note.text);
  }

  field(t, font) {
    return div().mx(10).my(4).h(30).px(8).flex().items_center()
      .rounded(6).border_1().border_color(t.accent).bg(t.background)
      .font_family(font).text_size(12)
      .child(Input.new(this.input).h_full());
  }

  header(t) {
    return h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Review"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
        .child(this.pr
          ? `${this.pr.repo.split("/")[1]} #${this.pr.number} · against ${this.pr.base}`
          : this.root?.split("/").pop() ?? "No folder"))
      .child(div().text_size(11).text_color(t.muted).child("Click a line · shift-click a range"));
  }

  // Outside the virtual list, so ordinary handlers work here.
  fileBar(t, font) {
    const note = this.comments.find((c) => c.file === this.open?.path && commentId(c) === "file");
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(30).px(12).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(this.open.path))
        .child(button(t, "rv-file-comment", "Comment on file", (cx) => this.edit("file", cx), { size: "sm" })))
      .when(this.editing === "file", (el) => el.child(this.field(t, font)))
      .when(Boolean(note) && this.editing !== "file", (el) => el.child(this.noteBox(t, note, font)
        .id("rv-file-note").cursor_pointer()
        .on_click((_e, cx) => this.edit("file", cx))));
  }

  fileList(t) {
    return v_flex().id("rv-files").flex_none().max_h(150).overflow_y_scrollbar().p(4).border_b(1).border_color(t.border)
      .when(!this.files.length, (el) => el.child(div().p(8).text_color(t.dim).child("No uncommitted changes")))
      .children(this.files.map((f) => {
        const count = this.comments.filter((c) => c.file === f.path).length;
        return h_flex().id(`rv-file-${f.path}`).h(24).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(this.open?.path === f.path, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => {
            await this.pick(f, cx);
          }))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(f.path))
          .when(count > 0, (el) => el.child(div().text_size(10.5).text_color(t.accent).child(`● ${count}`)))
          .when(f.untracked, (el) => el.child(div().text_size(10.5).text_color(t.ansi2).child("new")))
          .when(!f.untracked, (el) => el
            .child(div().text_size(10.5).text_color(t.ansi2).child(`+${f.add}`))
            .child(div().text_size(10.5).text_color(t.ansi1).child(`−${f.del}`)));
      }));
  }

  diff(t, font) {
    const mine = this.comments.filter((c) => c.file === this.open?.path && c.scope !== "file");
    const notes = new Map();
    for (const c of mine) notes.set(c.key, [...(notes.get(c.key) ?? []), c]);
    const tinted = rangeRows(this.rows, mine);
    const row = (i) => {
      const r = this.rows[i];
      return this.row(t, r, i, r.number === undefined ? [] : notes.get(lineKey(r)) ?? [], tinted.has(i), font);
    };
    return div().id("rv-diff-area").flex_1().min_h(0).relative()
      .font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
      .on_mouse_down("left", (e) => {
        this.shift = e.modifiers.shift;
      })
      .child(list("rv-diff", this.rows.length, (i) => String(i), row)
        .size_full()
        .on_item_click((key, cx) => this.clickRow(+key, cx)))
      .child(Scrollbar.vertical("rv-diff").absolute().inset_0());
  }

  footer(t, agent, n, ready) {
    return h_flex().h(44).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted)
        .child(this.note ?? (agent
          ? `${n} ${n === 1 ? "comment" : "comments"} for ${agent.tab_name || agent.address}`
          : this.pr ? "A new agent will take them" : "No agent in this folder")))
      .when(n > 0, (el) => el.child(button(t, "rv-clear", this.clearing ? "Confirm" : "Clear", (cx) => {
        if (this.clearing) this.setComments([]);
        else this.clearing = true;
        cx.notify();
      }, { size: "lg", kind: this.clearing ? "danger" : "outline" })))
      .child(button(t, "rv-send", "Send to agent", (cx) => this.send(cx), { kind: "solid", size: "lg", disabled: !ready }));
  }

  render() {
    const t = theme(), agent = this.target(), n = this.comments.length, ready = Boolean((agent || this.pr) && n);
    const font = settings().ui_font_family ?? "Inter";
    return v_flex().id("relevo-review").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t))
      .child(this.fileList(t))
      .when(Boolean(this.open), (el) => el.child(this.fileBar(t, font)))
      .child(this.diff(t, font))
      .child(this.footer(t, agent, n, ready));
  }
}
