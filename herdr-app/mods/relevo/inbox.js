import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, exec, run, notify, settings, agents, panes, shared, setShared } from "herdr";
import { loadClaudeQuotas } from "./accounts.js";
import { ago, nextSince } from "./lib/time.js";
import { today, duration } from "./ledger.js";
import { openReview } from "./review.js";
import { openHandoff } from "./handoff.js";
import { button, sectionHeader, spinner, withKey } from "./ui.js";
import { seconds, recent } from "./lib/github.js";
import { isAddressed } from "./lib/addressed.js";
import { GIT_READ } from "./lib/git.js";
import { STATS_FOR } from "./lib/refresh.js";
import { readPrompt, samePrompt, sameChoicesBut, submitKeys, freeOption, moveKeys, lastMessage } from "./lib/prompt.js";
import { COUNT, showPanel } from "./toolbar.js";
import { launched } from "./skills.js";
import { openWeek } from "./week.js";
import { PrViews } from "./inbox-prs.js";
import { TreeViews } from "./inbox-trees.js";
import { KeyNav, INBOX_FOCUS } from "./inbox-keys.js";
import { LiveViews } from "./inbox-live.js";
import { LocalAddressed } from "./inbox-addressed.js";

// How long a send waits for its dialog to go, in 250 ms reads.
const SETTLE_TRIES = 8;

// Local work, pull requests and merged worktrees in one list; the PR and worktree parts live in their own files.
function savedSince() {
  try {
    return JSON.parse(localStorage.getItem("since")) ?? {};
  } catch {
    return {};
  }
}

export class Inbox {
  init(_props, cx) {
    this.local = [];
    this.h = cx.focus_handle();
    this.sel = null;
    // An old request must not steal the keyboard when this copy starts.
    this.focusAt = shared(INBOX_FOCUS)?.at ?? null;
    this.mine = [];
    this.requested = [];
    this.prAgents = {};
    this.clones = {};
    this.expanded = {};
    this.quotas = {};
    this.prsAt = 0;
    this.addressed = {};
    this.worktrees = [];
    this.confirm = null;
    this.wtError = {};
    this.removing = new Set();
    this.gone = new Set();
    this.since = savedSince();
    this.tops = new Map();
    this.stats = new Map();
    // What each waiting agent asks, read once per wait: address -> { since, prompt }.
    this.prompts = new Map();
    // A note to send right after the answer: address -> text.
    this.notes = new Map();
    this.answering = new Map();
    this.reply = InputState.new({ value: "", placeholder: "Reply · Enter sends, Esc cancels" });
    this.reply.on("submit", (_e, cx) => this.sendReply(cx));
    this.today = [];
    const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter((p) => p !== "review");
    if (!panels.includes("inbox")) setShared("workspace.panels", [...panels, "inbox"]);
    this.labelling = {};
    this.terms = new Map();
    this.startLive(cx);
    this.scanLocal(cx);
    this.loadAddressed(cx);
    this.scanPRs(cx);
    this.loadQuotas(cx);
    this.scanTrees(cx);
    // These feed alerts, so they keep running behind other apps.
    cx.timer.every(180000, (cx) => this.scanPRs(cx));
    cx.timer.every(60000, (cx) => this.loadQuotas(cx));
  }

  todayGroup(t, list) {
    const total = list.reduce((n, d) => n + d.seconds, 0);
    return [
      h_flex().pt(6).px(2).gap(6).items_center().text_size(10.5).text_color(t.dim)
        .child(div().flex_1().child("AGENT TIME TODAY"))
        .when(total > 0, (el) => el.child(duration(total)))
        .child(button(t, "week-open", "Week", () => openWeek(), { size: "sm", tip: "Agent time per ticket and day" })),
      v_flex().children(list.map((d) => h_flex().id(`day-${d.key}`).h(24).px(8).gap(8).items_center().rounded(6)
        .child(div().flex_none().text_size(11.5).text_color(d.jira ? t.foreground : t.muted).child(d.key))
        .when(Boolean(d.jira), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(d.repo)))
        .when(!d.jira, (el) => el.child(div().flex_1()))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(duration(d.seconds))))),
    ];
  }

  loadQuotas(cx) {
    cx.spawn(async (cx) => {
      this.quotas = await loadClaudeQuotas();
      cx.notify();
    });
  }

  seen(pr) {
    const l = launched()[pr.url];
    return Boolean(l) && seconds(pr.updatedAt) <= l.at;
  }

  // Addressed PRs leave the lists (and the count) and fold under one line per group.
  shown() {
    const open = (p) => !isAddressed(p, this.addressed), done = (p) => isAddressed(p, this.addressed);
    const local = this.local;
    const off = (i) => i.kind === "diff" && Boolean(this.addressedLabel(i.agent.address));
    return {
      local: local.filter((i) => !off(i)), localDone: local.filter(off),
      mine: this.mine.filter(open), requested: this.requested.filter(open),
      mineDone: this.mine.filter(done), requestedDone: this.requested.filter(done),
      worktrees: this.worktrees,
      today: this.today,
    };
  }

  publish(v = this.shown()) {
    const open = (list) => list.filter((p) => recent(p) && !this.seen(p)).length;
    const n = v.local.length + open(v.mine) + open(v.requested);
    if (shared(COUNT) !== n) setShared(COUNT, n);
  }

  scanLocal(cx) {
    if (this.scanning) {
      this.again = true;
      return;
    }
    this.scanning = true;
    this.again = false;
    this.localAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const byPane = new Map(panes().map((p) => [p.pane, p]));
        const byTab = new Map(Object.entries(launched()).map(([url, l]) => [l.tab, url]));
        const seen = new Set(), items = [], prAgents = {}, all = agents();
        this.readLabels(all, cx);
        // Agents carry no timestamps, so a card's age is how long this status has been seen.
        const since = nextSince(this.since, all, Date.now() / 1000);
        if (JSON.stringify(since) !== JSON.stringify(this.since)) localStorage.setItem("since", JSON.stringify(since));
        this.since = since;
        // A saved age outlives an absence, so it can't vouch for the question read before it.
        const listed = new Set(all.map((a) => a.address));
        for (const address of this.prompts.keys()) if (!listed.has(address)) this.prompts.delete(address);
        // A repo's one card goes to an agent not marked addressed, if it has one.
        const marked = (a) => (this.addressedLabel(a.address) ? 1 : 0);
        for (const a of [...all].sort((x, y) => marked(x) - marked(y))) {
          const url = byTab.get(a.tab_name);
          if (url) {
            prAgents[url] = a;
            if (a.status !== "blocked") continue;
          }
          if (a.address.includes("/") || a.status === "working") continue;
          const pane = byPane.get(a.pane);
          if (!pane?.cwd) continue;
          if (!this.tops.has(pane.cwd)) {
            this.tops.set(pane.cwd, (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: pane.cwd })).stdout.trim());
          }
          const top = this.tops.get(pane.cwd);
          const repo = top.split("/").pop() || a.space_name;
          if (a.status === "blocked") {
            const at = since[`${a.address}:blocked`];
            if (this.prompts.get(a.address)?.since !== at) {
              const screen = (await exec("hc", ["read", a.address, "--lines", "0"])).stdout;
              const prompt = readPrompt(screen);
              this.prompts.set(a.address, { since: at, prompt, free: freeOption(prompt) });
            }
            items.push({ kind: "blocked", agent: a, top, repo, branch: pane.branch, prompt: this.prompts.get(a.address).prompt });
            continue;
          }
          if (!top || seen.has(top)) continue;
          seen.add(top);
          // The diff of a resting agent only changes when its status does; re-read it at most once a minute otherwise.
          let cached = this.stats.get(top);
          if (!cached || this.dirty.delete(top) || cached.status !== a.status || Date.now() - cached.at > STATS_FOR) {
            const stat = (await exec("git", [...GIT_READ, "diff", "HEAD", "--shortstat"], { cwd: top })).stdout;
            const untracked = (await exec("git", [...GIT_READ, "ls-files", "--others", "--exclude-standard"], { cwd: top }))
              .stdout.split("\n").filter(Boolean).length;
            // What the agent said last, so the card tells whether to review or to answer it.
            const said = lastMessage((await exec("hc", ["read", a.address, "--lines", "20"])).stdout);
            this.stats.set(top, cached = { status: a.status, at: Date.now(), stat, untracked, said });
          }
          const { stat, untracked, said } = cached;
          const files = Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0) + untracked;
          if (!files) continue;
          items.push({
            kind: "diff", agent: a, top, repo, branch: pane.branch, files, said,
            add: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0), del: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0),
          });
        }
        this.prAgents = prAgents;
        this.today = await today();
        for (const i of items) i.at = since[`${i.agent.address}:${i.agent.status}`];
        const local = items.sort((x, y) => (x.kind === "blocked" ? 0 : 1) - (y.kind === "blocked" ? 0 : 1) || y.at - x.at);
        // Redraw only when a card or today's time changed, not on every scan.
        const sign = JSON.stringify([
          local.map((i) => [i.agent.address, i.kind, i.files, i.add, i.del, i.said, Math.floor(i.at / 60), this.addressedLabel(i.agent.address)]),
          this.today,
        ]);
        this.local = local;
        await this.watchRepos(seen, cx);
        if (sign !== this.sign) {
          this.sign = sign;
          this.publish();
          cx.notify();
        }
      } finally {
        this.scanning = false;
      }
      // A change seen mid-scan may have been read too early.
      if (this.again) this.scanLocal(cx);
    });
  }

  card(t, id, hot, head, meta, actions) {
    if (this.hiddenIds?.has(id)) return null;
    const sel = this.selected(id);
    return v_flex().id(id).p(10).gap(6).rounded(9).bg(sel ? t.selected : t.background).border_1()
      .border_color(sel ? t.accent : hot ? t.blocked : t.border)
      .child(head)
      .child(meta)
      .child(h_flex().gap(5).children(actions));
  }

  head(t, dot, title, when, ci = null, threads = 0) {
    const ring = dot === "ring";
    return h_flex().gap(7).items_center().min_w(0)
      .child(div().size(7).flex_none().rounded_full()
        .when(ring, (el) => el.border_1().border_color(t.dim))
        .when(!ring, (el) => el.bg(dot)))
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).child(title))
      .when(threads > 0, (el) => el.child(this.threadBadge(t, threads, title)))
      .when(Boolean(ci), (el) => el.child(this.ciBadge(t, ci, title)))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(when));
  }

  close() {
    this.reply.release();
    this.wanted.clear();
  }

  // A waiting agent's question and its choices as a list: a click answers (or checks, in a multiple choice).
  waitingCard(t, item, goAgent) {
    const a = item.agent, p = item.prompt ?? { question: "", options: [] }, replying = this.replying === a.address;
    const free = this.prompts.get(a.address)?.free;
    const row = (o) => h_flex().id(`answer-${a.address}-${o.n}`).h(24).px(6).gap(7).items_center().rounded(5)
      .cursor_pointer()
      .when(p.cursor === o.n, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
      .tooltip(o.detail ? `${o.label} · ${o.detail}` : o.label)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.answer(a, o, cx, p);
      })
      .child(div().w(12).flex_none().text_size(10.5).text_color(t.dim).child(String(o.n)))
      .when("checked" in o, (el) => el.child(div().flex_none().text_size(12)
        .text_color(o.checked ? t.accent : t.dim).child(o.checked ? "☑" : "☐")))
      .child(div().flex_none().max_w(200).truncate().text_size(11.5).text_color(t.foreground)
        .child(o.n === free && /^type something/i.test(o.label) ? "Type something…" : o.label))
      .when(Boolean(o.detail), (el) => el.child(
        div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(o.detail)));
    const actions = [
      ...(p.submit ? [button(t, `submit-${a.address}`, "Submit", (cx) => this.submit(a, p, cx), { kind: "solid" })] : []),
      ...(p.options.length || p.unparsed
        ? []
        : [button(t, `reply-${a.address}`, "Reply", (cx) => this.startReply(a, null, cx), { kind: "solid" })]),
      ...(p.options.length
        ? [button(t, `note-${a.address}`, "Note", (cx) => this.startReply(a, null, cx, "note"), {
          tip: "Sent to the agent right after your answer",
        })]
        : []),
      button(t, `go-${a.address}`, p.options.length ? "Agent" : "Go to agent", goAgent),
      button(t, `handoff-${a.address}`, "Continue with…", () => openHandoff(a.address)),
    ];
    return this.card(t, `in-${a.address}`, true,
      this.head(t, t.blocked, `${item.repo} · ${a.tab_name || item.branch || ""}`, ago(item.at)),
      v_flex().gap(4)
        .child(v_flex().children((p.question || "Waiting for you").split("\n")
          .map((l) => div().truncate().text_size(12).text_color(t.foreground).child(l))))
        .when(Boolean(p.summary?.length), (el) => el.child(v_flex().gap(3).py(4).px(8).rounded(6).bg(t.raised)
          .children(p.summary.map((s) => v_flex()
            .child(div().truncate().text_size(11).text_color(t.muted).child(s.question))
            .child(div().truncate().text_size(11.5).text_color(t.foreground).child(`→ ${s.answer || "(no answer)"}`))))))
        .when(p.options.length > 0, (el) => el.child(v_flex().gap(1).children(p.options.map(row))))
        .when(Boolean(p.preview), (el) => el.child(div().px(8).py(5).rounded(6).border_1().border_color(t.border)
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(10.5).text_color(t.muted)
          .children(p.preview.split("\n").slice(0, 8).map((l) => div().truncate().child(l || " ")))))
        .when(this.notes.has(a.address), (el) => el.child(h_flex().gap(6).items_center().text_size(11).text_color(t.muted)
          .child(div().flex_1().min_w(0).truncate().child(`Note: ${this.notes.get(a.address)}`))
          .child(button(t, `note-clear-${a.address}`, "×", (cx) => {
            this.notes.delete(a.address);
            cx.notify();
          }, { size: "sm", tip: "Drop the note" }))))
        .when(replying, (el) => el.child(div().mt(2).h(28).px(8).flex().items_center().rounded(6).border_1()
          .border_color(t.accent).bg(t.background).child(Input.new(this.reply).h_full()))),
      replying ? [] : [h_flex().gap(5).children(actions)]);
  }

  // Measured on Claude's menus: in a single choice ↑/↓ then Enter answers in every variant (a number answers
  // at once in some and only moves the cursor in others, like the one with previews). In a multiple choice the
  // number toggles the box; when the cursor sits in the free-text choice it would be typed, so ↑ leaves first.
  answer(a, option, cx, seen) {
    if (option.n === this.prompts.get(a.address)?.free) return this.startReply(a, option.n, cx, "reply", seen);
    this.sendOnce(a.address, seen, cx, async ({ prompt: p, free }) => {
      if (!p.multi) return this.press(a, [...moveKeys(p, option.n), "enter"], option.label, cx);
      const leave = p.cursor != null && p.cursor === free ? ["up"] : [];
      return this.press(a, [...leave, String(option.n)], option.label, cx);
    }, seen?.multi);
  }

  submit(a, seen, cx) {
    this.sendOnce(a.address, seen, cx, async ({ prompt, free }) => {
      const leave = prompt.cursor != null && prompt.cursor === free ? ["up"] : [];
      // Leaving the field moves the cursor one up, so count the moves to Submit from there.
      const from = leave.length ? { ...prompt, cursor: prompt.cursor - 1 } : prompt;
      return this.press(a, [...leave, ...submitKeys(from)], "Submitted", cx);
    });
  }

  // One send per agent at a time: a second click's Enter would land in whatever dialog the first one reveals.
  // A box of a multiple choice doesn't move on to anything, so those clicks wait their turn.
  sendOnce(address, seen, cx, send, queue = false) {
    const busy = this.answering.get(address);
    if (busy && !queue) return;
    let done;
    const turn = new Promise((resolve) => { done = resolve; });
    this.answering.set(address, turn);
    cx.spawn(async (cx) => {
      try {
        await busy;
        if (await this.stillAsking(address, seen, cx)) await send(this.prompts.get(address), cx);
      } finally {
        if (this.answering.get(address) === turn) this.answering.delete(address);
        done();
      }
    });
  }

  // Keys only go to the question the card showed; if it changed, the card redraws with the new one.
  // A card without choices (no seen) only needs none to have appeared: a paste's Enter would pick one.
  async stillAsking(address, seen, cx) {
    if (!await this.rereadPrompt(address)) {
      notify({ title: "Could not read the agent's screen", body: "Nothing was sent.", level: "warning" });
      return false;
    }
    const now = this.prompts.get(address).prompt;
    const live = agents().find((a) => a.address === address)?.status === "blocked";
    if (live && (seen ? samePrompt(seen, now) : !now.options.length && !now.unparsed)) return true;
    notify({ title: "The question changed", body: "Nothing was sent. Read the card and answer again.", level: "warning" });
    cx.notify();
    return false;
  }

  // Holds the send's turn until the dialog it answered has gone, so a late click can't reach the next one.
  async settle(address, before, cx) {
    for (let i = 0; i < SETTLE_TRIES; i++) {
      await cx.sleep(250);
      await this.rereadPrompt(address);
      const now = this.prompts.get(address)?.prompt;
      if (!before?.options.length || before.multi || !now || !samePrompt(before, now)) return;
    }
  }

  // After a key the screen changes (a box checks, the next question shows), so read it again.
  async press(a, keys, label, cx) {
    const before = this.prompts.get(a.address)?.prompt;
    const r = await exec("hc", ["keys", a.address, ...keys]);
    if (r.code !== 0) {
      notify({ title: "Could not answer", body: r.stderr.trim().split("\n")[0], level: "warning" });
      return;
    }
    await this.settle(a.address, before, cx);
    cx.notify();
    await this.sendNote(a);
    if (!this.prompts.get(a.address)?.prompt.multi) {
      notify({ title: `Answered ${a.tab_name || a.address}`, body: label, level: "success", timeout: 2000 });
    }
    this.scanLocal(cx);
  }

  // Claude's own notes field sends the answer without a choice when its Enter is pressed (measured), so a note
  // goes as a message once the question is gone; Claude queues it if the agent is already working.
  async sendNote(a) {
    const note = this.notes.get(a.address);
    const now = this.prompts.get(a.address)?.prompt;
    if (!note || now?.options.length || now?.unparsed) return;
    this.notes.delete(a.address);
    const r = await exec("hc", ["send", a.address, `Note on my last answer: ${note}`]);
    if (r.code !== 0) notify({ title: "Could not send the note", body: r.stderr.trim().split("\n")[0], level: "warning" });
  }

  // False when there's no screen to go by; what the card knows stays as it was.
  async rereadPrompt(address) {
    const r = await exec("hc", ["read", address, "--lines", "0"]);
    if (r.code !== 0 || !r.stdout.trim()) return false;
    const was = this.prompts.get(address);
    const prompt = readPrompt(r.stdout);
    this.prompts.set(address, { since: was?.since, prompt, free: freeOption(prompt, was?.free) });
    for (const i of this.local) if (i.agent.address === address) i.prompt = this.prompts.get(address).prompt;
    return true;
  }

  startReply(a, key, cx, mode = "reply", seen = null) {
    this.replying = a.address;
    this.replyKey = key;
    this.replyMode = mode;
    this.replySeen = seen;
    this.reply.set_value("");
    this.reply.focus();
    cx.notify();
  }

  // The free-text choice, as Claude's menu takes it (measured): in a single choice its number puts the cursor
  // in the field and a paste with Enter answers. In a multiple choice the number only toggles the box, so the
  // cursor moves there by arrows; the paste's Enter unchecks the box, so ↑ leaves the field and the number
  // checks it again. hc keys can't type accents, so the words always go as a paste.
  sendReply(cx) {
    const text = this.reply.value().trim(), address = this.replying, key = this.replyKey, mode = this.replyMode;
    const seen = this.replySeen;
    if (mode !== "note" && text && this.answering.has(address)) {
      notify({ title: "Still answering this agent", body: "Nothing was sent. Try again in a moment.", level: "warning" });
      return;
    }
    this.replying = null;
    this.replyKey = null;
    this.replyMode = null;
    if (mode === "note" && address) {
      if (text) this.notes.set(address, text);
      return cx.notify();
    }
    cx.notify();
    if (!text || !address) return;
    this.sendOnce(address, seen, cx, async ({ prompt: p }, cx) => {
      const failed = (r) => {
        if (!r || r.code === 0) return false;
        notify({ title: "Could not reply", body: r.stderr.trim().split("\n")[0], level: "warning" });
        return true;
      };
      const keys = (list) => (list.length ? exec("hc", ["keys", address, ...list]) : null);
      const moved = key && p?.multi ? await keys(moveKeys(p, key)) : key && p?.cursor !== key ? await keys([String(key)]) : null;
      if (failed(moved)) return;
      if (failed(await exec("hc", ["send", "--force", address, text]))) return;
      if (key && p?.multi) {
        await cx.sleep(250);
        await this.rereadPrompt(address);
        const now = this.prompts.get(address)?.prompt;
        if (now && sameChoicesBut(key, p, now)) await keys(now.options.find((o) => o.n === key)?.checked ? ["up"] : ["up", String(key)]);
      }
      await this.settle(address, p, cx);
      cx.notify();
      this.scanLocal(cx);
    });
  }

  localCard(t, item, addressed = false) {
    const a = item.agent;
    const goAgent = () => run("agent.focus", { terminal: a.address });
    if (item.kind === "blocked") return this.waitingCard(t, item, goAgent);
    return this.card(t, `in-${a.address}`, false,
      this.head(t, a.status === "done" ? t.done : t.idle, `${item.repo}${item.branch ? ` · ${item.branch}` : ""}`, ago(item.at)),
      v_flex().gap(3)
        .child(h_flex().gap(8).items_center().text_size(11.5).text_color(t.muted)
          .child(`${item.files} ${item.files === 1 ? "file" : "files"}`)
          .child(div().text_color(t.ansi2).child(`+${item.add}`))
          .child(div().text_color(t.ansi1).child(`−${item.del}`))
          .child(div().text_color(t.dim).child(a.status === "done" ? "agent finished" : "uncommitted")))
        .when(Boolean(item.said), (el) => el.child(div().id(`said-${a.address}`).truncate().text_size(11)
          .text_color(t.dim).italic().tooltip(item.said).child(`“${item.said}”`))),
      [
        button(t, `review-${a.address}`, "Review", () => openReview(item.top, a.address), {
          kind: "solid", tip: withKey("Comment on the diff line by line", "relevo.review"),
        }),
        button(t, `diff-${a.address}`, "View diff", () => {
          run("pane.focus", { pane: a.pane });
          showPanel("changes");
        }),
        button(t, `files-${a.address}`, "Files", () => {
          run("pane.focus", { pane: a.pane });
          showPanel("files");
        }),
        button(t, `agent-${a.address}`, "Agent", goAgent),
        addressed
          ? button(t, `undo-${a.address}`, "Undo", (cx) => this.setLocalAddressed(a, false, cx), { tip: "Back to the list" })
          : button(t, `addressed-${a.address}`, "✓", (cx) => this.setLocalAddressed(a, true, cx), {
            tip: "Addressed: hide until its agent works again",
          }),
      ]);
  }

  localGroup(t, key, label, items, done = []) {
    if (!items.length && !done.length) return [];
    return [
      sectionHeader(t, label, items.length),
      ...items.map((i) => this.localCard(t, i)),
      ...this.addressedFold(t, key, done, (i) => this.localCard(t, i, true)),
    ];
  }

  render(cx) {
    const t = theme(), v = this.shown();
    this.publish(v);
    this.takeFocus(cx);
    this.nav = this.navItems(v);
    this.keyboard = this.h.is_focused();
    if (this.sel && !this.nav.some((i) => i.id === this.sel)) this.sel = null;
    const view = this.viewport();
    this.hiddenIds = view.hidden;
    const part = (key, els) => (view.sections.has(key) ? [] : els.filter(Boolean));
    const total = v.local.length + v.mine.length + v.requested.length;
    return v_flex().id("relevo-inbox").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.surface ?? t.chrome).border_1().border_color(this.keyboard ? t.accent : t.border).text_color(t.foreground)
      .track_focus(this.h)
      .on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.navKey(e, cx))
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Inbox"))
        .child(h_flex().gap(5).items_center().text_size(11).text_color(t.dim)
          .when(!this.prsAt && this.scanningPRs, (el) => el.child(spinner(t.dim, 10)))
          .child(this.prsAt ? `PRs ${ago(this.prsAt)}` : this.scanningPRs ? "loading" : "PRs unavailable"))
        .child(div().flex_1())
        .child(div().id("inbox-refresh").px(6).rounded(5).cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => {
            this.scanLocal(cx);
            this.scanPRs(cx);
            this.scanTrees(cx, true);
          })
          .child("↻")))
      .child(v_flex().id("inbox-list").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(6)
        .when(Boolean(this.error), (el) => el.child(div().p(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .when(!total && !this.error && Boolean(this.prsAt), (el) => el.child(
          div().p(12).text_size(12).text_color(t.dim).child("Nothing waiting")))
        .when(view.above > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.dim).child(`↑ ${view.above} above · Esc`)))
        .children(part("waiting", this.localGroup(t, "waiting", "WAITING ON YOU", v.local.filter((i) => i.kind === "blocked"))))
        .children(part("local", this.localGroup(t, "local", "UNCOMMITTED WORK", v.local.filter((i) => i.kind === "diff"), v.localDone)))
        .children(part("mine", this.prGroup(t, "mine", "YOUR PRS", v.mine, false, v.mineDone)))
        .children(part("requested", this.prGroup(t, "requested", "REVIEW REQUESTS", v.requested, true, v.requestedDone)))
        .children(part("today", this.todayGroup(t, v.today)))
        .children(part("trees", this.treeGroups(t, v.worktrees))));
  }
}


for (const views of [PrViews, TreeViews, KeyNav, LiveViews, LocalAddressed]) {
  for (const name of Object.getOwnPropertyNames(views.prototype)) {
    if (name !== "constructor") Inbox.prototype[name] = views.prototype[name];
  }
}
